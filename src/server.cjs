'use strict';

const http  = require('node:http');
const https = require('node:https');
const fs    = require('node:fs');
const path  = require('node:path');
const url   = require('node:url');
const logger = require('./logger.cjs');

// ── Config ─────────────────────────────────────────────────────────────────────
const APP_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(APP_ROOT, 'config.json');
const CONFIG_TEMPLATE_PATH = path.join(APP_ROOT, 'config.template.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  const hasTemplate = fs.existsSync(CONFIG_TEMPLATE_PATH);
  logger.warn({
    configPath: CONFIG_PATH,
    templatePath: hasTemplate ? CONFIG_TEMPLATE_PATH : null,
    copyCommand: hasTemplate ? 'cp config.template.json config.json' : null,
  }, 'No config.json found; using defaults and environment variables.');
}

config.jira = config.jira || {};
config.jira.fields = config.jira.fields || {};
if (process.env.JIRA_BASE_URL) config.jira.baseUrl = process.env.JIRA_BASE_URL;
if (process.env.JIRA_EMAIL) config.jira.email = process.env.JIRA_EMAIL;
if (process.env.JIRA_TOKEN) config.jira.token = process.env.JIRA_TOKEN;
if (process.env.JIRA_FIELDS_YESTERDAY) config.jira.fields.yesterday = process.env.JIRA_FIELDS_YESTERDAY;
if (process.env.JIRA_FIELDS_TODAY) config.jira.fields.today = process.env.JIRA_FIELDS_TODAY;
if (process.env.JIRA_FIELDS_BLOCKERS) config.jira.fields.blockers = process.env.JIRA_FIELDS_BLOCKERS;

// Anthropic (Claude) — used to draft the Friday "Weekly Update" from the week's notes.
config.anthropic = config.anthropic || {};
if (process.env.ANTHROPIC_API_KEY) config.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
if (process.env.ANTHROPIC_MODEL) config.anthropic.model = process.env.ANTHROPIC_MODEL;
const ANTHROPIC_MODEL = config.anthropic.model || 'claude-opus-4-8';

const PORT        = Number(process.env.PORT)       || config.port      || 8080;
const HOST        = process.env.HOST               || config.host      || '127.0.0.1';
const ALLOW_REMOTE = process.env.ALLOW_REMOTE === '1' || config.allowRemote === true;
const VAULT_PATH  = process.env.VAULT_PATH          || path.resolve(APP_ROOT, config.vaultPath || '.');
const DAILY_DIR   = path.join(VAULT_PATH, 'daily');
const PROJECTS_DIR = path.join(VAULT_PATH, 'projects');
const DIST_DIR    = path.join(APP_ROOT, 'dist');
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function jsonResp(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', reject);
  });
}

function normalizeClientLogLevel(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return 'info';
}

