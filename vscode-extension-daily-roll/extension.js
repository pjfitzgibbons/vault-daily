'use strict';

const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

// ─── Jira / standup-cli config paths ────────────────────────────────────────
const STANDUP_CONFIG_PATH = path.join(os.homedir(), '.config', 'standup-cli', 'config.json');
const STANDUP_COOKIES_PATH = path.join(os.homedir(), '.config', 'standup-cli', 'cookies.json');

function loadStandupConfig() {
  if (!fs.existsSync(STANDUP_CONFIG_PATH)) {
    throw new Error(`standup-cli config not found at ${STANDUP_CONFIG_PATH}. Install standup-cli and run: standup-cli auth login`);
  }
  return JSON.parse(fs.readFileSync(STANDUP_CONFIG_PATH, 'utf8'));
}

function loadStandupCookies() {
  if (!fs.existsSync(STANDUP_COOKIES_PATH)) return null;
  const cookies = JSON.parse(fs.readFileSync(STANDUP_COOKIES_PATH, 'utf8'));
  return Array.isArray(cookies) && cookies.length ? cookies : null;
}

function cookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

class SessionExpiredError extends Error {
  constructor(status) {
    super(`Jira returned ${status}. Session expired.`);
    this.name = 'SessionExpiredError';
  }
}

/** Minimal HTTPS client — wraps Node's https.request as a Promise. */
function jiraRequest(base, cookieStr, method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = bodyObj != null ? JSON.stringify(bodyObj) : undefined;
    const url = new URL(`${base}${urlPath}`);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: cookieStr,
        ...(bodyStr ? { 'content-length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new SessionExpiredError(res.statusCode));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`Jira ${res.statusCode}: ${data}`));
        }
        if (res.statusCode === 204 || !data) return resolve(null);
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function makeJiraClient(config, cookies) {
  const base = config.jiraBaseUrl.replace(/\/$/, '');
  const cookieStr = cookieHeader(cookies);
  return (urlPath, init = {}) => jiraRequest(base, cookieStr, init.method || 'GET', urlPath, init.body);
}

// ─── Vault standup section parser ───────────────────────────────────────────
// Vault daily format uses **Yesterday:**, **Today:**, **Blockers:** bold labels
// inside a single ## Standup section (not separate ## headings like standup-cli).
function parseVaultStandupSection(docText) {
  const lines = String(docText || '').split(/\r?\n/);
  let inStandup = false;
  const standup = { yesterday: [], today: [], blockers: [] };
  let currentKey = null;
  const LABEL_MAP = {
    'yesterday:': 'yesterday',
    'today:': 'today',
    'blockers:': 'blockers'
  };

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (inStandup) break; // left Standup section
      if (headingMatch[1].trim().toLowerCase() === 'standup') {
        inStandup = true;
        continue;
      }
    }
    if (!inStandup) continue;

    const boldMatch = /^\*\*([^*]+)\*\*\s*$/.exec(line.trim());
    if (boldMatch) {
      const key = LABEL_MAP[boldMatch[1].trim().toLowerCase()];
      if (key) { currentKey = key; continue; }
    }

    if (currentKey) {
      const item = /^\s*-\s+(.+)/.exec(line);
      if (item) standup[currentKey].push(item[1].trim());
    }
  }

  return standup;
}

// ─── Minimal ADF builder ─────────────────────────────────────────────────────
function plainTextAdf(text) {
  if (!text) return { type: 'doc', version: 1, content: [] };
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function bulletListAdf(items) {
  if (!items || !items.length) return { type: 'doc', version: 1, content: [] };
  return {
    type: 'doc',
    version: 1,
    content: [{
      type: 'bulletList',
      content: items.map(text => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      }))
    }]
  };
}

function adfToText(adf) {
  if (!adf || typeof adf !== 'object') return '';
  const parts = [];
  const walk = node => {
    if (!node) return;
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
    if (node.type === 'hardBreak') parts.push('\n');
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
        if (['paragraph', 'listItem', 'codeBlock', 'heading'].includes(child.type)) parts.push('\n');
      }
    }
  };
  walk(adf);
  return parts.join('').replace(/\s+$/, '').trim();
}

// ─── Session expired handler ─────────────────────────────────────────────────
async function handleSessionExpired() {
  const term = vscode.window.createTerminal({ name: 'Jira Login' });
  term.sendText('standup-cli auth login');
  term.show();
}

