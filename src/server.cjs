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
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  logger.warn('No config.json found; using defaults and environment variables.');
}

config.jira = config.jira || {};
config.jira.fields = config.jira.fields || {};
if (process.env.JIRA_BASE_URL) config.jira.baseUrl = process.env.JIRA_BASE_URL;
if (process.env.JIRA_EMAIL) config.jira.email = process.env.JIRA_EMAIL;
if (process.env.JIRA_TOKEN) config.jira.token = process.env.JIRA_TOKEN;
if (process.env.JIRA_FIELDS_YESTERDAY) config.jira.fields.yesterday = process.env.JIRA_FIELDS_YESTERDAY;
if (process.env.JIRA_FIELDS_TODAY) config.jira.fields.today = process.env.JIRA_FIELDS_TODAY;
if (process.env.JIRA_FIELDS_BLOCKERS) config.jira.fields.blockers = process.env.JIRA_FIELDS_BLOCKERS;

const PORT        = Number(process.env.PORT)       || config.port      || 8080;
const HOST        = process.env.HOST               || config.host      || '127.0.0.1';
const ALLOW_REMOTE = process.env.ALLOW_REMOTE === '1' || config.allowRemote === true;
const VAULT_PATH  = process.env.VAULT_PATH          || path.resolve(APP_ROOT, config.vaultPath || '.');
const DAILY_DIR   = path.join(VAULT_PATH, 'daily');
const PROJECTS_DIR = path.join(VAULT_PATH, 'projects');
const DIST_DIR    = path.join(APP_ROOT, 'dist');
const HTML_FILE   = path.join(__dirname, 'daily.html');
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

  // ── Serve static (Vue dist) or fallback to legacy daily.html ───────────────
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
    // Legacy fallback
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch {
      res.writeHead(404); return res.end('No index found. Run: npm run build');
    }
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
      const { date, yesterday, today, blockers } = await readBody(req);
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

      logger.info({ date, key: issue.key, transitioned: !!done }, 'Standup submit completed');
      return jsonResp(res, 200, { ok: true, key: issue.key, transitioned: !!done });
    } catch (e) {
      logger.error({ err: e.message }, 'Standup submit failed');
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
