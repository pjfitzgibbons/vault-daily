'use strict';

const http  = require('node:http');
const https = require('node:https');
const fs    = require('node:fs');
const path  = require('node:path');
const url   = require('node:url');

// ── Config ─────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  console.warn('No config.json found — using defaults (copy config.json.example → config.json).');
}

const PORT        = Number(process.env.PORT)       || config.port      || 8080;
const VAULT_PATH  = process.env.VAULT_PATH          || path.resolve(__dirname, config.vaultPath || '.');
const DAILY_DIR   = path.join(VAULT_PATH, 'daily');
const PROJECTS_DIR = path.join(VAULT_PATH, 'projects');
const DIST_DIR    = path.join(__dirname, 'dist');
const HTML_FILE   = path.join(__dirname, 'daily.html');
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;

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

// ── Jira (server-side proxy — no CORS) ────────────────────────────────────────
function jiraReq(urlPath, method, bodyObj) {
  const j = config.jira || {};
  const base = (j.baseUrl || '').replace(/\/$/, '');
  if (!base || !j.email || !j.token)
    return Promise.reject(new Error('Jira not configured — set jira.baseUrl/email/token in config.json'));

  const auth   = Buffer.from(`${j.email}:${j.token}`).toString('base64');
  const body   = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const target = new URL(`${base}${urlPath}`);

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
  if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    res.writeHead(403); return res.end('Forbidden');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');

  const { pathname } = url.parse(req.url);
  const method = req.method.toUpperCase();

  // OPTIONS preflight (for local fetch)
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': 'http://localhost:' + PORT,
                         'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
                         'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // ── Serve static (Vue dist) or fallback to legacy daily.html ───────────────
  if (!pathname.startsWith('/api/')) {
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
      res.writeHead(404); return res.end('No index found. Run: cd daily-ui && npm run build');
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
  if (pathname === '/api/jira/standup' && method === 'POST') {
    try {
      const { date, yesterday, today, blockers } = await readBody(req);
      const fields = (config.jira || {}).fields || {};

      const me = await jiraReq('/rest/api/3/myself', 'GET');
      const data = await jiraReq('/rest/api/3/search/jql', 'POST', {
        jql: `assignee="${me.accountId}" AND summary~"standup" ORDER BY created DESC`,
        maxResults: 30,
        fields: ['key', 'summary'],
      });

      const issue = (data.issues || []).find(i => (i.fields.summary || '').includes(date));
      if (!issue) return jsonResp(res, 404, { error: `No standup card found for ${date}` });

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
        await jiraReq(`/rest/api/3/issue/${issue.key}`, 'PUT', { fields: fieldData });
      }

      const { transitions } = await jiraReq(`/rest/api/3/issue/${issue.key}/transitions`, 'GET');
      const done = (transitions || []).find(t =>
        (t.name || '').toLowerCase().includes('done') ||
        (t.to?.name || '').toLowerCase() === 'done'
      );
      if (done) {
        await jiraReq(`/rest/api/3/issue/${issue.key}/transitions`, 'POST',
          { transition: { id: done.id } });
      }

      return jsonResp(res, 200, { ok: true, key: issue.key, transitioned: !!done });
    } catch (e) {
      return jsonResp(res, 500, { error: e.message });
    }
  }

  res.writeHead(404); res.end('API route not found');
}

// ── Start ──────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(e);
    try { res.writeHead(500); res.end('Internal error'); } catch {}
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vault Daily  →  http://localhost:${PORT}`);
  console.log(`Vault path   →  ${VAULT_PATH}`);
  console.log(`Daily files  →  ${DAILY_DIR}`);
});
