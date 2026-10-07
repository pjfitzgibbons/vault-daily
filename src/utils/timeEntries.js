// ── timeEntries.js ────────────────────────────────────────────────────────────
// Pure functions. No Vue imports.

const RANGE_RE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/
const SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/
const COLUMNS = ['time', 'ticket', 'posting']

export function compactRange(label) {
  const m = RANGE_RE.exec(label || '')
  return m ? `${m[1]}${m[2]}-${m[3]}${m[4]}` : (label || '')
}

export function rowsFromDraft(draft) {
  return (draft?.blocks || []).map(b => ({
    time: compactRange(b.hour_label),
    ticket: b.dominant_ticket || '',
    posting: b.detail || '',
  }))
}

const escapeCell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
const unescapeCell = s => s.replace(/\\\|/g, '|').trim()

export function timeEntriesBodyLines(rows) {
  return [
    '| Time | Ticket | Posting Time |',
    '| --- | --- | --- |',
    ...rows.map(r => `| ${COLUMNS.map(c => escapeCell(r[c])).join(' | ')} |`),
    '',
  ]
}

export function parseTimeEntryRows(lines) {
  const tableLines = (lines || []).filter(l => l.trim().startsWith('|'))
  if (tableLines.length < 2 || !SEPARATOR_RE.test(tableLines[1].trim())) return []
  return tableLines.slice(2).map(line => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(unescapeCell)
    return Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i] ?? '']))
  })
}
