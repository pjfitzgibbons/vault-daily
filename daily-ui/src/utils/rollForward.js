// ── rollForward.js ────────────────────────────────────────────────────────────
// Pure functions. No Vue imports.

import { NOTES_PLACEHOLDER } from './parser.js'

const TICKET_RE   = /\b([A-Z]+-\d+)\b/g
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
const STATUS_SLUGS = new Set(['wip', 'in-review', 'reviewing', 'needs-qa', 'qa', 'done'])
const SIMPLE_PREFIX_RE = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s+/

/**
 * Transform a raw task body for use as a standup bullet.
 * - Strips ticket refs (collected into suffix)
 * - Strips wikilinks
 * - Normalises status prefix
 * - Optionally prepends "Continuing"
 */
export function transformForStandup(text, addContinuing) {
  const tickets = [...text.matchAll(TICKET_RE)].map(m => m[1])
  let c = text
    .replace(/\b[A-Z]+-\d+(?:\s*\/\s*[A-Z]+-\d+)*\s*-\s*/g, '')
    .replace(/\s*\/\s*\b[A-Z]+-\d+\b/g, '')
    .replace(/\b[A-Z]+-\d+\b/g, '')
    .replace(/^\s*-\s*/, '').replace(/\s*-\s*$/, '')
    .replace(/\s{2,}/g, ' ').trim()
    .replace(WIKILINK_RE, '$1')

  const suf = tickets.length ? ` (${tickets.join(', ')})` : ''
  const pm  = SIMPLE_PREFIX_RE.exec(c)
  if (pm && STATUS_SLUGS.has(pm[1])) {
    return `${pm[1]}: ${c.slice(pm[0].length).trim()}${suf}`
  }
  return addContinuing ? `Continuing ${c}${suf}` : `${c}${suf}`
}

/**
 * Build the full markdown string for the next daily note.
 * @param {string[]} completed  — checked-off tasks (body text)
 * @param {string[]} worked     — unchecked tasks flagged `>` (worked today) → Yesterday + Today
 * @param {string[]} remaining  — all other unchecked tasks → Today only
 * @param {string[]} onDeckWorked     — unchecked On Deck tasks flagged `>` → move into Tasks
 * @param {string[]} onDeckRemaining  — all other unchecked On Deck tasks → stay in On Deck
 */
export function buildNextDayContent(nextDate, completed, worked, remaining, onDeckWorked, onDeckRemaining) {
  const yesterdayItems = [...completed, ...worked]
  const todayItems     = [...worked, ...(onDeckWorked || []), ...remaining]
  const yesterday = yesterdayItems.length
    ? yesterdayItems.map(t => `- ${transformForStandup(t, false)}`).join('\n')
    : ''
  const today = todayItems.length
    ? todayItems.map(t => `- ${transformForStandup(t, true)}`).join('\n')
    : ''
  // Carry forward all unchecked tasks and worked-today items from On Deck.
  const allCarryOver = [...worked, ...remaining, ...(onDeckWorked || [])]
  const tasks   = allCarryOver.length ? allCarryOver.map(r => `- [ ] ${r}`).join('\n') : '- [ ] '
  const onDeckStr = (onDeckRemaining || []).filter(l => l.trim()).join('\n') || '- '

  return [
    '---', `date: ${nextDate}`, '---', '',
    `# ${nextDate}`, '',
    '## Standup',
    '**Yesterday:**',
    ...(yesterday ? yesterday.split('\n') : []),
    '**Today:**',
    ...(today ? today.split('\n') : []),
    '**Blockers:** ',
    '',
    '## Tasks',
    ...tasks.split('\n'),
    '',
    '## On Deck',
    ...onDeckStr.split('\n'),
    '',
    '## Notes',
    NOTES_PLACEHOLDER,
    '',
  ].join('\n')
}

/** Add one weekday to a YYYY-MM-DD string (skips Sat/Sun; Fri → Mon) */
export function addOneDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + 1)
  // Skip weekend: Sat → Mon (+2), Sun → Mon (+1)
  const day = dt.getDay()
  if (day === 6) dt.setDate(dt.getDate() + 2)
  else if (day === 0) dt.setDate(dt.getDate() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Subtract one weekday from a YYYY-MM-DD string (skips Sat/Sun; Mon → Fri) */
export function subOneDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  // Skip weekend: Sun → Fri (-2), Sat → Fri (-1)
  const day = dt.getDay()
  if (day === 0) dt.setDate(dt.getDate() - 2)
  else if (day === 6) dt.setDate(dt.getDate() - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Today as YYYY-MM-DD */
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
