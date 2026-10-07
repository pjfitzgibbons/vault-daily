<template>
  <AppToolbar
    :current-date="currentDate"
    :dirty="dirty"
    :submitting="jiraSubmitting"
    @navigate="onNavigate"
    @roll-forward="onRollForwardClick"
    @submit-standup="onStandupButtonClick"
    @time-entries="onTimeEntriesClick"
    @save="onSaveClick"
  />

  <div id="status-bar">
    <span class="file-status">{{ status }}</span>
    <span v-if="standupSubmitted" class="standup-status info">Standup submitted ✓</span>
    <span v-if="jiraStatus" class="standup-status" :class="jiraStatusClass">{{ jiraStatus }}</span>
  </div>
  <div v-if="!fileExists && rawContent === ''" id="no-file-banner">
    No file for this date. Start editing to create it when you save.
  </div>

  <main id="main" ref="mainEl">
    <div class="splitter splitter-v" id="split-v" />
    <div class="splitter splitter-h" id="split-h" />

    <StandupPanel
      id="section-standup"
      :standup="standup"
      @change="onStandupChange"
    />
    <TaskPanel
      id="section-tasks"
      title="Tasks"
      section="Tasks"
      :lines="sections['Tasks'] || []"
      :projects="projects"
      :jira-base-url="jiraBaseUrl"
      :raw-content="rawContent"
      @update:raw-content="mutate"
    />
    <NotesPanel
      id="section-notes"
      :lines="sections['Notes'] || []"
      @change="onNotesChange"
    />
    <TaskPanel
      id="section-ondeck"
      title="On Deck"
      section="On Deck"
      :lines="sections['On Deck'] || []"
      :projects="projects"
      :jira-base-url="jiraBaseUrl"
      :raw-content="rawContent"
      @update:raw-content="mutate"
    />
  </main>

  <WeeklyUpdatePanel
    v-if="weeklyUpdateAvailable"
    id="section-weekly"
    :lines="sections['Weekly Update'] || []"
    :drafting="weeklyDrafting"
    @change="onWeeklyUpdateChange"
    @redraft="onWeeklyRedraft"
  />

  <TimeEntriesPanel
    v-if="sections['Time Entries']"
    id="section-time-entries"
    :lines="sections['Time Entries'] || []"
    :raw-content="rawContent"
    @update:raw-content="mutate"
  />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useDaily }    from './composables/useDaily.js'
import { useProjects } from './composables/useProjects.js'
import { useSplitter } from './composables/useSplitter.js'
import { parseStandup } from './utils/parser.js'
import { rebuildStandupSection, rebuildNotesSection, rebuildWeeklyUpdateSection, setSectionBody } from './utils/mutations.js'
import { todayStr } from './utils/rollForward.js'
import { rowsFromDraft, timeEntriesBodyLines, parseTimeEntryRows } from './utils/timeEntries.js'

import AppToolbar        from './components/AppToolbar.vue'
import StandupPanel      from './components/StandupPanel.vue'
import TaskPanel         from './components/TaskPanel.vue'
import NotesPanel        from './components/NotesPanel.vue'
import WeeklyUpdatePanel from './components/WeeklyUpdatePanel.vue'
import TimeEntriesPanel  from './components/TimeEntriesPanel.vue'

const { rawContent, currentDate, fileExists, dirty, status, sections, standupSubmitted, loadDate, save, rollForward, redraftWeeklyUpdate, mutate } = useDaily()
const { projects } = useProjects()
const jiraBaseUrl = ref('')

const mainEl = ref(null)
const jiraSubmitting = ref(false)
const jiraStatus = ref('')
const jiraStatusClass = ref('')
let jiraStatusTimeout = null
const weeklyDrafting = ref(false)
useSplitter(mainEl)

const standup = computed(() => parseStandup(sections.value['Standup'] || []))
const timeEntryRows = computed(() => parseTimeEntryRows(sections.value['Time Entries'] || []))

