<template>
  <AppToolbar
    :current-date="currentDate"
    :dirty="dirty"
    @navigate="loadDate"
    @roll-forward="onRollForward"
    @submit-standup="jiraOpen = true"
    @save="save"
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
    @close="jiraOpen = false"
    @submit="submitStandup"
  />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDaily }    from './composables/useDaily.js'
import { useProjects } from './composables/useProjects.js'
import { useSplitter } from './composables/useSplitter.js'
import { parseStandup } from './utils/parser.js'
import { rebuildStandupSection, rebuildNotesSection } from './utils/mutations.js'

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

// ── Jira ───────────────────────────────────────────────────────────────────────
const jiraOpen         = ref(false)
const jiraSubmitting   = ref(false)
const jiraStatus       = ref('')
const jiraStatusClass  = ref('')

async function submitStandup() {
  jiraSubmitting.value = true
  jiraStatus.value = 'Submitting…'
  jiraStatusClass.value = ''
  const sd = standup.value
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
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    jiraStatus.value      = `${data.key} updated${data.transitioned ? ' & marked Done' : ''} ✓`
    jiraStatusClass.value = 'ok'
  } catch (e) {
    jiraStatus.value      = e.message
    jiraStatusClass.value = 'err'
  } finally {
    jiraSubmitting.value = false
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
onMounted(() => {
  loadDate(currentDate.value)

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 's') { e.preventDefault(); if (dirty.value) save() }
    if (e.key === 'Escape')   { jiraOpen.value = false }
  })
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
