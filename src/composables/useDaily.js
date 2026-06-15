// ── useDaily.js ───────────────────────────────────────────────────────────────
import { ref, computed, readonly } from 'vue'
import { parseSections, parseRawTasks } from '../utils/parser.js'
import { buildFreshContent } from '../utils/mutations.js'
import { buildNextDayContent, addOneDay, todayStr } from '../utils/rollForward.js'

export function useDaily() {
  const rawContent  = ref('')
  const currentDate = ref(todayStr())
  const fileExists  = ref(false)
  const dirty       = ref(false)
  const status      = ref('Initialising…')

  const sections = computed(() => parseSections(rawContent.value).sections)

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

  async function save() {
    const content = rawContent.value || buildFreshContent(currentDate.value)
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

  async function rollForward() {
    const nextDate = addOneDay(currentDate.value)

    // Check if next file already exists
    const check = await fetch(`/api/daily/${nextDate}`)
    const data  = await check.json()
    if (data.exists) throw new Error(`${nextDate}.md already exists`)

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

    const content = buildNextDayContent(nextDate, completed, worked, remaining, onDeckWorked, onDeckRemaining)
    const res = await fetch(`/api/daily/${nextDate}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await loadDate(nextDate, { force: true })
  }

  let _saveTimer = null
  function mutate(newContent) {
    rawContent.value = newContent
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
    loadDate,
    save,
    rollForward,
    mutate,
  }
}
