<template>
  <AppToolbar
    :current-date="currentDate"
    :dirty="dirty"
    @navigate="onNavigate"
    @roll-forward="onRollForwardClick"
    @submit-standup="onStandupButtonClick"
    @save="onSaveClick"
  />

  <div id="status-bar">{{ status }}</div>
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
      :raw-content="rawContent"
      @update:raw-content="mutate"
    />
  </main>

  <JiraModal
    :open="jiraOpen"
    :submitting="jiraSubmitting"
    :status-msg="jiraStatus"
    :status-class="jiraStatusClass"
    @close="onJiraModalClose"
    @submit="onJiraModalSubmit"
  />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useDaily }    from './composables/useDaily.js'
import { useProjects } from './composables/useProjects.js'
import { useSplitter } from './composables/useSplitter.js'
import { parseStandup } from './utils/parser.js'
import { rebuildStandupSection, rebuildNotesSection } from './utils/mutations.js'
import { todayStr } from './utils/rollForward.js'

import AppToolbar   from './components/AppToolbar.vue'
import StandupPanel from './components/StandupPanel.vue'
import TaskPanel    from './components/TaskPanel.vue'
import NotesPanel   from './components/NotesPanel.vue'
import JiraModal    from './components/JiraModal.vue'

const { rawContent, currentDate, fileExists, dirty, status, sections, loadDate, save, rollForward, mutate } = useDaily()
const { projects } = useProjects()

const mainEl = ref(null)
useSplitter(mainEl)

const standup = computed(() => parseStandup(sections.value['Standup'] || []))

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

// ── Roll forward ───────────────────────────────────────────────────────────────
async function onRollForward() {
  try {
    await rollForward()
  } catch (e) {
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
  await save()
}

function onStandupButtonClick() {
  logClient('info', 'toolbar.standup.clicked', {
    date: currentDate.value,
    modalOpen: jiraOpen.value,
  }, 'Standup top-nav button clicked')
  jiraOpen.value = true
}

function onJiraModalClose(source = 'unknown') {
  logClient('info', 'jira-modal.close', {
    source,
    date: currentDate.value,
    statusClass: jiraStatusClass.value,
  }, 'Jira modal closed')
  jiraOpen.value = false
}

function onJiraModalSubmit(source = 'modal-submit') {
  logClient('info', 'jira-modal.submit.clicked', {
    source,
    date: currentDate.value,
  }, 'Jira modal submit clicked')
  void submitStandup()
}

// ── Jira ───────────────────────────────────────────────────────────────────────
const jiraOpen         = ref(false)
const jiraSubmitting   = ref(false)
const jiraStatus       = ref('')
const jiraStatusClass  = ref('')

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}))
}

function normalizeClientLevel(level) {
  const v = String(level || '').toLowerCase()
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v
  return 'info'
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
  const interactive = el.closest('button,input,textarea,select,[role="button"],.status-badge,.wikilink-display')
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

async function jiraBrowserFetch(baseUrl, path, { method = 'GET', body } = {}) {
  logClient('debug', 'jira-browser.request.start', {
    method,
    path,
    hasBody: !!body,
    credentialMode: 'include',
  }, 'Browser Jira request start')
  const res = await fetch(`${String(baseUrl || '').replace(/\/$/, '')}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

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

  const baseUrl = (cfg.baseUrl || '').trim()
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
  jiraSubmitting.value = true
  jiraStatus.value = 'Submitting…'
  jiraStatusClass.value = ''
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
      jiraStatus.value = `${direct.key} updated via browser session${direct.transitioned ? ' & marked Done' : ''} ✓`
      jiraStatusClass.value = 'ok'
      logClient('info', 'standup-submit.browser-fallback.completed', {
        issueKey: direct.key,
        transitioned: direct.transitioned,
      }, 'Standup submit completed via browser session')
      return
    }

    jiraStatus.value      = `${data.key} updated${data.transitioned ? ' & marked Done' : ''} ✓`
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

  document.addEventListener('click', onUiInteraction, true)
  document.addEventListener('change', onUiInteraction, true)
  document.addEventListener('input', onUiInteraction, true)
  document.addEventListener('blur', onUiInteraction, true)
  document.addEventListener('keydown', onUiInteraction, true)

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 's') { e.preventDefault(); if (dirty.value) save() }
    if (e.key === 'Escape' && jiraOpen.value) {
      onJiraModalClose('escape')
    }
  })
})

watch(currentDate, d => {
  if (!d) return
  logClient('debug', 'daily.navigation.current-date-changed', {
    date: d,
  }, 'Current date changed')
  syncUrlToDate(d)
})

watch(jiraOpen, open => {
  logClient('debug', 'jira-modal.state-changed', {
    open,
    date: currentDate.value,
  }, 'Jira modal state changed')
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
html, body { height: 100%; margin: 0; }
body {
  font-family: -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  background: #1e1e1e;
  color: #cccccc;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#status-bar {
  font-size: 11px;
  color: #808080;
  padding: 3px 12px;
  background: #252526;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
#no-file-banner {
  background: rgba(212,160,23,.08);
  border-bottom: 1px solid rgba(212,160,23,.3);
  padding: 6px 12px;
  font-size: 12px;
  color: #d4a017;
  flex-shrink: 0;
}
#main {
  flex: 1;
  overflow: hidden;
  min-height: 0;
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

/* splitters */
.splitter {
  position: relative;
  z-index: 5;
  background: #3e3e42;
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
.splitter:hover, .splitter.dragging { background: #007acc; }
</style>
