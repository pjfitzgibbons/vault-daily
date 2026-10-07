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
 * Force the "worked today" (`> `) flag on an unchecked task line to the
 * given boolean state. No-op on done ([x]) lines.
 */
export function setWorkedFlag(lineText, flag) {
  const m = /^(\s*-\s*\[ \]\s*)(.+)$/.exec(lineText)
  if (!m) return lineText
  const lead = m[1]
  let body = m[2]
  const has = WORKED_FLAG_RE.test(body)
  if (flag && !has) body = `> ${body}`
  if (!flag && has) body = body.slice(2)
  return `${lead}${body}`
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
 * Set (or add) a `key: value` line inside the leading frontmatter block
 * (`---\n...\n---`). No-op if the file has no frontmatter block.
 */
export function setFrontmatterField(rawContent, key, value) {
  const lines = rawContent.split(/\r?\n/)
  if (lines[0] !== '---') return rawContent
  const end = lines.indexOf('---', 1)
  if (end < 0) return rawContent

  const fieldRe = new RegExp(`^${key}:\\s*`)
  const idx = lines.slice(1, end).findIndex(l => fieldRe.test(l))
  if (idx >= 0) {
    lines[1 + idx] = `${key}: ${value}`
  } else {
    lines.splice(end, 0, `${key}: ${value}`)
  }
  return lines.join('\n')
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
export function editTaskBody(rawContent, oldRaw, newBody, { autoWorked = true } = {}) {
  const indent = /^(\s*)/.exec(oldRaw)[1]
  const m = /^\s*-\s*\[([x ])\]\s*(.+)$/i.exec(oldRaw)
  if (!m) return rawContent
  const cbChar = m[1], rest = m[2]
  const alreadyFlagged = /^> /.test(rest)
  // Editing a Tasks item marks it worked; editing an On Deck item must not, or it would move at once
  const flag = cbChar === ' ' && (autoWorked || alreadyFlagged) ? '> ' : ''
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

export const TASK_DRAG_MIME = 'application/x-vault-task'

// [start, end) line indices of a section body; start is the heading line.
function sectionBounds(lines, name) {
  const start = lines.findIndex(l => {
    const h2 = /^##\s+(.+)/.exec(l)
    return h2 && h2[1].trim() === name
  })
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++
  return { start, end }
}

// Inserts after the section's last non-blank line, or before the next heading if it has none.
function insertIntoSection(lines, sectionName, newLine) {
  const b = sectionBounds(lines, sectionName)
  if (!b) return false
  let insertAt = b.end
  for (let i = b.end - 1; i > b.start; i--) {
    if (lines[i].trim()) { insertAt = i + 1; break }
  }
  lines.splice(insertAt, 0, newLine)
  return true
}

function removeFromSection(lines, sectionName, rawLine) {
  const b = sectionBounds(lines, sectionName)
  if (!b) return false
  const idx = lines.indexOf(rawLine, b.start + 1)
  if (idx < 0 || idx >= b.end) return false
  lines.splice(idx, 1)
  return true
}

/**
 * Add a new task line to the end of the named section (before next ## or EOF).
 */
export function addTaskToSection(rawContent, sectionName, text) {
  const lines = rawContent.split(/\r?\n/)
  if (!insertIntoSection(lines, sectionName, `- [ ] ${text}`)) return rawContent
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
 * Reduce a task line to a plain unchecked, unflagged, status-less `- [ ] body`.
 * Used when a task is dropped onto On Deck, where a settled state would bounce it back.
 */
export function plainTaskLine(lineText) {
  const m = /^\s*-\s*\[[x ]\]\s*(.+)$/i.exec(lineText)
  if (!m) return lineText
  let body = m[1]
  if (WORKED_FLAG_RE.test(body)) body = body.slice(2)
  const pm = SIMPLE_PREFIX_RE.exec(body)
  if (pm && STATUS_SLUGS.has(pm[1])) body = body.slice(pm[0].length)
  return `- [ ] ${body}`
}

/**
 * An On Deck line is "settled" when it is checked, worked-today flagged, or has a non-WIP status.
 */
export function isSettledTask(lineText) {
  const m = /^\s*-\s*\[([x ])\]\s*(.+)$/i.exec(lineText)
  if (!m) return false
  if (m[1].toLowerCase() === 'x') return true
  const body = m[2]
  if (WORKED_FLAG_RE.test(body)) return true
  const pm = SIMPLE_PREFIX_RE.exec(body)
  return !!pm && STATUS_SLUGS.has(pm[1]) && pm[1] !== 'wip'
}

/**
 * Move one exact task line from one section to the end of another.
 * Lines landing on On Deck are normalised via plainTaskLine.
 */
export function moveTaskBetweenSections(rawContent, fromSection, toSection, rawLine) {
  const lines = rawContent.split(/\r?\n/)
  if (!removeFromSection(lines, fromSection, rawLine)) return rawContent
  const moved = toSection === 'On Deck' ? plainTaskLine(rawLine) : rawLine
  if (!insertIntoSection(lines, toSection, moved)) return rawContent
  return lines.join('\n')
}

/**
 * Move every settled On Deck line to the end of Tasks.
 */
export function promoteSettledOnDeck(rawContent) {
  const lines = rawContent.split(/\r?\n/)
  if (!sectionBounds(lines, 'On Deck') || !sectionBounds(lines, 'Tasks')) return rawContent
  const b = sectionBounds(lines, 'On Deck')
  const settled = lines.slice(b.start + 1, b.end).filter(isSettledTask)
  if (!settled.length) return rawContent
  for (const line of settled) {
    removeFromSection(lines, 'On Deck', line)
    insertIntoSection(lines, 'Tasks', line)
  }
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
 * Rebuild the Weekly Update section in-place.
 * Mirrors rebuildNotesSection: replaces everything under `## Weekly Update`
 * up to the next `## ` heading (or EOF). No-op if the section is absent.
 */
export function rebuildWeeklyUpdateSection(rawContent, weeklyText) {
  const lines = rawContent.split(/\r?\n/)
  const out = []
  let skip = false

  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+)/.exec(lines[i])
    if (h2) {
      if (skip) {
        out.push(...weeklyText.split('\n'))
        skip = false
      }
      if (h2[1].trim() === 'Weekly Update') {
        out.push(lines[i])
        skip = true
        continue
      }
    }
    if (skip) continue
    out.push(lines[i])
  }
  if (skip) out.push(...weeklyText.split('\n'))

  return out.join('\n')
}

/**
 * Replace the body of a named `## ` section, appending the section if absent.
 */
export function setSectionBody(rawContent, name, bodyLines) {
  const lines = rawContent.split(/\r?\n/)
  const b = sectionBounds(lines, name)
  if (!b) {
    const sep = lines[lines.length - 1] === '' ? [] : ['']
    return [...lines, ...sep, `## ${name}`, ...bodyLines, ''].join('\n')
  }
  lines.splice(b.start + 1, b.end - b.start - 1, ...bodyLines, '')
  return lines.join('\n')
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