// ─── submitStandup command ───────────────────────────────────────────────────
async function submitStandupToJira() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isVaultDailyFile(editor.document)) {
    vscode.window.showErrorMessage('Vault Daily: Open a vault daily file first.');
    return;
  }

  const dateParts = parseDateFromFilename(editor.document.fileName);
  if (!dateParts) {
    vscode.window.showErrorMessage('Vault Daily: Could not parse date from filename.');
    return;
  }
  const date = `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`;

  let config;
  try { config = loadStandupConfig(); } catch (e) {
    vscode.window.showErrorMessage(`Vault Daily: ${e.message}`);
    return;
  }

  const cookies = loadStandupCookies();
  if (!cookies) {
    vscode.window.showErrorMessage('Vault Daily: Not logged in. Run: standup-cli auth login');
    return;
  }

  const jiraFetch = makeJiraClient(config, cookies);
  const fieldIds = config.fields;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Submitting standup for ${date}…`, cancellable: false },
    async () => {
      let issue;
      try {
        const me = await jiraFetch('/rest/api/3/myself');
        const data = await jiraFetch('/rest/api/3/search/jql', {
          method: 'POST',
          body: {
            jql: `assignee = "${me.accountId}" AND summary ~ "standup" ORDER BY created DESC`,
            maxResults: 30,
            fields: ['key', 'summary', 'status', 'created', fieldIds.yesterday, fieldIds.today, fieldIds.impediments]
          }
        });
        issue = (data.issues || []).find(i => (i.fields.summary || '').includes(date));
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          await handleSessionExpired();
          return;
        }
        vscode.window.showErrorMessage(`Vault Daily: Jira search failed — ${e.message}`);
        return;
      }

      if (!issue) {
        vscode.window.showWarningMessage(`Vault Daily: No standup card found for ${date} in Jira.`);
        return;
      }

      const { yesterday, today, blockers } = parseVaultStandupSection(editor.document.getText());
      const blockersText = blockers.length ? blockers.join(', ') : (config.defaults?.impediments || 'None');

      const updates = [
        { id: fieldIds.yesterday, adf: bulletListAdf(yesterday), label: 'Yesterday' },
        { id: fieldIds.today,     adf: bulletListAdf(today),     label: 'Today' },
        { id: fieldIds.impediments, adf: plainTextAdf(blockersText), label: 'Blockers' }
      ];

      const results = {};
      try {
        for (const { id, adf, label } of updates) {
          const current = issue.fields[id];
          if (adfToText(adf) === adfToText(current)) { results[label] = 'unchanged'; continue; }
          await jiraFetch(`/rest/api/3/issue/${issue.key}`, {
            method: 'PUT',
            body: { fields: { [id]: adf } }
          });
          results[label] = 'updated';
        }
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          await handleSessionExpired();
          return;
        }
        vscode.window.showErrorMessage(`Vault Daily: Failed to update ${issue.key} — ${e.message}`);
        return;
      }

      // Transition to Done
      try {
        const { transitions } = await jiraFetch(`/rest/api/3/issue/${issue.key}/transitions`);
        const target = transitions.find(t => {
          const n = (t.name || '').toLowerCase();
          const to = (t.to?.name || '').toLowerCase();
          return n === 'done' || n.includes('done') || to === 'done';
        });
        if (target) {
          await jiraFetch(`/rest/api/3/issue/${issue.key}/transitions`, {
            method: 'POST',
            body: { transition: { id: target.id } }
          });
          results['Status'] = 'Done';
        } else {
          results['Status'] = 'no Done transition found';
        }
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          await handleSessionExpired();
          return;
        }
        results['Status'] = `transition failed: ${e.message}`;
      }

      const summary = Object.entries(results).map(([k, v]) => `${k}: ${v}`).join(', ');
      const issueUrl = `${config.jiraBaseUrl.replace(/\/$/, '')}/browse/${issue.key}`;
      vscode.window.showInformationMessage(
        `Vault Daily: ${issue.key} — ${summary}`,
        'Open in Jira'
      ).then(sel => { if (sel === 'Open in Jira') vscode.env.openExternal(vscode.Uri.parse(issueUrl)); });
    }
  );
}

const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const NOTES_PLACEHOLDER = '<!-- Cmd+; inserts the current time (HH:MM) at the cursor -->';

function parseDateFromFilename(fileName) {
  const base = path.basename(fileName);
  const match = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(base);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function addOneDay(dateParts) {
  const d = new Date(dateParts.year, dateParts.month - 1, dateParts.day);
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTaskText(text) {
  return String(text || '').trim();
}

function extractSection(docText, heading) {
  const lines = String(docText || '').split(/\r?\n/);
  const normalizedHeading = String(heading || '').trim().toLowerCase();

  let inSection = false;
  const buffer = [];

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const currentHeading = headingMatch[1].trim().toLowerCase();
      if (inSection && currentHeading !== normalizedHeading) {
        break;
      }
      inSection = currentHeading === normalizedHeading;
      continue;
    }

    if (inSection) buffer.push(line);
  }

  return buffer.join('\n');
}

function parseTasks(tasksSection) {
  const lines = String(tasksSection || '').split(/\r?\n/);
  const completed = [];
  const remaining = [];

  for (const line of lines) {
    const done = /^\s*-\s*\[x\]\s*(.+?)\s*$/i.exec(line);
    if (done) {
      const text = normalizeTaskText(done[1]);
      if (text) completed.push(text);
      continue;
    }

    const todo = /^\s*-\s*\[(?:\s)?\]\s*(.+?)\s*$/.exec(line);
    if (todo) {
      const text = normalizeTaskText(todo[1]);
      if (text) remaining.push(text);
    }
  }

  return { completed, remaining };
}

function parseTasksWithFallback(fullText) {
  const tasksSection = extractSection(fullText, 'Tasks');
  const fromSection = parseTasks(tasksSection);

  // If Tasks heading parsing misses for any reason, fall back to scanning the full doc.
  if (fromSection.completed.length || fromSection.remaining.length) {
    return fromSection;
  }

  return parseTasks(fullText);
}

const TICKET_RE = /\b([A-Z]+-\d+)\b/g;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
// A status prefix is one or more lowercase hyphenated words before the body text
const STATUS_PREFIX_RE = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\s+[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*)\s+/;

const TASK_STATUSES = [
  { slug: 'wip',        label: 'WIP',        display: '● WIP',        color: '#6b9bd2' },
  { slug: 'reviewing',  label: 'Reviewing',  display: '● Reviewing',  color: '#e5a550' },
  { slug: 'in-review',  label: 'In-Review',  display: '● In-Review',  color: '#d4a017' },
  { slug: 'needs-qa',   label: 'Needs-QA',   display: '● Needs-QA',   color: '#c586c0' },
  { slug: 'qa',         label: 'QA',         display: '● QA',         color: '#c586c0' },
  { slug: 'done',       label: 'Done',       display: '● Done',       color: '#4ec9b0' },
];
const STATUS_SLUGS = new Set(TASK_STATUSES.map(s => s.slug));

function getTaskLineStatus(lineText) {
  if (/^\s*-\s*\[x\]\s*/i.test(lineText)) return 'done';
  const bodyMatch = /^\s*-\s*\[\s\]\s*(.+)$/.exec(lineText);
  if (!bodyMatch) return 'wip';
  const prefixMatch = STATUS_PREFIX_RE.exec(bodyMatch[1]);
  if (prefixMatch && STATUS_SLUGS.has(prefixMatch[1])) return prefixMatch[1];
  return 'wip';
}

function rewriteTaskStatus(lineText, newSlug) {
  const indentMatch = /^(\s*)/.exec(lineText);
  const indent = indentMatch ? indentMatch[1] : '';
  const bodyMatch = /^\s*-\s*\[[x ]\]\s*(.+)$/i.exec(lineText);
  if (!bodyMatch) return lineText;

  let body = bodyMatch[1];
  const prefixMatch = STATUS_PREFIX_RE.exec(body);
  if (prefixMatch && STATUS_SLUGS.has(prefixMatch[1])) {
    body = body.slice(prefixMatch[0].length);
  }

  if (newSlug === 'done') return `${indent}- [x] ${body}`;
  if (newSlug === 'wip')  return `${indent}- [ ] ${body}`;
  return `${indent}- [ ] ${newSlug} ${body}`;
}

function transformForStandup(rawText, addContinuing) {
  const text = String(rawText || '').trim();

  // 1. Collect all ticket refs
  const tickets = [...text.matchAll(TICKET_RE)].map(m => m[1]);

  // 2. Strip ticket refs and surrounding noise ("TICKET - ", "/ TICKET", "TICKET / TICKET - ")
  let cleaned = text
    .replace(/\b[A-Z]+-\d+(?:\s*\/\s*[A-Z]+-\d+)*\s*-\s*/g, '') // "TICKET - " or "TICKET / TICKET - "
    .replace(/\s*\/\s*\b[A-Z]+-\d+\b/g, '')                       // remaining " / TICKET"
    .replace(/\b[A-Z]+-\d+\b/g, '')                                // any leftover bare ticket
    .replace(/^\s*-\s*/, '')   // leading orphan " - "
    .replace(/\s*-\s*$/, '')   // trailing orphan " - "
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 3. Un-wikilink: [[Project Name]] -> Project Name
  cleaned = cleaned.replace(WIKILINK_RE, '$1');

  // 4. Detect existing status prefix (lowercase words before the real body)
  const statusMatch = STATUS_PREFIX_RE.exec(cleaned);
  const ticketSuffix = tickets.length ? ` (${tickets.join(', ')})` : '';

  if (statusMatch) {
    const prefix = statusMatch[1];
    const body = cleaned.slice(statusMatch[0].length).trim();
    return `${prefix}: ${body}${ticketSuffix}`;
  }

  if (addContinuing) {
    return `Continuing ${cleaned}${ticketSuffix}`;
  }

  return `${cleaned}${ticketSuffix}`;
}

function renderBulletList(items, fallback, addContinuing = false) {
  if (!items.length) return fallback;
  return items.map(item => `- ${transformForStandup(item, addContinuing)}`).join('\n');
}

function renderTaskChecklist(items) {
  if (!items.length) return '- [ ] ';
  return items.map(item => `- [ ] ${item}`).join('\n');
}

function buildNextDayContent(nextDate, completed, remaining, onDeck) {
  const parts = [
    '---',
    `date: ${nextDate}`,
    '---',
    '',
    `# ${nextDate}`,
    '',
    '## Standup',
    '**Yesterday:**',
    renderBulletList(completed, '- ', false),
    '**Today:**',
    renderBulletList(remaining, '- ', true),
    '**Blockers:** ',
    '',
    '## Tasks',
    renderTaskChecklist(remaining),
    '',
    '## On Deck',
    onDeck || '- ',
    '',
    '## Notes',
    NOTES_PLACEHOLDER,
    ''
  ];
  return parts.join('\n');
}

