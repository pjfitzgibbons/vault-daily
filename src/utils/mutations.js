// ── mutations.js ──────────────────────────────────────────────────────────────
// Pure functions that return a new rawContent string. No Vue imports.

import { STATUS_SLUGS, NOTES_PLACEHOLDER } from './parser.js'

const SIMPLE_PREFIX_RE = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s+/

const WORKED_FLAG_RE = /^> /

/**
 * Ensure the "worked today" (`> `) flag is present on an unchecked task line.
 * The flag always sits immediately after `- [ ] `, before the status prefix.
 * No-op on done ([x]) lines or lines already flagged.
 */
export function ensureWorkedFlagOnLine(lineText) {
  const m = /^(\s*-\s*\[ \]\s*)(.+)$/.exec(lineText)
  if (!m) return lineText
  const lead = m[1], body = m[2]
  if (WORKED_FLAG_RE.test(body)) return lineText // already set
  return `${lead}> ${body}`
}

/**
 * Rewrite a raw task line to the given status slug.
 * 'done' → - [x] <body>
 * 'wip'  → - [ ] <body>
 * other  → - [ ] <slug> <body>
 * Preserves the worked-today `> ` flag on non-done lines.
 */
export function rewriteTaskStatus(lineText, newSlug) {
  const indent = /^(\s*)/.exec(lineText)[1]
  const m = /^\s*-\s*\[[x ]\]\s*(.+)$/i.exec(lineText)
  if (!m) return lineText
  let text = m[1]
  // Detect and strip worked-today flag first (always at position 0: '> ')
  const wm = /^> /.exec(text)
  const flag = wm ? '> ' : ''
  if (wm) text = text.slice(2)
  // Strip existing status prefix
  const pm = SIMPLE_PREFIX_RE.exec(text)
  if (pm && STATUS_SLUGS.has(pm[1])) text = text.slice(pm[0].length)
  if (newSlug === 'done') return `${indent}- [x] ${text}`
  if (newSlug === 'wip')  return `${indent}- [ ] ${flag}${text}`
  return `${indent}- [ ] ${flag}${newSlug} ${text}`
}

/**
 * Replace one exact raw line in rawContent.
 */
export function replaceLine(rawContent, oldLine, newLine) {
  // Use split/join to avoid regex special chars in oldLine
  const idx = rawContent.indexOf(oldLine)
  if (idx === -1) return rawContent
  return rawContent.slice(0, idx) + newLine + rawContent.slice(idx + oldLine.length)
}

/**
 * Edit the body text of a task line, preserving checkbox + status prefix.
 * Auto-sets the worked-today flag on unchecked tasks (editing = you worked on it).
 */
export function editTaskBody(rawContent, oldRaw, newBody) {
  const indent = /^(\s*)/.exec(oldRaw)[1]
  const m = /^\s*-\s*\[([x ])\]\s*(.+)$/i.exec(oldRaw)
  if (!m) return rawContent
  const cbChar = m[1], rest = m[2]
  const pm = SIMPLE_PREFIX_RE.exec(rest)
  const prefix = (pm && STATUS_SLUGS.has(pm[1])) ? pm[1] + ' ' : ''
  // Preserve worked flag; auto-set for unchecked tasks (editing = you worked on it)
  const alreadyFlagged = /^> /.test(rest)
  const flag = cbChar === ' ' ? '> ' : ''
  // Strip existing '> ' if present before prefix
  const bodyAfterFlag = alreadyFlagged ? rest.slice(2) : rest
  const bodyPm = SIMPLE_PREFIX_RE.exec(bodyAfterFlag)
  const bodyPrefix = (bodyPm && STATUS_SLUGS.has(bodyPm[1])) ? bodyPm[1] + ' ' : ''
  const newRaw = `${indent}- [${cbChar}] ${flag}${bodyPrefix}${newBody}`
  return replaceLine(rawContent, oldRaw, newRaw)
}

