<template>
  <JiraModal
    :open="jiraOpen"
    :submitting="jiraSubmitting"
    :status-msg="jiraStatus"
    :status-class="jiraStatusClass"
    @close="onModalClose"
    @submit="onModalSubmit"
  />
</template>

<script setup>
import { ref } from 'vue'
import JiraModal from './JiraModal.vue'

const props = defineProps({
  currentDate: { type: String, required: true },
  standup:     { type: Object, required: true },
  jiraBaseUrl: { type: String, default: '' },
})

const jiraOpen = ref(false)
const jiraSubmitting = ref(false)
const jiraStatus = ref('')
const jiraStatusClass = ref('')

function parseJsonSafe(res) {
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
    // Logging must not break the submit flow.
  }
}

function logClient(level, event, data = {}, message = '') {
  if (level === 'error') console.error(`[${event}]`, data)
  else if (level === 'warn') console.warn(`[${event}]`, data)
  else if (level === 'debug') console.debug(`[${event}]`, data)
  else console.info(`[${event}]`, data)

  void sendClientLog(level, event, data, message)
}

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

function openDialog() {
  jiraOpen.value = true
  logClient('info', 'jira-modal.opened', {
    date: props.currentDate,
  }, 'Jira modal opened')
}

function closeDialog(source = 'unknown') {
  if (!jiraOpen.value) return
  logClient('info', 'jira-modal.close', {
    source,
    date: props.currentDate,
    statusClass: jiraStatusClass.value,
  }, 'Jira modal closed')
  jiraOpen.value = false
}

function onModalClose(source = 'unknown') {
  closeDialog(source)
}

function onModalSubmit(source = 'modal-submit') {
  logClient('info', 'jira-modal.submit.clicked', {
    source,
    date: props.currentDate,
  }, 'Jira modal submit clicked')
  void submitStandup()
}

async function submitStandupViaBrowserSession(date, sd) {
  logClient('info', 'standup-submit.browser-fallback.started', { date }, 'Standup browser session fallback started')
  const cfgRes = await fetch('/api/jira/config')
  const cfg = await parseJsonSafe(cfgRes)
  if (!cfgRes.ok) throw new Error(cfg.error || `HTTP ${cfgRes.status}`)

  const baseUrl = String(props.jiraBaseUrl || cfg.baseUrl || '').trim()
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
  const sd = props.standup
  logClient('info', 'standup-submit.started', {
    date: props.currentDate,
    yesterdayCount: (sd.yesterday || []).length,
    todayCount: (sd.today || []).length,
    blockersLength: (sd.blockers || '').length,
  }, 'Standup submit started')
  try {
    const res = await fetch('/api/jira/standup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:      props.currentDate,
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
      const direct = await submitStandupViaBrowserSession(props.currentDate, sd)
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

defineExpose({
  openDialog,
  closeDialog,
})
</script>