function isVaultDailyFile(document) {
  if (document.languageId !== 'markdown') return false;
  const fileName = path.basename(document.uri.fsPath);
  if (!DAILY_FILE_RE.test(fileName)) return false;

  const normalized = document.uri.fsPath.split(path.sep).join('/');
  return /\/daily\/\d{4}-\d{2}-\d{2}\.md$/.test(normalized);
}

function buildStatusDecorationTypes() {
  const COLUMN_WIDTH = 14; // fixed chars; adjust if labels grow
  const types = {};
  for (const s of TASK_STATUSES) {
    const pad = '\u00a0'.repeat(COLUMN_WIDTH - s.display.length);
    types[s.slug] = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: `\u00a0${s.display}${pad}`,
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'normal',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }
  return types;
}

function buildSlugHiderDecoration() {
  return vscode.window.createTextEditorDecorationType({
    color: 'rgba(0,0,0,0)',
    textDecoration: 'none; font-size: 0px',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

function applyTaskStatusDecorations(editor, decorationTypes, slugHider) {
  if (!editor || !isVaultDailyFile(editor.document)) {
    for (const t of Object.values(decorationTypes)) editor.setDecorations(t, []);
    editor && editor.setDecorations(slugHider, []);
    return;
  }

  const document = editor.document;
  const lines = document.getText().split(/\r?\n/);
  const buckets = {};
  for (const s of TASK_STATUSES) buckets[s.slug] = [];
  const slugRanges = [];

  let inTasksSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      inTasksSection = headingMatch[1].trim().toLowerCase() === 'tasks';
      continue;
    }
    if (!inTasksSection) continue;
    if (!/^\s*-\s*\[[x ]\]\s*/i.test(line)) continue;

    const slug = getTaskLineStatus(line);
    const checkboxMatch = /^\s*-\s*\[[x ]\]/.exec(line);
    const afterCheckbox = checkboxMatch ? checkboxMatch[0].length : line.length;
    const range = new vscode.Range(i, afterCheckbox, i, afterCheckbox);
    buckets[slug].push({ range });

    // Hide from after ] through slug + trailing space so task text aligns to badge
    if (slug !== 'wip' && slug !== 'done') {
      const bodyMatch = /^\s*-\s*\[\s\]\s*/.exec(line);
      if (bodyMatch) {
        const slugEnd = bodyMatch[0].length + slug.length + 1; // +1 for space after slug
        slugRanges.push(new vscode.Range(i, afterCheckbox + 1, i, Math.min(slugEnd, line.length)));
      }
    }
  }

  for (const [slug, ranges] of Object.entries(buckets)) {
    editor.setDecorations(decorationTypes[slug], ranges);
  }
  editor.setDecorations(slugHider, slugRanges);
}

class DailyRollCodeLensProvider {
  provideCodeLenses(document) {
    if (!isVaultDailyFile(document)) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: '$(arrow-right) Roll Forward',
        command: 'vaultDaily.rollForward',
        tooltip: 'Create next day note and roll tasks into Standup'
      }),
      new vscode.CodeLens(range, {
        title: '$(cloud-upload) Submit to Jira',
        command: 'vaultDaily.submitStandup',
        tooltip: 'Find matching Jira standup card for this date and update Yesterday/Today/Blockers'
      })
    ];
  }
}

