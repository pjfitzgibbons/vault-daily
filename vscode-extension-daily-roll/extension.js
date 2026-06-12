'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

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

class DailyRollCodeLensProvider {
  provideCodeLenses(document) {
    if (!isVaultDailyFile(document)) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: '$(arrow-right) Roll Forward',
        command: 'vaultDaily.rollForward',
        tooltip: 'Create next day note and roll tasks into Standup'
      })
    ];
  }
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
  context.subscriptions.push(
    vscode.commands.registerCommand('vaultDaily.rollForward', rollForwardFromActiveEditor),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'markdown', pattern: '**/daily/*.md' },
      new DailyRollCodeLensProvider()
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
