<template>
  <div class="task-item" :class="{ done: task.done, worked: task.workedToday }">
    <!-- drag handle -->
    <span
      class="task-grip"
      draggable="true"
      title="Drag to move between Tasks and On Deck"
      @dragstart="onDragStart"
    >⠿</span>

    <!-- checkbox -->
    <input type="checkbox" :checked="task.done" @change="onCheckbox" />

    <!-- worked-today toggle -->
    <button
      v-if="!task.done"
      class="task-worked"
      :class="{ active: task.workedToday }"
      title="Mark as worked today (appears in standup Yesterday)"
      @click="onToggleWorked"
    >◉</button>
    <span v-else class="task-worked-placeholder" />

    <!-- status badge + dropdown -->
    <div class="task-status" ref="statusRef">
      <span
        class="status-badge"
        :style="{ color: statusColor }"
        @click.stop="toggleMenu"
      >
        <span class="label">{{ statusLabel }}</span>
        <span class="arrow">▾</span>
      </span>
      <ul v-if="menuOpen" class="status-menu">
        <li
          v-for="s in STATUS_LIST"
          :key="s.slug"
          :class="{ active: s.slug === task.status }"
          :style="{ color: s.color }"
          @mousedown.prevent="setStatus(s.slug)"
        >{{ s.label }}</li>
      </ul>
    </div>

    <!-- body (wikilink-aware inline edit) -->
    <WikilinkInput
      :model-value="task.body"
      :projects="projects"
      :jira-base-url="jiraBaseUrl"
      @update:model-value="onBodyEdit"
      @commit="onBodyCommit"
      @cancel="() => {}"
    />

    <!-- delete -->
    <button class="task-delete" title="Delete" @click="emit('delete', task.raw)">×</button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { STATUS_LIST, STATUS_COLORS } from '../utils/parser.js'
import { rewriteTaskStatus, editTaskBody, toggleWorkedToday, ensureWorkedFlagOnLine, TASK_DRAG_MIME } from '../utils/mutations.js'
import WikilinkInput from './WikilinkInput.vue'

const props = defineProps({
  task:     { type: Object,  required: true },
  section:  { type: String,  default: 'Tasks' },
  projects: { type: Array,   default: () => [] },
  jiraBaseUrl: { type: String, default: '' },
  rawContent: { type: String, required: true },
})
const emit = defineEmits(['change', 'delete'])

const menuOpen  = ref(false)
const statusRef = ref(null)

const statusLabel = computed(() =>
  STATUS_LIST.find(s => s.slug === props.task.status)?.label ?? 'WIP'
)
const statusColor = computed(() =>
  STATUS_COLORS[props.task.status] ?? STATUS_COLORS['wip']
)

function toggleMenu() {
  if (props.task.done) return
  menuOpen.value = !menuOpen.value
}

function setStatus(slug) {
  menuOpen.value = false
  if (slug === props.task.status) return
  let newRaw = rewriteTaskStatus(props.task.raw, slug)
  if (slug !== 'done') newRaw = ensureWorkedFlagOnLine(newRaw)
  emit('change', { oldRaw: props.task.raw, newRaw })
}

function onCheckbox(e) {
  const slug = e.target.checked ? 'done' : 'wip'
  let newRaw = rewriteTaskStatus(props.task.raw, slug)
  if (slug !== 'done') newRaw = ensureWorkedFlagOnLine(newRaw)
  emit('change', { oldRaw: props.task.raw, newRaw })
}

function onToggleWorked() {
  const fullContent = toggleWorkedToday(props.rawContent, props.task.raw)
  emit('change', { oldRaw: props.task.raw, fullContent })
}

let pendingBody = null
function onBodyEdit(newBody) {
  pendingBody = newBody
}
function onBodyCommit(newBody) {
  const body = (newBody ?? pendingBody ?? '').trim()
  pendingBody = null
  if (!body || body === props.task.body) return
  const newRaw = editTaskBody(props.rawContent, props.task.raw, body, { autoWorked: props.section !== 'On Deck' })
  // editTaskBody returns full rawContent — emit a special signal
  emit('change', { oldRaw: props.task.raw, fullContent: newRaw })
}

function onDragStart(e) {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(TASK_DRAG_MIME, JSON.stringify({ raw: props.task.raw, section: props.section }))
  e.dataTransfer.setDragImage(e.currentTarget.closest('.task-item'), 0, 0)
}

// Close menu on outside click
function onOutsideClick(e) {
  if (statusRef.value && !statusRef.value.contains(e.target)) {
    menuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', onOutsideClick))
</script>

<style scoped>
.task-item {
  display: grid;
  grid-template-columns: 10px 18px 18px 74px 1fr 18px;
  align-items: baseline;
  gap: 0 7px;
  padding: 3px 5px;
  border-radius: 3px;
  line-height: 1.4;
}
.task-item:hover { background: var(--c-bg-input); }
.task-item:hover .task-delete { opacity: 1; }
.task-grip {
  opacity: 0;
  transition: opacity .12s;
  cursor: grab;
  color: var(--c-text-faint);
  font-size: 11px;
  line-height: 1.4;
  user-select: none;
}
.task-item:hover .task-grip { opacity: 1; }
.task-grip:active { cursor: grabbing; }
.task-item input[type=checkbox] {
  margin-top: 2px;
  cursor: pointer;
  justify-self: center;
  accent-color: var(--c-done);
}
.task-item.done :deep(.wikilink-display) {
  text-decoration: line-through;
  color: var(--c-text-dim);
}
/* status */
.task-status {
  position: relative;
  align-self: start;
  margin-top: 1px;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--c-overlay-soft);
  border: 1px solid var(--c-overlay-border);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.task-item.done .status-badge { opacity: .35; pointer-events: none; }
.arrow { font-size: 8px; opacity: 0; transition: opacity .15s; }
.task-item:hover .arrow { opacity: .7; }
.status-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 3px);
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px var(--c-shadow);
  z-index: 100;
  min-width: 110px;
  padding: 3px 0;
  list-style: none;
  margin: 0;
}
.status-menu li {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.status-menu li:hover { background: var(--c-overlay-hover); }
.status-menu li.active { opacity: .5; cursor: default; }
/* delete */
.task-delete {
  opacity: 0;
  transition: opacity .12s;
  background: none;
  border: none;
  color: var(--c-text-dim);
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  align-self: start;
  margin-top: 1px;
}
.task-delete:hover { color: var(--c-danger); opacity: 1 !important; }

/* worked-today */
.task-worked {
  transition: color .12s;
  background: none;
  border: none;
  color: var(--c-border);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  align-self: start;
  margin-top: 2px;
  justify-self: center;
}
.task-worked.active {
  color: var(--c-warn);
}
.task-worked:hover:not(.active) { color: var(--c-text-dim); }
.task-worked-placeholder { display: block; }
.task-item.worked { background: var(--c-warn-row); }
</style>