/**
 * Toggle the "worked today" flag (`> `) on an unchecked task line.
 * The flag always sits immediately after `- [ ] `, before any status prefix.
 * Has no effect on checked [x] lines.
 */
export function toggleWorkedToday(rawContent, rawLine) {
  const indent = /^(\s*)/.exec(rawLine)[1]
  const m = /^\s*-\s*\[ \]\s*(.+)$/.exec(rawLine)
  if (!m) return rawContent
  const body = m[1]
  const newBody = /^> /.test(body) ? body.slice(2) : `> ${body}`
  return replaceLine(rawContent, rawLine, `${indent}- [ ] ${newBody}`)
}

/**
 * Add a new task line to the end of the named section (before next ## or EOF).
 */
export function addTaskToSection(rawContent, sectionName, text) {
  const newLine = `- [ ] ${text}`
  const lines = rawContent.split(/\r?\n/)
  let inSection = false
  let insertAt = -1

  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+)/.exec(lines[i])
    if (h2) {
      if (inSection) { insertAt = i; break }
      inSection = h2[1].trim() === sectionName
      continue
    }
    if (inSection && lines[i].trim()) insertAt = i + 1
  }
  if (inSection && insertAt === -1) insertAt = lines.length
  if (insertAt === -1) return rawContent

  lines.splice(insertAt, 0, newLine)
  return lines.join('\n')
}

/**
 * Remove one exact raw line from rawContent.
 */
export function deleteTaskFromSection(rawContent, rawLine) {
  const lines = rawContent.split(/\r?\n/)
  const idx = lines.indexOf(rawLine)
  if (idx !== -1) lines.splice(idx, 1)
  return lines.join('\n')
}

/**
 * Rebuild the Standup section in-place.
 * standup = { yesterday: string[], today: string[], blockers: string }
 */
export function rebuildStandupSection(rawContent, standup) {
  const normLines = val =>
    String(val || '').split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => l.startsWith('-') ? l : `- ${l}`)

  const newLines = [
    '**Yesterday:**',
    ...normLines(standup.yesterday.join('\n')),
    '**Today:**',
    ...normLines(standup.today.join('\n')),
    `**Blockers:** ${standup.blockers || ''}`,
  ]

  const lines = rawContent.split(/\r?\n/)
  const out = []
  let skip = false

  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+)/.exec(lines[i])
    if (h2) {
      if (skip) {
        // We were skipping Standup; now emit the new lines then this heading
        out.push(...newLines, '')
        skip = false
      }
      if (h2[1].trim() === 'Standup') {
        out.push(lines[i])
        skip = true
        continue
      }
    }
    if (skip) continue
    out.push(lines[i])
  }
  if (skip) out.push(...newLines, '')

  return out.join('\n')
}

/**
 * Rebuild the Notes section in-place.
 */
export function rebuildNotesSection(rawContent, notesText) {
  const lines = rawContent.split(/\r?\n/)
  const out = []
  let skip = false

  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+)/.exec(lines[i])
    if (h2) {
      if (skip) {
        out.push(...notesText.split('\n'))
        skip = false
      }
      if (h2[1].trim() === 'Notes') {
        out.push(lines[i])
        skip = true
        continue
      }
    }
    if (skip) continue
    out.push(lines[i])
  }
  if (skip) out.push(...notesText.split('\n'))

  return out.join('\n')
}

/**
 * Build a complete file string for a brand-new daily note.
 */
export function buildFreshContent(date) {
  return [
    '---', `date: ${date}`, '---', '',
    `# ${date}`, '',
    '## Standup',
    '**Yesterday:**',
    '**Today:**',
    '**Blockers:** ',
    '',
    '## Tasks',
    '- [ ] ',
    '',
    '## On Deck',
    '- ',
    '',
    '## Notes',
    NOTES_PLACEHOLDER,
    '',
  ].join('\n')
}