async function onTimeEntriesClick() {
  const date = currentDate.value
  let draft
  try {
    const res = await fetch(`/api/time-entries/${date}/draft`)
    if (!res.ok) throw new Error(res.status === 404 ? `No time-entry draft for ${date}` : `HTTP ${res.status}`)
    draft = await res.json()
  } catch (e) {
    jiraStatus.value = e.message
    jiraStatusClass.value = 'err'
    return
  }
  if (timeEntryRows.value.length && !confirm('Replace the Time Entries table with the draft?')) return
  mutate(setSectionBody(rawContent.value, 'Time Entries', timeEntriesBodyLines(rowsFromDraft(draft))))
  jiraStatus.value = `Time entries loaded (${date})`
  jiraStatusClass.value = 'ok'
}

// The Weekly Update section only exists on Friday notes; show its panel when present.
const weeklyUpdateAvailable = computed(() =>
  (sections.value['Weekly Update'] || []).some(l => l.trim())
)

function routeDateFromPath() {
  const m = /^\/(\d{4}-\d{2}-\d{2})\/?$/.exec(window.location.pathname)
  return m ? m[1] : null
}

function destinationUrlForDate(date) {
  return `${window.location.origin}/${date}`
}

function syncUrlToDate(date) {
  const target = `/${date}`
  if (window.location.pathname !== target) {
    logClient('debug', 'daily.url.replace-state', {
      fromPath: window.location.pathname,
      toPath: target,
      date,
      destinationUrl: destinationUrlForDate(date),
    }, 'Daily URL updated')
    window.history.replaceState(null, '', target)
  }
}

function onPopState() {
  const d = routeDateFromPath() || todayStr()
  logClient('info', 'daily.navigation.popstate', {
    targetDate: d,
    pathname: window.location.pathname,
    destinationUrl: destinationUrlForDate(d),
  }, 'Daily navigation via browser history')
  void loadDateWithLogging(d, 'popstate', { force: true })
}

async function loadDateWithLogging(date, source, options = {}) {
  const fromDate = currentDate.value
  logClient('info', 'daily.navigation.requested', {
    source,
    fromDate,
    toDate: date,
    force: !!options.force,
    dirty: dirty.value,
    destinationUrl: destinationUrlForDate(date),
  }, 'Daily navigation requested')

  const result = await loadDate(date, options)
  if (result?.cancelled) {
    logClient('warn', 'daily.navigation.cancelled', {
      source,
      fromDate,
      toDate: date,
      reason: 'unsaved-changes-confirm',
      destinationUrl: destinationUrlForDate(date),
    }, 'Daily navigation cancelled')
    return
  }

  if (result?.ok) {
    logClient('info', 'daily.navigation.loaded', {
      source,
      fromDate,
      toDate: date,
      exists: result.exists,
      status: status.value,
      destinationUrl: destinationUrlForDate(date),
    }, 'Daily navigation loaded')
    return
  }

  logClient('error', 'daily.navigation.failed', {
    source,
    fromDate,
    toDate: date,
    error: result?.error || 'unknown',
    destinationUrl: destinationUrlForDate(date),
  }, 'Daily navigation failed')
}

function onNavigate(date, source = 'toolbar') {
  logClient('debug', 'daily.navigation.toolbar-click', {
    source,
    currentDate: currentDate.value,
    targetDate: date,
    destinationUrl: destinationUrlForDate(date),
  }, 'Daily navigation click')
  void loadDateWithLogging(date, `toolbar:${source}`)
}

// ── Standup writes ─────────────────────────────────────────────────────────────
function onStandupChange(newStandup) {
  mutate(rebuildStandupSection(rawContent.value, newStandup))
}

// ── Notes writes ───────────────────────────────────────────────────────────────
function onNotesChange(newText) {
  mutate(rebuildNotesSection(rawContent.value, newText))
}

// ── Weekly Update writes ───────────────────────────────────────────────────────
function onWeeklyUpdateChange(newText) {
  mutate(rebuildWeeklyUpdateSection(rawContent.value, newText))
}