async function setTaskStatus() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isVaultDailyFile(editor.document)) {
    vscode.window.showErrorMessage('Vault Daily Roll: Open a vault daily file first.');
    return;
  }
  const document = editor.document;
  const lineIndex = editor.selection.active.line;
  const lineObj = document.lineAt(lineIndex);
  if (!/^\s*-\s*\[[x ]\]/i.test(lineObj.text)) {
    vscode.window.showErrorMessage('Vault Daily Roll: Cursor is not on a task line.');
    return;
  }
  const uri = document.uri;
  const currentStatus = getTaskLineStatus(lineObj.text);

  const items = TASK_STATUSES.map(s => ({
    label: s.display,
    description: s.slug === currentStatus ? '(current)' : undefined,
    slug: s.slug
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Set Task Status',
    placeHolder: 'Select a status for this task'
  });

  if (!picked || picked.slug === currentStatus) return;

  const newLineText = rewriteTaskStatus(lineObj.text, picked.slug);
  const wsEdit = new vscode.WorkspaceEdit();
  wsEdit.replace(uri, lineObj.range, newLineText);
  await vscode.workspace.applyEdit(wsEdit);
}

async function rollForwardFromActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Vault Daily Roll: No active editor.');
    return;
  }

  const document = editor.document;
  if (!isVaultDailyFile(document)) {
    vscode.window.showErrorMessage('Vault Daily Roll: Open a file in vault/daily/YYYY-MM-DD.md first.');
    return;
  }

  const dateParts = parseDateFromFilename(document.fileName);
  if (!dateParts) {
    vscode.window.showErrorMessage('Vault Daily Roll: Unable to read date from file name.');
    return;
  }

  const nextDate = addOneDay(dateParts);
  const nextPath = path.join(path.dirname(document.uri.fsPath), `${nextDate}.md`);

  if (fs.existsSync(nextPath)) {
    vscode.window.showWarningMessage(`Vault Daily Roll: ${path.basename(nextPath)} already exists.`);
    return;
  }

  const fullText = document.getText();
  const { completed, remaining } = parseTasksWithFallback(fullText);
  const onDeck = extractSection(fullText, 'On Deck').trim() || '- ';

  const nextContent = buildNextDayContent(nextDate, completed, remaining, onDeck);
  fs.writeFileSync(nextPath, nextContent, 'utf8');

  const nextUri = vscode.Uri.file(nextPath);
  const opened = await vscode.workspace.openTextDocument(nextUri);
  await vscode.window.showTextDocument(opened, { preview: false });

  vscode.window.showInformationMessage(
    `Vault Daily Roll: Created ${path.basename(nextPath)} ` +
      `(${completed.length} completed -> Yesterday, ${remaining.length} remaining -> Today/Tasks).`
  );
}

function activate(context) {
  const decorationTypes = buildStatusDecorationTypes();
  const slugHider = buildSlugHiderDecoration();

  function refresh(editor) {
    applyTaskStatusDecorations(editor, decorationTypes, slugHider);
  }

  // Apply to whichever editor is active on startup
  refresh(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.commands.registerCommand('vaultDaily.rollForward', rollForwardFromActiveEditor),
    vscode.commands.registerCommand('vaultDaily.setTaskStatus', setTaskStatus),
    vscode.commands.registerCommand('vaultDaily.submitStandup', submitStandupToJira),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'markdown', pattern: '**/daily/*.md' },
      new DailyRollCodeLensProvider()
    ),
    vscode.window.onDidChangeActiveTextEditor(editor => refresh(editor)),
    vscode.workspace.onDidChangeTextDocument(e => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) refresh(editor);
    }),
    ...Object.values(decorationTypes),
    slugHider
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
