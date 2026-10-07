// ── parser.js ─────────────────────────────────────────────────────────────────
// Pure functions. No Vue imports.

export const NOTES_PLACEHOLDER = '<!-- Cmd+; inserts the current time (HH:MM) at the cursor -->'

const SIMPLE_PREFIX_RE = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s+/
export const STATUS_SLUGS = new Set(['wip', 'in-review', 'reviewing', 'needs-qa', 'qa', 'done'])
// Colours are CSS custom-property references so task-status badges follow the
// active light/dark theme (tokens defined in App.vue). Applied via inline
// `style="color: …"`, which the browser resolves against <html data-theme>.
export const STATUS_LIST = [
  { slug: 'wip',       label: 'WIP',       color: 'var(--c-status-wip)' },
  { slug: 'in-review', label: 'In-Review', color: 'var(--c-warn)' },
  { slug: 'reviewing', label: 'Reviewing', color: 'var(--c-status-reviewing)' },
  { slug: 'needs-qa',  label: 'Needs-QA',  color: 'var(--c-status-qa)' },
  { slug: 'qa',        label: 'QA',        color: 'var(--c-status-qa)' },
  { slug: 'done',      label: 'Done',       color: 'var(--c-done)' },
]
export const STATUS_COLORS = Object.fromEntries(STATUS_LIST.map(s => [s.slug, s.color]))

/**
 * Read a single `key: value` line out of a frontmatter block string (as
 * returned by parseSections — includes the `---` delimiters). Returns the
 * trimmed string value, or null if the key isn't present.
 */
export function parseFrontmatterField(frontmatter, key) {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm')
  const m = re.exec(frontmatter || '')
  return m ? m[1].trim() : null
}

/**
 * Split rawContent into named sections.
 * Returns { frontmatter, titleLine, order, sections: { name → string[] } }
 */
export function parseSections(content) {
  const lines = String(content || '').split(/\r?\n/)
  let i = 0
  let frontmatter = ''
  let titleLine = ''

  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      frontmatter = lines.slice(0, end + 1).join('\n')
      i = end + 1
    }
  }

  const order = []
  const sections = {}
  let cur = null

  for (; i < lines.length; i++) {
    const h1 = /^#\s+/.exec(lines[i])
    if (h1 && !titleLine) { titleLine = lines[i]; continue }

    const h2 = /^##\s+(.+)/.exec(lines[i])
    if (h2) {
      cur = h2[1].trim()
      if (!sections[cur]) { order.push(cur); sections[cur] = [] }
      continue
    }
    if (cur !== null) sections[cur].push(lines[i])
  }

  return { frontmatter, titleLine, order, sections }
}

/**
 * Parse the Standup section lines into { yesterday[], today[], blockers }.
 */
export function parseStandup(lines) {
  const r = { yesterday: [], today: [], blockers: '' }
  let key = null
  const MAP = { 'yesterday:': 'yesterday', 'today:': 'today', 'blockers:': 'blockers' }

  for (const line of lines) {
    const bold = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(line.trim())
    if (bold) {
      const k = MAP[bold[1].trim().toLowerCase()]
      if (k) {
        key = k
        if (k === 'blockers') r.blockers = bold[2].trim()
        continue
      }
    }
    if (key === 'yesterday' || key === 'today') {
      const m = /^\s*-\s+(.+)/.exec(line)
      if (m) r[key].push(m[1].trim())
    } else if (key === 'blockers') {
      const m = /^\s*-\s+(.+)/.exec(line)
      if (m) r.blockers = (r.blockers ? r.blockers + ', ' : '') + m[1].trim()
    }
  }
  return r
}

// "worked today" flag — `> ` always at the start of the body (before status prefix)
// e.g.  - [ ] > in-review CP-1234 - description
//       - [ ] > some plain task
const WORKED_RE = /^> /

/**
 * Parse task lines for display → [{ raw, done, body, status, workedToday }]
 */
export function parseTaskLines(lines) {
  return (lines || []).flatMap(line => {
    const done = /^\s*-\s*\[x\]\s*(.+)/i.exec(line)
    if (done) return [{ raw: line, done: true, body: done[1].trim(), status: 'done', workedToday: false }]

    const todo = /^\s*-\s*\[ \]\s*(.+)/.exec(line)
    if (todo) {
      let body = todo[1].trim()
      const workedToday = WORKED_RE.test(body)
      if (workedToday) body = body.slice(2) // strip '> '
      const pm = SIMPLE_PREFIX_RE.exec(body)
      const stat = (pm && STATUS_SLUGS.has(pm[1])) ? pm[1] : 'wip'
      const clean = (stat !== 'wip' && pm) ? body.slice(pm[0].length) : body
      return [{ raw: line, done: false, body: clean, status: stat, workedToday }]
    }
    return []
  })
}

/**
 * Parse tasks for roll-forward.
 * Returns:
 *   completed[] — checked [x] tasks (body text, stripped of flag)
 *   worked[]    — unchecked tasks flagged with `>` (worked today)
 *                 → goes into Yesterday AND Today on roll-forward (flag stripped)
 *   remaining[] — all other unchecked tasks
 *                 → goes into Today only
 */
export function parseRawTasks(lines) {
  const completed = [], worked = [], remaining = []
  for (const line of (lines || [])) {
    const done = /^\s*-\s*\[x\]\s*(.+)/i.exec(line)
    if (done) { completed.push(done[1].trim()); continue }
    const todo = /^\s*-\s*\[ \]\s*(.+)/.exec(line)
    if (!todo) continue
    const body = todo[1].trim()
    const workedToday = /^> /.test(body)
    if (workedToday) {
      // Strip '> ' flag; remaining body (with status prefix) goes to standup
      worked.push(body.slice(2))
    } else {
      remaining.push(body)
    }
  }
  return { completed, worked, remaining }
}

/** Strip [[wikilinks]] for plain text display */
export function stripWikilinks(text) {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1')
}

/** Extract [[wikilink]] targets from text */
export function extractWikilinks(text) {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
}