// ── Weekly Update re-draft (Claude) ────────────────────────────────────────────
async function onWeeklyRedraft() {
  if (weeklyDrafting.value) return
  weeklyDrafting.value = true
  jiraStatus.value = 'Drafting Weekly Update with Claude…'
  jiraStatusClass.value = ''
  clearTimeout(jiraStatusTimeout)
  logClient('info', 'weekly-update.redraft.started', { date: currentDate.value }, 'Weekly Update re-draft started')
  try {
    const draft = await redraftWeeklyUpdate()
    if (!draft) throw new Error('Claude returned an empty draft')
    jiraStatus.value = 'Weekly Update drafted ✓'
    jiraStatusClass.value = 'ok'
    logClient('info', 'weekly-update.redraft.completed', { date: currentDate.value, chars: draft.length }, 'Weekly Update re-draft completed')
    jiraStatusTimeout = setTimeout(() => { jiraStatus.value = ''; jiraStatusClass.value = '' }, 5000)
  } catch (e) {
    jiraStatus.value = `Weekly Update draft failed: ${e.message}`
    jiraStatusClass.value = 'err'
    logClient('error', 'weekly-update.redraft.failed', { date: currentDate.value, message: e?.message || String(e) }, 'Weekly Update re-draft failed')
  } finally {
    weeklyDrafting.value = false
  }
}

// ── Roll forward ───────────────────────────────────────────────────────────────
async function onRollForward() {
  clearTimeout(jiraStatusTimeout)
  try {
    await rollForward({ onWeeklyDraftStart: () => { jiraStatus.value = 'Generating Weekly Update…'; jiraStatusClass.value = 'warn' } })
    jiraStatus.value = 'Roll forward complete ✓'
    jiraStatusClass.value = 'ok'
    jiraStatusTimeout = setTimeout(() => { jiraStatus.value = ''; jiraStatusClass.value = '' }, 5000)
  } catch (e) {
    jiraStatus.value = 'Roll forward failed'
    jiraStatusClass.value = 'err'
    alert(e.message)
  }
}

async function onRollForwardClick() {
  logClient('info', 'toolbar.roll-forward.clicked', {
    date: currentDate.value,
  }, 'Roll Forward clicked')
  await onRollForward()
}

async function onSaveClick() {
  logClient('info', 'toolbar.save.clicked', {
    date: currentDate.value,
    dirty: dirty.value,
  }, 'Save clicked')
  clearTimeout(jiraStatusTimeout)
  try {
    await save({ onWeeklyDraftStart: () => { jiraStatus.value = 'Generating Weekly Update…'; jiraStatusClass.value = 'warn' } })
    if (jiraStatusClass.value === 'warn') {
      jiraStatus.value = 'Weekly Update drafted ✓'
      jiraStatusClass.value = 'ok'
      jiraStatusTimeout = setTimeout(() => { jiraStatus.value = ''; jiraStatusClass.value = '' }, 5000)
    }
  } catch (e) {
    jiraStatus.value = 'Save failed'
    jiraStatusClass.value = 'err'
  }
}

function onStandupButtonClick() {
  logClient('info', 'toolbar.standup.clicked', {
    date: currentDate.value,
  }, 'Standup top-nav button clicked')
  void submitStandup()
}

function normalizeClientLevel(level) {
  const v = String(level || '').toLowerCase()
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v
  return 'info'
}

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}))
}

async function sendClientLog(level, event, data = {}, message = '') {
  try {
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: normalizeClientLevel(level),
        event,
        data,
        message,
      }),
    })
  } catch {
    // Intentionally no-op: logging must never break user actions.
  }
}

function logClient(level, event, data = {}, message = '') {
  if (level === 'error') console.error(`[${event}]`, data)
  else if (level === 'warn') console.warn(`[${event}]`, data)
  else if (level === 'debug') console.debug(`[${event}]`, data)
  else console.info(`[${event}]`, data)

  void sendClientLog(level, event, data, message)
}

