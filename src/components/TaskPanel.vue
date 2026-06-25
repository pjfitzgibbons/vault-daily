<template>
  <section class="panel">
    <div class="panel-header">
      <h2>{{ title }}</h2>
      <span v-if="section === 'Tasks'" class="legend"><span class="legend-dot">◉</span> Worked Today</span>
    </div>

    <TaskRow
      v-for="task in tasks"
      :key="task.raw"
      :task="task"
      :projects="projects"
      :jira-base-url="jiraBaseUrl"
      :raw-content="rawContent"
      @change="onTaskChange"
      @delete="onDelete"
    />

    <!-- add row -->
    <div class="task-add-row">
      <button v-if="!adding" class="btn-add-task" @click="startAdd">+ Add</button>
      <WikilinkInput
        v-else
        model-value=""
        :projects="projects"
        :jira-base-url="jiraBaseUrl"
        :auto-edit="true"
        @commit="onAdd"
        @cancel="adding = false"
      />
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue'
import { parseTaskLines } from '../utils/parser.js'
import { addTaskToSection, deleteTaskFromSection, replaceLine } from '../utils/mutations.js'
import TaskRow from './TaskRow.vue'
import WikilinkInput from './WikilinkInput.vue'

const props = defineProps({
  title:      { type: String, required: true },
  section:    { type: String, required: true },   // "Tasks" | "On Deck"
  lines:      { type: Array,  default: () => [] },
  projects:   { type: Array,  default: () => [] },
  jiraBaseUrl:{ type: String, default: '' },
  rawContent: { type: String, required: true },
})
const emit = defineEmits(['update:rawContent'])

const tasks = computed(() => parseTaskLines(props.lines))
const adding = ref(false)

function startAdd() { adding.value = true }

function onAdd(text) {
  adding.value = false
  if (!text.trim()) return
  emit('update:rawContent', addTaskToSection(props.rawContent, props.section, text.trim()))
}

function onDelete(rawLine) {
  emit('update:rawContent', deleteTaskFromSection(props.rawContent, rawLine))
}

function onTaskChange({ oldRaw, newRaw, fullContent }) {
  if (fullContent !== undefined) {
    // Body edit — fullContent is already the new rawContent
    emit('update:rawContent', fullContent)
  } else {
    emit('update:rawContent', replaceLine(props.rawContent, oldRaw, newRaw))
  }
}
</script>

<style scoped>
.panel {
  overflow-y: auto;
  min-height: 0;
  background: #252526;
  border: 1px solid #3e3e42;
  border-radius: 4px;
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
}
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #808080;
  margin: 0;
}
.panel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
.legend {
  font-size: 10px;
  color: #555;
  white-space: nowrap;
}
.legend-dot { color: #d4a017; }
.task-add-row {
  display: flex;
  align-items: center;
  margin-top: 4px;
  flex-shrink: 0;
}
.btn-add-task {
  background: none;
  border: none;
  color: #808080;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
}
.btn-add-task:hover { color: #cccccc; background: #2d2d30; }
/* WikilinkInput in add mode fills the row */
.task-add-row :deep(.wikilink-edit-wrap) { flex: 1; }
</style>
