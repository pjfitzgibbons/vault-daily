// ── useDaily.js ───────────────────────────────────────────────────────────────
import { ref, computed, readonly } from 'vue'
import { parseSections, parseRawTasks, parseFrontmatterField } from '../utils/parser.js'
import { buildFreshContent, rebuildWeeklyUpdateSection, promoteSettledOnDeck } from '../utils/mutations.js'
import { buildNextDayContent, addOneDay, subOneDay, todayStr, isFriday } from '../utils/rollForward.js'

export function useDaily() {
  const rawContent  = ref('')
  const currentDate = ref(todayStr())
  const fileExists  = ref(false)
  const dirty       = ref(false)
  const status      = ref('Initialising…')

  const sections = computed(() => parseSections(rawContent.value).sections)
  const standupSubmitted = computed(() =>
    parseFrontmatterField(parseSections(rawContent.value).frontmatter, 'standupSubmitted') === 'true'
  )

  async function loadDate(date, { force = false } = {}) {
    if (dirty.value && !force) {
      if (!confirm('Unsaved changes — navigate away?')) {
        return { ok: false, cancelled: true, date }
      }
    }
    currentDate.value = date
    rawContent.value  = ''
    fileExists.value  = false
    dirty.value       = false
    try {
      const res  = await fetch(`/api/daily/${date}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      rawContent.value = data.content || ''
      fileExists.value = data.exists
      status.value = `daily/${date}.md${data.exists ? '' : ' (not found)'}`
      return { ok: true, date, exists: data.exists }
    } catch (e) {
      status.value = `Load error: ${e.message}`
      return { ok: false, date, error: e.message }
    }
  }

  // Builds the content for a brand-new day's note the same way the Roll
  // Forward button does, rolling forward open tasks from the prior weekday's
  // note instead of starting from the blank buildFreshContent() template.
  // This is the app's "new day's note" creation path (see save() below).
  async function buildRolledForwardContent(targetDate, opts = {}) {
    const prevDate = subOneDay(targetDate)
    let prevContent = ''
    try {
      const res = await fetch(`/api/daily/${prevDate}`)
      if (res.ok) {
        const data = await res.json()
        prevContent = data.content || ''
      }
    } catch (e) {
      console.warn('[roll-forward.prev-day.failed]', e.message)
    }

    const secs = parseSections(prevContent).sections
    const { completed, worked, remaining } = parseRawTasks(secs['Tasks'] || [])
    const onDeckWorked = []
    const onDeckRemaining = []
    for (const line of (secs['On Deck'] || [])) {
      const todo = /^\s*-\s*\[ \]\s*(.+)/.exec(line)
      if (!todo) {
        onDeckRemaining.push(line)
        continue
      }
      const body = todo[1].trim()
      if (body.startsWith('> ')) {
        onDeckWorked.push(body.slice(2))
      } else {
        onDeckRemaining.push(line)
      }
    }

    let content = buildNextDayContent(targetDate, completed, worked, remaining, onDeckWorked, onDeckRemaining)

    if (isFriday(targetDate)) {
      if (typeof opts.onWeeklyDraftStart === 'function') opts.onWeeklyDraftStart()
      try {
        const draft = await fetchWeeklyDraft(targetDate)
        if (draft) content = rebuildWeeklyUpdateSection(content, draft)
      } catch (e) {
        console.warn('[weekly-update.draft.failed]', e.message)
      }
    }

    return content
  }

  async function save(opts = {}) {
    let content = rawContent.value
    if (!content) {
      content = fileExists.value
        ? buildFreshContent(currentDate.value)
        : await buildRolledForwardContent(currentDate.value, opts)
    }
    try {
      const res = await fetch(`/api/daily/${currentDate.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fileExists.value = true
      dirty.value      = false
      status.value     = `daily/${currentDate.value}.md`
    } catch (e) {
      status.value = `Save failed: ${e.message}`
      throw e
    }
  }

  // Ask the server (which calls Claude) to draft the Weekly Update body for the
  // given Friday from that week's daily notes. Returns the drafted body string,
  // or '' if nothing came back. Throws on transport/API failure so callers can
  // decide whether to surface the error or fall back to the static template.
  async function fetchWeeklyDraft(date) {
    const res = await fetch('/api/weekly-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    return data.body || ''
  }

  async function rollForward(opts = {}) {
    const nextDate = addOneDay(currentDate.value)

    // Upsert the next-day note: if it already exists it gets overwritten
    // with the freshly rolled-forward content rather than failing.
    if (dirty.value) await save()

    const secs = parseSections(rawContent.value).sections
    const { completed, worked, remaining } = parseRawTasks(secs['Tasks'] || [])
    const onDeckWorked = []
    const onDeckRemaining = []
    for (const line of (secs['On Deck'] || [])) {
      const todo = /^\s*-\s*\[ \]\s*(.+)/.exec(line)
      if (!todo) {
        onDeckRemaining.push(line)
        continue
      }

      const body = todo[1].trim()
      if (body.startsWith('> ')) {
        onDeckWorked.push(body.slice(2))
      } else {
        onDeckRemaining.push(line)
      }
    }

    let content = buildNextDayContent(nextDate, completed, worked, remaining, onDeckWorked, onDeckRemaining)

    // Friday notes carry a "Weekly Update" section. Have Claude draft it from
    // the week's notes; if that fails for any reason, keep the static template
    // that buildNextDayContent already inserted.
    if (isFriday(nextDate)) {
      // Probe the existing next-day note without switching the view (loadDate mutates refs).
      let existing = { exists: false, content: '' }
      try {
        const probe = await fetch(`/api/daily/${nextDate}`)
        if (probe.ok) {
          const data = await probe.json()
          existing = { exists: !!data.exists, content: data.content || '' }
        }
      } catch (e) {
        console.warn('[weekly-update.probe.failed]', e.message)
      }

      const existingWu = existing.exists
        ? parseSections(existing.content).sections['Weekly Update']
        : null
      const alreadyFilled = existingWu && existingWu.some(l => /^\s*-\s+\S/.test(l))

      if (alreadyFilled) {
        // Keep the pre-existing drafted Weekly Update verbatim; no LLM call, no yellow indicator.
        content = rebuildWeeklyUpdateSection(content, existingWu.join('\n'))
      } else {
        if (typeof opts.onWeeklyDraftStart === 'function') opts.onWeeklyDraftStart()
        try {
          const draft = await fetchWeeklyDraft(nextDate)
          if (draft) content = rebuildWeeklyUpdateSection(content, draft)
        } catch (e) {
          console.warn('[weekly-update.draft.failed]', e.message)
        }
      }
    }

    const res = await fetch(`/api/daily/${nextDate}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await loadDate(nextDate, { force: true })
  }

  // Re-draft the Weekly Update for the currently-open note and write it in
  // place. Used by the "Draft with Claude" button on the Weekly Update panel.
  async function redraftWeeklyUpdate() {
    const draft = await fetchWeeklyDraft(currentDate.value)
    if (draft) mutate(rebuildWeeklyUpdateSection(rawContent.value, draft))
    return draft
  }

  let _saveTimer = null
  function mutate(newContent) {
    rawContent.value = promoteSettledOnDeck(newContent)
    dirty.value = true
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => { if (dirty.value) save() }, 800)
  }

  return {
    rawContent: readonly(rawContent),
    currentDate: readonly(currentDate),
    fileExists:  readonly(fileExists),
    dirty:       readonly(dirty),
    status:      readonly(status),
    sections,
    standupSubmitted,
    loadDate,
    save,
    rollForward,
    redraftWeeklyUpdate,
    mutate,
  }
}