function targetLabel(target) {
  if (!target) return ''
  const attr = target.getAttribute?.('data-action')
  if (attr) return attr
  if (target.id) return `#${target.id}`
  const role = target.getAttribute?.('role')
  const tag = (target.tagName || '').toLowerCase()
  if (role) return `${tag}[role=${role}]`
  return tag || 'unknown'
}

function interactionPayload(evt) {
  const el = evt.target
  if (!el || !el.closest) return null
  const interactive = el.closest('button,input,textarea,select,a[href],[role="button"],.status-badge,.wikilink-display')
  if (!interactive) return null

  const payload = {
    eventType: evt.type,
    action: targetLabel(interactive),
    tag: (interactive.tagName || '').toLowerCase(),
    pathname: window.location.pathname,
    date: currentDate.value,
  }

  const text = (interactive.textContent || '').trim()
  if (text) payload.text = text.slice(0, 80)
  if ('value' in interactive) payload.valueLength = String(interactive.value || '').length
  if ('checked' in interactive) payload.checked = !!interactive.checked
  if (evt.type === 'keydown') payload.key = evt.key

  return payload
}

function onUiInteraction(evt) {
  if (evt.type === 'keydown') {
    const key = evt.key
    if (!['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(key)) return
  }
  const payload = interactionPayload(evt)
  if (!payload) return
  logClient('debug', `ui.interaction.${evt.type}`, payload, 'UI interaction')
}

// ── Jira Standup Submit ────────────────────────────────────────────────────────
function jiraBrowserFetch(baseUrl, path, { method = 'GET', body } = {}) {
  logClient('debug', 'jira-browser.request.start', {
    method,
    path,
    hasBody: !!body,
    credentialMode: 'include',
  }, 'Browser Jira request start')
  return fetch(`${String(baseUrl || '').replace(/\/$/, '')}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async res => {
    logClient('debug', 'jira-browser.request.response', {
      method,
      path,
      status: res.status,
    }, 'Browser Jira response received')

    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      logClient('warn', 'jira-browser.request.failed', {
        method,
        path,
        status: res.status,
        message: msg,
      }, 'Browser Jira request failed')
      throw new Error(`Jira ${res.status}${msg ? `: ${msg}` : ''}`)
    }
    if (res.status === 204) return null
    return res.json().catch(() => null)
  })
}

function toAdfBullet(items) {
  return {
    type: 'doc',
    version: 1,
    content: [{
      type: 'bulletList',
      content: (items || []).map(t => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: String(t || '') }] }],
      })),
    }],
  }
}

function toAdfText(text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: text || '' }] }],
  }
}

async function submitStandupViaBrowserSession(date, sd) {
  logClient('info', 'standup-submit.browser-fallback.started', { date }, 'Standup browser session fallback started')
  const cfgRes = await fetch('/api/jira/config')
  const cfg = await parseJsonSafe(cfgRes)
  if (!cfgRes.ok) throw new Error(cfg.error || `HTTP ${cfgRes.status}`)

  const baseUrl = String(jiraBaseUrl.value || cfg.baseUrl || '').trim()
  const fields = cfg.fields || {}
  if (!baseUrl) throw new Error('Jira baseUrl is missing in config.json')
  logClient('debug', 'standup-submit.browser-fallback.config-loaded', {
    date,
    baseUrl,
    fieldCount: Object.keys(fields).length,
  }, 'Standup browser session config loaded')

  const me = await jiraBrowserFetch(baseUrl, '/rest/api/3/myself')
  logClient('debug', 'standup-submit.browser-fallback.user-resolved', {
    date,
    accountId: me?.accountId,
  }, 'Standup browser session user resolved')

  const search = await jiraBrowserFetch(baseUrl, '/rest/api/3/search/jql', {
    method: 'POST',
    body: {
      jql: `assignee="${me.accountId}" AND summary~"standup" ORDER BY created DESC`,
      maxResults: 30,
      fields: ['key', 'summary'],
    },
  })

  const issue = (search?.issues || []).find(i => (i?.fields?.summary || '').includes(date))
  if (!issue) throw new Error(`No standup card found for ${date}`)
  logClient('debug', 'standup-submit.browser-fallback.issue-selected', {
    date,
    issueKey: issue.key,
  }, 'Standup browser session issue selected')

  const fieldData = {}
  if (fields.yesterday) fieldData[fields.yesterday] = toAdfBullet(sd.yesterday)
  if (fields.today) fieldData[fields.today] = toAdfBullet(sd.today)
  if (fields.blockers) fieldData[fields.blockers] = toAdfText(sd.blockers || 'None')
  if (Object.keys(fieldData).length) {
    logClient('debug', 'standup-submit.browser-fallback.issue-update', {
      date,
      issueKey: issue.key,
      fieldCount: Object.keys(fieldData).length,
    }, 'Standup browser session updating issue fields')
    await jiraBrowserFetch(baseUrl, `/rest/api/3/issue/${issue.key}`, {
      method: 'PUT',
      body: { fields: fieldData },
    })
  }

  const t = await jiraBrowserFetch(baseUrl, `/rest/api/3/issue/${issue.key}/transitions`)
  const done = (t?.transitions || []).find(x =>
    (x?.name || '').toLowerCase().includes('done') || (x?.to?.name || '').toLowerCase() === 'done'
  )
  if (done) {
    logClient('debug', 'standup-submit.browser-fallback.transition', {
      date,
      issueKey: issue.key,
      transitionId: done.id,
    }, 'Standup browser session applying transition')
    await jiraBrowserFetch(baseUrl, `/rest/api/3/issue/${issue.key}/transitions`, {
      method: 'POST',
      body: { transition: { id: done.id } },
    })
  }

  return { key: issue.key, transitioned: !!done }
}

async function submitStandup() {
  if (jiraSubmitting.value) return
  
  jiraSubmitting.value = true
  jiraStatus.value = 'Submitting…'
  jiraStatusClass.value = ''
  clearTimeout(jiraStatusTimeout)
  
  const sd = standup.value
  logClient('info', 'standup-submit.started', {
    date: currentDate.value,
    yesterdayCount: (sd.yesterday || []).length,
    todayCount: (sd.today || []).length,
    blockersLength: (sd.blockers || '').length,
  }, 'Standup submit started')
  
  try {
    const res = await fetch('/api/jira/standup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:      currentDate.value,
        yesterday: sd.yesterday,
        today:     sd.today,
        blockers:  sd.blockers,
      }),
    })
    logClient('debug', 'standup-submit.server.response', {
      status: res.status,
    }, 'Standup server submit response received')
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      const msg = data.error || `HTTP ${res.status}`
      const shouldTryCookieAuth = /Jira not configured|auth failed/i.test(msg)
      logClient('warn', 'standup-submit.server.failed', {
        status: res.status,
        message: msg,
        shouldTryCookieAuth,
      }, 'Standup server submit failed')
      if (!shouldTryCookieAuth) throw new Error(msg)

      jiraStatus.value = 'Server Jira credentials unavailable; trying browser Jira session…'
      const direct = await submitStandupViaBrowserSession(currentDate.value, sd)
      jiraStatus.value = `${direct.key} updated via browser session (${currentDate.value})${direct.transitioned ? ' & marked Done' : ''} ✓`
      jiraStatusClass.value = 'ok'
      logClient('info', 'standup-submit.browser-fallback.completed', {
        issueKey: direct.key,
        transitioned: direct.transitioned,
      }, 'Standup submit completed via browser session')
      return
    }

    jiraStatus.value      = `${data.key} updated (${currentDate.value})${data.transitioned ? ' & marked Done' : ''} ✓`
    jiraStatusClass.value = 'ok'
    logClient('info', 'standup-submit.server.completed', {
      issueKey: data.key,
      transitioned: !!data.transitioned,
    }, 'Standup submit completed via server credentials')
  } catch (e) {
    jiraStatus.value      = e.message
    jiraStatusClass.value = 'err'
    logClient('error', 'standup-submit.failed', {
      message: e?.message || String(e),
    }, 'Standup submit failed')
  } finally {
    jiraSubmitting.value = false
    logClient('debug', 'standup-submit.finished', {
      submitting: jiraSubmitting.value,
      statusClass: jiraStatusClass.value,
    }, 'Standup submit finished')
    
    if (jiraStatusClass.value === 'ok') {
      jiraStatusTimeout = setTimeout(() => {
        jiraStatus.value = ''
        jiraStatusClass.value = ''
      }, 5000)
    }
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
onMounted(() => {
  const initialDate = routeDateFromPath() || todayStr()
  logClient('info', 'daily.navigation.initial-load', {
    initialDate,
    pathname: window.location.pathname,
    destinationUrl: destinationUrlForDate(initialDate),
  }, 'Daily initial load')
  void loadDateWithLogging(initialDate, 'initial', { force: true })
  syncUrlToDate(initialDate)

  window.addEventListener('popstate', onPopState)

  void (async () => {
    try {
      const cfgRes = await fetch('/api/jira/config')
      const cfg = await parseJsonSafe(cfgRes)
      jiraBaseUrl.value = String(cfg?.baseUrl || '').replace(/\/$/, '')
      logClient('debug', 'jira.base-url.loaded', {
        hasBaseUrl: !!jiraBaseUrl.value,
      }, 'Jira base URL loaded for ticket links')
    } catch (e) {
      logClient('warn', 'jira.base-url.failed', {
        message: e?.message || String(e),
      }, 'Failed to load Jira base URL')
    }
  })()

  document.addEventListener('click', onUiInteraction, true)
  document.addEventListener('change', onUiInteraction, true)
  document.addEventListener('input', onUiInteraction, true)
  document.addEventListener('blur', onUiInteraction, true)
  document.addEventListener('keydown', onUiInteraction, true)

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 's') { e.preventDefault(); if (dirty.value) save() }
  })
})

watch(currentDate, d => {
  if (!d) return
  logClient('debug', 'daily.navigation.current-date-changed', {
    date: d,
  }, 'Current date changed')
  syncUrlToDate(d)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
  document.removeEventListener('click', onUiInteraction, true)
  document.removeEventListener('change', onUiInteraction, true)
  document.removeEventListener('input', onUiInteraction, true)
  document.removeEventListener('blur', onUiInteraction, true)
  document.removeEventListener('keydown', onUiInteraction, true)
})
</script>

<style>
/* ── Theme tokens ──────────────────────────────────────────────────────────────
   Colours are addressed only through these custom properties. :root holds the
   dark theme (the historical default); :root[data-theme="light"] overrides for
   light. useTheme.js writes data-theme onto <html> — 'auto' follows the
   browser / VSCode embedded-browser colour scheme (prefers-color-scheme). */
:root {
  --c-bg:            #1e1e1e;
  --c-bg-panel:      #252526;
  --c-bg-input:      #2d2d30;
  --c-border:        #3e3e42;
  --c-border-strong: #999999;

  --c-text:          #cccccc;
  --c-text-dim:      #808080;
  --c-text-strong:   #ffffff;
  --c-text-faint:    #555555;

  --c-accent:        #007acc;
  --c-accent-hover:  #1a8ad4;

  --c-ok:            #89d185;
  --c-err:           #f14c4c;
  --c-danger:        #ff6666;
  --c-warn:          #d4a017;
  --c-code:          #ce9178;
  --c-done:          #4ec9b0;

  --c-status-wip:       #6b9bd2;
  --c-status-reviewing: #e5a550;
  --c-status-qa:        #c586c0;

  --c-backdrop:          rgba(0, 0, 0, .55);
  --c-accent-soft:       rgba(0, 122, 204, .13);
  --c-accent-soft-hover: rgba(0, 122, 204, .25);
  --c-warn-bg:           rgba(212, 160, 23, .08);
  --c-warn-border:       rgba(212, 160, 23, .3);
  --c-warn-row:          rgba(212, 160, 23, .04);
  --c-overlay-soft:      rgba(255, 255, 255, .06);
  --c-overlay-hover:     rgba(255, 255, 255, .07);
  --c-overlay-border:    rgba(255, 255, 255, .1);
  --c-shadow:            rgba(0, 0, 0, .4);
}
:root[data-theme="light"] {
  --c-bg:            #ffffff;
  --c-bg-panel:      #f3f3f3;
  --c-bg-input:      #ffffff;
  --c-border:        #d4d4d4;
  --c-border-strong: #a0a0a0;

  --c-text:          #1f1f1f;
  --c-text-dim:      #6b6b6b;
  --c-text-strong:   #1a1a1a;
  --c-text-faint:    #a0a0a0;

  --c-accent:        #005fb8;
  --c-accent-hover:  #0067c0;

  --c-ok:            #388a34;
  --c-err:           #cd3131;
  --c-danger:        #d13438;
  --c-warn:          #9a6a00;
  --c-code:          #a31515;
  --c-done:          #267f6b;

  --c-status-wip:       #2b6cb0;
  --c-status-reviewing: #b5701a;
  --c-status-qa:        #9c27b0;

  --c-backdrop:          rgba(0, 0, 0, .35);
  --c-accent-soft:       rgba(0, 95, 184, .10);
  --c-accent-soft-hover: rgba(0, 95, 184, .18);
  --c-warn-bg:           rgba(212, 160, 23, .14);
  --c-warn-border:       rgba(212, 160, 23, .45);
  --c-warn-row:          rgba(212, 160, 23, .10);
  --c-overlay-soft:      rgba(0, 0, 0, .05);
  --c-overlay-hover:     rgba(0, 0, 0, .06);
  --c-overlay-border:    rgba(0, 0, 0, .12);
  --c-shadow:            rgba(0, 0, 0, .18);
}

html { height: 100%; }
body { margin: 0; }
/* Keep the toolbar in view while the whole page scrolls */
#toolbar { position: sticky; top: 0; z-index: 20; }
body {
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  background: var(--c-bg);
  color: var(--c-text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
#status-bar {
  font-size: 11px;
  color: var(--c-text-dim);
  padding: 3px 12px;
  background: var(--c-bg-panel);
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.file-status { flex: 1; }
.standup-status {
  font-weight: 500;
  white-space: nowrap;
}
.standup-status.ok  { color: var(--c-ok); }
.standup-status.err { color: var(--c-err); }
.standup-status.warn { color: var(--c-warn); }
.standup-status.info { color: var(--c-status-wip); }
#no-file-banner {
  background: var(--c-warn-bg);
  border-bottom: 1px solid var(--c-warn-border);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--c-warn);
  flex-shrink: 0;
}
#main {
  flex: 1;
  overflow: hidden;
  min-height: 70vh;
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 5px 1fr;
  grid-template-rows: 1fr 5px 1fr;
  gap: 0;
}
#section-standup { grid-column: 1; grid-row: 1; }
#section-tasks   { grid-column: 3; grid-row: 1; }
#section-notes   { grid-column: 1; grid-row: 3; }
#section-ondeck  { grid-column: 3; grid-row: 3; }

/* Weekly Update — Friday-only panel below the board; grows with content,
   reachable via the whole-page scrollbar */
#section-weekly {
  flex-shrink: 0;
  margin: 0 8px 8px;
  min-height: 160px;
}

/* splitters */
.splitter {
  position: relative;
  z-index: 5;
  background: var(--c-border);
  transition: background .12s;
}
.splitter::after {
  content: '';
  position: absolute;
  background: transparent;
}
.splitter-v {
  grid-column: 2;
  grid-row: 1 / span 3;
  cursor: col-resize;
}
.splitter-v::after { inset: 0 -4px; }
.splitter-h {
  grid-column: 1 / span 3;
  grid-row: 2;
  cursor: row-resize;
  z-index: 6;
}
.splitter-h::after { inset: -4px 0; }
.splitter:hover, .splitter.dragging { background: var(--c-accent); }
</style>