// ── Jira (server-side proxy — no CORS) ────────────────────────────────────────
function jiraReq(urlPath, method, bodyObj) {
  const j = config.jira || {};
  const base = (j.baseUrl || '').replace(/\/$/, '');
  const authMode = j.email && j.token ? 'basic' : 'none';
  if (!base || !j.email || !j.token) {
    logger.error({
      jiraBaseConfigured: !!base,
      jiraEmailConfigured: !!j.email,
      jiraTokenConfigured: !!j.token,
      jiraAuthMode: authMode,
    }, 'Jira request aborted due to missing credentials/config');
    return Promise.reject(new Error('Jira not configured — set jira.baseUrl/email/token in config.json'));
  }

  const auth   = Buffer.from(`${j.email}:${j.token}`).toString('base64');
  const body   = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const target = new URL(`${base}${urlPath}`);
  logger.debug({ method: method || 'GET', path: target.pathname, jiraAuthMode: authMode }, 'Jira request start');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname,
      port: 443,
      path: target.pathname + target.search,
      method: method || 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        logger.debug({ method: method || 'GET', path: target.pathname, statusCode: r.statusCode, jiraAuthMode: authMode }, 'Jira response received');
        if (r.statusCode === 401 || r.statusCode === 403)
          return reject(new Error(`Jira auth failed (${r.statusCode}) — check config.json credentials`));
        if (r.statusCode >= 400)
          return reject(new Error(`Jira ${r.statusCode}: ${d}`));
        if (!d || r.statusCode === 204) return resolve(null);
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Anthropic (server-side proxy — keeps the API key out of the browser) ──────
function anthropicReq(bodyObj) {
  const key = (config.anthropic || {}).apiKey;
  if (!key) {
    logger.error('Weekly-update draft aborted: Anthropic API key not configured');
    return Promise.reject(new Error('Anthropic not configured — set anthropic.apiKey in config.json or ANTHROPIC_API_KEY'));
  }

  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        if (r.statusCode >= 400) return reject(new Error(`Anthropic ${r.statusCode}: ${d}`));
        try { resolve(JSON.parse(d)); } catch { reject(new Error('Malformed Anthropic response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Concatenate the text blocks of a Messages API response (skips thinking blocks).
function extractText(msg) {
  return ((msg && msg.content) || [])
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

// ── ESM utils (parser.js/mutations.js/rollForward.js are ESM; this file is CJS) ─
let esmUtilsPromise = null;
function loadEsmUtils() {
  if (!esmUtilsPromise) {
    esmUtilsPromise = Promise.all([
      import(url.pathToFileURL(path.join(__dirname, 'utils', 'parser.js')).href),
      import(url.pathToFileURL(path.join(__dirname, 'utils', 'mutations.js')).href),
      import(url.pathToFileURL(path.join(__dirname, 'utils', 'rollForward.js')).href),
    ]).then(([parser, mutations, rollForward]) => ({ parser, mutations, rollForward }));
  }
  return esmUtilsPromise;
}

// ── Weekly Update draft ───────────────────────────────────────────────────────
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WEEKLY_UPDATE_SYSTEM = [
  'You are drafting Peter Fitzgibbons\'s end-of-week "Weekly Update" note to his manager, Karen.',
  'You are given Peter\'s own daily working notes for the week — Standup entries (Yesterday/Today/Blockers),',
  'Tasks with status prefixes (wip, in-review, reviewing, needs-qa, qa, done), freeform Notes, and time-logged',
  'work entries. Write a concise, honest weekly update grounded ONLY in those notes. Do not invent work,',
  'metrics, ticket numbers, or outcomes that are not present in the notes.',
  '',
  'Reply with ONLY the update body in Markdown — no preamble, no explanation, no code fences — following this',
  'exact skeleton (keep all four "###" headings, the greeting, and the sign-off verbatim):',
  '',
  'Hi Karen,',
  '',
  'Quick end-of-week snapshot.',
  '',
  '### Wins this week',
  '- <bullet>',
  '',
  '### Unblocked or moved forward',
  '- <bullet>',
  '',
  '### Risks or blockers on my radar',
  '- <bullet>',
  '',
  '### Priorities for next week',
  '- <bullet>',
  '',
  'Kindest Regards,',
  'Peter Fitzgibbons',
  '',
  'Guidance:',
  '- Each bullet is one line of plain business English, outcome-first (lead with the result, not the activity).',
  '- Preserve ticket references (e.g. CIAM-20, DP-317) in parentheses where the notes attribute work to them.',
  '- Production Support tickets (prefix "SUPP-") are the exception: do NOT describe them individually — collapse',
  '  them into a single count, e.g. "Addressed 2 Production Support tickets (SUPP-1234, SUPP-1235)". List the',
  '  individual SUPP- numbers in parentheses only when there are 3 or fewer; if there are more than 3, give just',
  '  the count with no numbers, e.g. "Addressed 6 Production Support tickets".',
  '- "Wins this week" = shipped / completed / done items. "Unblocked or moved forward" = progress on in-flight',
  '  work. "Risks or blockers" = anything flagged blocked, at risk, or a concern — write "- None." if there is',
  '  genuinely nothing. "Priorities for next week" = carry-forward tasks and stated next steps.',
  '- Word choice: use "Deploy"/"Deployed" for release/completion. Never use "Land"/"Landed" — that is not',
  '  Peter\'s vocabulary.',
  '- 2–5 bullets per section; if a section truly has nothing to report, keep its heading and write "- None.".',
  '- Do not use a "> " worked-today marker or checkbox syntax in the output — those are input artifacts.',
].join('\n');

// The 5 weekday dates (Mon–Fri) of the week containing `fridayDate`, with the
// note content of whichever files exist. The Friday's own note is dropped from
// the prompt if it doesn't exist yet (the usual case during a Thu→Fri roll).
function weekNotesFor(fridayDate) {
  const [y, m, d] = fridayDate.split('-').map(Number);
  const fri = new Date(y, m - 1, d);
  const out = [];
  for (let i = 4; i >= 0; i--) {
    const dt = new Date(fri);
    dt.setDate(fri.getDate() - i);
    const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    let content;
    try { content = fs.readFileSync(path.join(DAILY_DIR, `${ds}.md`), 'utf8'); }
    catch { continue; } // missing weekday — skip
    out.push({ date: ds, label: WEEKDAY_LABELS[dt.getDay()], content });
  }
  return out;
}

// Drop a note's own "## Weekly Update" section so we don't feed the (usually
// empty) template back into the draft.
function stripWeeklyUpdate(md) {
  const idx = md.indexOf('## Weekly Update');
  return (idx === -1 ? md : md.slice(0, idx)).trimEnd();
}

function buildWeeklyUserMessage(fridayDate, notes) {
  const parts = [`Here are my daily working notes for the week ending Friday ${fridayDate}:`, ''];
  for (const n of notes) {
    parts.push(`# ${n.date} (${n.label})`, stripWeeklyUpdate(n.content), '');
  }
  parts.push('Draft my Weekly Update to Karen from these notes.');
  return parts.join('\n');
}

// Same roll-forward the web UI's "Roll Forward" button performs (carry open
// tasks from the prior weekday's note into `date`), but server-side so the
// CLI and HTTP API can trigger it without a browser. Creates/overwrites
// daily/<date>.md.
async function performRollForward(date) {
  const { parser, mutations, rollForward } = await loadEsmUtils();
  const prevDate = rollForward.subOneDay(date);
  let prevContent = '';
  try { prevContent = fs.readFileSync(path.join(DAILY_DIR, `${prevDate}.md`), 'utf8'); }
  catch {}

  const secs = parser.parseSections(prevContent).sections;
  const { completed, worked, remaining } = parser.parseRawTasks(secs['Tasks'] || []);
  const onDeckWorked = [];
  const onDeckRemaining = [];
  for (const line of (secs['On Deck'] || [])) {
    const todo = /^\s*-\s*\[ \]\s*(.+)/.exec(line);
    if (!todo) { onDeckRemaining.push(line); continue; }
    const body = todo[1].trim();
    if (body.startsWith('> ')) onDeckWorked.push(body.slice(2));
    else onDeckRemaining.push(line);
  }

  let content = rollForward.buildNextDayContent(date, completed, worked, remaining, onDeckWorked, onDeckRemaining);

  if (rollForward.isFriday(date)) {
    let existingWu = null;
    try {
      const existingContent = fs.readFileSync(path.join(DAILY_DIR, `${date}.md`), 'utf8');
      existingWu = parser.parseSections(existingContent).sections['Weekly Update'];
    } catch {}
    const alreadyFilled = existingWu && existingWu.some(l => /^\s*-\s+\S/.test(l));

    if (alreadyFilled) {
      content = mutations.rebuildWeeklyUpdateSection(content, existingWu.join('\n'));
    } else {
      const notes = weekNotesFor(date);
      if (notes.length) {
        try {
          const msg = await anthropicReq({
            model: ANTHROPIC_MODEL,
            max_tokens: 6000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: WEEKLY_UPDATE_SYSTEM,
            messages: [{ role: 'user', content: buildWeeklyUserMessage(date, notes) }],
          });
          const body = extractText(msg);
          if (body) content = mutations.rebuildWeeklyUpdateSection(content, body);
        } catch (e) {
          logger.warn({ err: e.message, date }, 'Roll-forward: weekly-update draft failed, keeping static template');
        }
      }
    }
  }

  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.writeFileSync(path.join(DAILY_DIR, `${date}.md`), content, 'utf8');
  return content;
}

// ── Route handler ──────────────────────────────────────────────────────────────
async function handle(req, res) {
  // Security: only accept loopback connections
  const remoteAddr = req.socket.remoteAddress;
  if (!ALLOW_REMOTE && remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    res.writeHead(403); return res.end('Forbidden');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');

  const { pathname } = url.parse(req.url);
  const method = req.method.toUpperCase();
  const startTs = Date.now();

  // Emit per-request completion details in debug mode.
  res.on('finish', () => {
    logger.debug({
      method,
      pathname,
      statusCode: res.statusCode,
      remoteAddr,
      durationMs: Date.now() - startTs,
    }, 'Request completed');
  });

  logger.debug({ method, pathname, remoteAddr }, 'Incoming request');

  // OPTIONS preflight (for local fetch)
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': 'http://localhost:' + PORT,
                         'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
                         'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (pathname === '/api/client-log' && method === 'POST') {
    try {
      const payload = await readBody(req);
      const events = Array.isArray(payload?.events) ? payload.events : [payload];
      const ua = req.headers['user-agent'] || '';
      for (const evt of events) {
        const level = normalizeClientLogLevel(evt?.level);
        const entry = {
          source: 'client',
          event: evt?.event || 'ui-event',
          data: evt?.data || {},
          remoteAddr,
          userAgent: ua,
        };
        const message = evt?.message || 'Client event';
        if (level === 'debug') logger.debug(entry, message);
        else if (level === 'warn') logger.warn(entry, message);
        else if (level === 'error') logger.error(entry, message);
        else logger.info(entry, message);
      }
      return jsonResp(res, 200, { ok: true, count: events.length });
    } catch (e) {
      logger.warn({ err: e.message }, 'Client log ingestion failed');
      return jsonResp(res, 400, { error: 'Invalid client log payload' });
    }
  }

  // ── Serve static (Vue dist) ────────────────────────────────────────────────
  if (!pathname.startsWith('/api/')) {
    if (pathname === '/') {
      res.writeHead(302, {
        Location: `/${todayStr()}`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }

    // Try dist/ first (Vue build output)
    const distIndex = path.join(DIST_DIR, 'index.html');
    const distFile  = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
    const serveFile = (fp, ct) => {
      try {
        const data = fs.readFileSync(fp);
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
        return res.end(data);
      } catch { return false; }
    };
    const mime = {
      '.js': 'application/javascript', '.css': 'text/css',
      '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.ico': 'image/x-icon',
    };
    const ext  = path.extname(distFile);
    if (ext && serveFile(distFile, mime[ext] || 'application/octet-stream')) return;
    // SPA fallback
    if (serveFile(distIndex, 'text/html; charset=utf-8')) return;
    res.writeHead(404); return res.end('No index found. Run: npm run build');
  }

  // ── GET /api/projects ─────────────────────────────────────────────────────────
  if (pathname === '/api/projects' && method === 'GET') {
    try {
      const files = fs.readdirSync(PROJECTS_DIR)
        .filter(f => f.endsWith('.md') && f !== '_template.md')
        .map(f => f.slice(0, -3))
        .sort();
      return jsonResp(res, 200, files);
    } catch { return jsonResp(res, 200, []); }
  }

  // ── GET /api/dates ───────────────────────────────────────────────────────────
  if (pathname === '/api/dates' && method === 'GET') {
    try {
      const files = fs.readdirSync(DAILY_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map(f => f.replace('.md', ''))
        .sort();
      return jsonResp(res, 200, files);
    } catch { return jsonResp(res, 200, []); }
  }

  // ── GET /api/time-entries/:date/draft ────────────────────────────────────────
  const timeEntryDraftMatch = /^\/api\/time-entries\/(\d{4}-\d{2}-\d{2})\/draft$/.exec(pathname);
  if (timeEntryDraftMatch && method === 'GET') {
    const date = timeEntryDraftMatch[1];
    const file = path.join(VAULT_PATH, '.tmp', 'time-entries', date, 'merged.json');
    try { return jsonResp(res, 200, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { return jsonResp(res, 404, { error: `No time-entry draft for ${date}` }); }
  }

  // ── GET/PUT /api/daily/:date ─────────────────────────────────────────────────
  const dailyMatch = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
  if (dailyMatch) {
    const date = dailyMatch[1];
    if (!DATE_RE.test(date)) return jsonResp(res, 400, { error: 'Invalid date format' });

    // Prevent path traversal (date is digits/hyphens only, but be explicit)
    const file = path.join(DAILY_DIR, `${date}.md`);
    if (!file.startsWith(DAILY_DIR + path.sep) && file !== path.join(DAILY_DIR, `${date}.md`)) {
      return jsonResp(res, 400, { error: 'Bad path' });
    }

    if (method === 'GET') {
      try {
        const content = fs.readFileSync(file, 'utf8');
        return jsonResp(res, 200, { date, content, exists: true });
      } catch (e) {
        if (e.code === 'ENOENT') return jsonResp(res, 200, { date, content: '', exists: false });
        return jsonResp(res, 500, { error: e.message });
      }
    }

    if (method === 'PUT') {
      try {
        const body = await readBody(req);
        if (typeof body?.content !== 'string')
          return jsonResp(res, 400, { error: '"content" string required' });
        fs.mkdirSync(DAILY_DIR, { recursive: true });
        fs.writeFileSync(file, body.content, 'utf8');
        return jsonResp(res, 200, { ok: true });
      } catch (e) { return jsonResp(res, 500, { error: e.message }); }
    }
  }

  // ── POST /api/daily/:date/roll-forward ───────────────────────────────────────
  const rollForwardMatch = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/roll-forward$/.exec(pathname);
  if (rollForwardMatch && method === 'POST') {
    const date = rollForwardMatch[1];
    try {
      const content = await performRollForward(date);
      logger.info({ date }, 'Roll forward completed');
      return jsonResp(res, 200, { ok: true, date, content });
    } catch (e) {
      logger.error({ err: e.message, date }, 'Roll forward failed');
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/daily/:date/task ───────────────────────────────────────────────
  // Byte-correct edits to the ## Tasks section only — same primitives as
  // mutations.js/the vault-tasks skill, exposed over HTTP for the CLI.
  const taskActionMatch = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/task$/.exec(pathname);
  if (taskActionMatch && method === 'POST') {
    const date = taskActionMatch[1];
    const file = path.join(DAILY_DIR, `${date}.md`);
    try {
      const { parser, mutations } = await loadEsmUtils();
      let raw;
      try { raw = fs.readFileSync(file, 'utf8'); }
      catch { return jsonResp(res, 404, { error: `No daily note at ${date} — roll-forward or save it first` }); }

      const body = await readBody(req);
      const action = body && body.action;

      if (action === 'set') {
        const key = body.key ? String(body.key).toUpperCase() : null;
        const matchText = body.matchText ? String(body.matchText) : null;
        if (!key && !matchText) return jsonResp(res, 400, { error: '"key" or "matchText" is required for action "set"' });
        if (body.status && !parser.STATUS_SLUGS.has(body.status))
          return jsonResp(res, 400, { error: `Unknown status "${body.status}"` });

        const taskLines = parser.parseSections(raw).sections['Tasks'] || [];
        const isTaskLine = l => /^\s*-\s*\[[x ]\]\s/i.test(l);
        const matches = key
          ? taskLines.filter(l => isTaskLine(l) && new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l))
          : taskLines.filter(l => isTaskLine(l) && l.toLowerCase().includes(matchText.toLowerCase()));

        if (!matches.length) return jsonResp(res, 404, { error: `No task matching ${key || matchText} found in Tasks section — add it first` });
        if (matches.length > 1) logger.warn({ date, key, matchText, count: matches.length }, 'Task-set matched multiple lines; acting on the first');

        const oldLine = matches[0];
        let newLine = oldLine;
        if (body.status) newLine = mutations.rewriteTaskStatus(newLine, body.status);
        if (typeof body.workedToday === 'boolean') newLine = mutations.setWorkedFlag(newLine, body.workedToday);
        const newRaw = mutations.replaceLine(raw, oldLine, newLine);
        fs.writeFileSync(file, newRaw, 'utf8');
        return jsonResp(res, 200, { ok: true, date, line: newLine });
      }

      if (action === 'add') {
        const text = body.text ? String(body.text).trim() : '';
        if (!text) return jsonResp(res, 400, { error: '"text" is required for action "add"' });
        if (!/^##\s+Tasks\s*$/m.test(raw)) return jsonResp(res, 400, { error: 'No "## Tasks" heading found in daily note' });

        const addedLine = `- [ ] ${text}`;
        let newRaw = mutations.addTaskToSection(raw, 'Tasks', text);
        let finalLine = addedLine;
        if (body.done === true) {
          finalLine = mutations.rewriteTaskStatus(addedLine, 'done');
          newRaw = mutations.replaceLine(newRaw, addedLine, finalLine);
        }
        fs.writeFileSync(file, newRaw, 'utf8');
        return jsonResp(res, 200, { ok: true, date, line: finalLine });
      }

      return jsonResp(res, 400, { error: `Unknown action "${action}" — expected "set" or "add"` });
    } catch (e) {
      logger.error({ err: e.message, date }, 'Task action failed');
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/jira/standup ───────────────────────────────────────────────────
  if (pathname === '/api/jira/config' && method === 'GET') {
    const jira = config.jira || {};
    logger.debug({
      jiraBaseConfigured: !!jira.baseUrl,
      jiraEmailConfigured: !!jira.email,
      jiraTokenConfigured: !!jira.token,
      jiraFieldsConfigured: Object.keys(jira.fields || {}).length,
    }, 'Jira config requested');
    return jsonResp(res, 200, {
      baseUrl: jira.baseUrl || '',
      fields: jira.fields || {},
    });
  }

  // ── POST /api/jira/standup ───────────────────────────────────────────────────
  if (pathname === '/api/jira/standup' && method === 'POST') {
    try {
      const body = await readBody(req);
      const { date } = body;
      let { yesterday, today, blockers } = body;
      if (yesterday === undefined && today === undefined && blockers === undefined) {
        const { parser } = await loadEsmUtils();
        let noteRaw = '';
        try { noteRaw = fs.readFileSync(path.join(DAILY_DIR, `${date}.md`), 'utf8'); }
        catch { return jsonResp(res, 404, { error: `No daily note at ${date}` }); }
        const standup = parser.parseStandup(parser.parseSections(noteRaw).sections['Standup'] || []);
        yesterday = standup.yesterday;
        today = standup.today;
        blockers = standup.blockers;
      }
      const fields = (config.jira || {}).fields || {};
      logger.info({
        date,
        yesterdayCount: (yesterday || []).length,
        todayCount: (today || []).length,
        blockersLength: (blockers || '').length,
      }, 'Standup submit started');
      if (!fields.yesterday && !fields.today && !fields.blockers) {
        logger.error('Standup submit aborted because Jira custom fields are not configured');
        return jsonResp(res, 500, { error: 'Jira custom fields not configured' });
      }

      logger.debug({ date }, 'Standup submit: fetching Jira current user');
      const me = await jiraReq('/rest/api/3/myself', 'GET');
      logger.debug({ date, accountId: me?.accountId }, 'Standup submit: Jira user resolved');

      logger.debug({ date }, 'Standup submit: searching standup issue');
      const data = await jiraReq('/rest/api/3/search/jql', 'POST', {
        jql: `assignee="${me.accountId}" AND summary~"standup" ORDER BY created DESC`,
        maxResults: 30,
        fields: ['key', 'summary'],
      });

      const issue = (data.issues || []).find(i => (i.fields.summary || '').includes(date));
      if (!issue) {
        logger.warn({ date, issueCount: (data.issues || []).length }, 'No standup issue found for date');
        return jsonResp(res, 404, { error: `No standup card found for ${date}` });
      }
      logger.debug({ date, key: issue.key }, 'Standup submit: target issue found');

      const adfBullet = items => ({
        type: 'doc', version: 1,
        content: [{ type: 'bulletList', content: (items || []).map(t => ({
          type: 'listItem', content: [{ type: 'paragraph',
            content: [{ type: 'text', text: t }] }]
        }))}],
      });
      const adfText = text => ({
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: text || '' }] }],
      });

      const fieldData = {};
      if (fields.yesterday) fieldData[fields.yesterday] = adfBullet(yesterday);
      if (fields.today)     fieldData[fields.today]     = adfBullet(today);
      if (fields.blockers)  fieldData[fields.blockers]  = adfText(blockers || 'None');

      if (Object.keys(fieldData).length) {
        logger.debug({ date, key: issue.key, fieldCount: Object.keys(fieldData).length }, 'Standup submit: updating issue fields');
        await jiraReq(`/rest/api/3/issue/${issue.key}`, 'PUT', { fields: fieldData });
      }

      logger.debug({ date, key: issue.key }, 'Standup submit: fetching transitions');
      const { transitions } = await jiraReq(`/rest/api/3/issue/${issue.key}/transitions`, 'GET');
      const done = (transitions || []).find(t =>
        (t.name || '').toLowerCase().includes('done') ||
        (t.to?.name || '').toLowerCase() === 'done'
      );
      if (done) {
        logger.debug({ date, key: issue.key, transitionId: done.id }, 'Standup submit: applying done transition');
        await jiraReq(`/rest/api/3/issue/${issue.key}/transitions`, 'POST',
          { transition: { id: done.id } });
      }

      try {
        const { mutations } = await loadEsmUtils();
        const file = path.join(DAILY_DIR, `${date}.md`);
        const noteRaw = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, mutations.setFrontmatterField(noteRaw, 'standupSubmitted', 'true'), 'utf8');
      } catch (e) {
        logger.warn({ err: e.message, date }, 'Standup submit: could not stamp standupSubmitted into note frontmatter');
      }

      logger.info({ date, key: issue.key, transitioned: !!done }, 'Standup submit completed');
      return jsonResp(res, 200, { ok: true, key: issue.key, transitioned: !!done });
    } catch (e) {
      logger.error({ err: e.message }, 'Standup submit failed');
      return jsonResp(res, 500, { error: e.message });
    }
  }

  // ── POST /api/weekly-update ───────────────────────────────────────────────────
  if (pathname === '/api/weekly-update' && method === 'POST') {
    try {
      const { date } = await readBody(req);
      if (!DATE_RE.test(String(date || ''))) return jsonResp(res, 400, { error: 'Invalid date format' });

      const notes = weekNotesFor(date);
      logger.info({ date, dayCount: notes.length }, 'Weekly update draft requested');
      if (!notes.length) return jsonResp(res, 400, { error: `No daily notes found for the week ending ${date}` });

      const msg = await anthropicReq({
        model: ANTHROPIC_MODEL,
        max_tokens: 6000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: WEEKLY_UPDATE_SYSTEM,
        messages: [{ role: 'user', content: buildWeeklyUserMessage(date, notes) }],
      });

      const body = extractText(msg);
      if (!body) {
        logger.warn({ date, stopReason: msg && msg.stop_reason }, 'Weekly update draft returned no text');
        return jsonResp(res, 502, { error: 'Claude returned an empty draft' });
      }

      logger.info({ date, model: ANTHROPIC_MODEL, chars: body.length }, 'Weekly update draft completed');
      return jsonResp(res, 200, { body });
    } catch (e) {
      logger.error({ err: e.message }, 'Weekly update draft failed');
      return jsonResp(res, 500, { error: e.message });
    }
  }

  res.writeHead(404); res.end('API route not found');
}

// ── Start ──────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    logger.error({ err: e.message, stack: e.stack }, 'Unhandled request error');
    try { res.writeHead(500); res.end('Internal error'); } catch {}
  });
});

server.listen(PORT, HOST, () => {
  logger.info(`Log level    ->  ${logger.level}`);
  logger.info(`Vault Daily  ->  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  logger.info(`Vault path   ->  ${VAULT_PATH}`);
  logger.info(`Daily files  ->  ${DAILY_DIR}`);
  logger.info(`Log file     ->  ${logger.logFile || path.join(APP_ROOT, 'log', 'server.log')}`);
});
