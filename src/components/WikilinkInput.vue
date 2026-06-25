<template>
  <span v-if="!editing" class="wikilink-display" @click="startEdit">
    <template v-for="(part, i) in displayParts" :key="i">
      <span v-if="part.type === 'link'" class="wikilink-badge">{{ part.text }}</span>
      <a
        v-else-if="part.type === 'ticket' && jiraIssueUrl(part.text)"
        class="ticket-ref"
        :href="jiraIssueUrl(part.text)"
        target="_blank"
        rel="noopener noreferrer"
        @click.stop
      >{{ part.text }}</a>
      <span v-else-if="part.type === 'ticket'" class="ticket-ref">{{ part.text }}</span>
      <span v-else>{{ part.text }}</span>
    </template>
  </span>

  <span v-else class="wikilink-edit-wrap">
    <input
      ref="inputEl"
      v-model="draft"
      class="task-edit-input"
      @keydown="onKeydown"
      @input="onInput"
      @blur="onBlur"
    />
    <ul v-if="suggestions.length" class="wl-dropdown">
      <li
        v-for="(s, i) in suggestions"
        :key="s"
        :class="{ active: i === highlightIdx }"
        @mousedown.prevent="pickSuggestion(s)"
      >{{ s }}</li>
    </ul>
  </span>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  projects:   { type: Array,  default: () => [] },
  jiraBaseUrl:{ type: String, default: '' },
  autoEdit:   { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'commit', 'cancel'])

// ── display ──────────────────────────────────────────────────────────────────
const displayParts = computed(() => {
  const parts = []
  const src = props.modelValue
  // tokenise: [[link]], TICKET-123, plain text
  const re = /(\[\[([^\]]+)\]\])|(\b[A-Z]+-\d+\b)/g
  let last = 0, m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push({ type: 'plain', text: src.slice(last, m.index) })
    if (m[1]) parts.push({ type: 'link',   text: m[2] })
    else       parts.push({ type: 'ticket', text: m[3] })
    last = m.index + m[0].length
  }
  if (last < src.length) parts.push({ type: 'plain', text: src.slice(last) })
  return parts
})

// ── edit ──────────────────────────────────────────────────────────────────────
const editing      = ref(false)
const draft        = ref('')
const inputEl      = ref(null)
const highlightIdx = ref(0)
let   triggerStart = -1   // index in draft where [[ was typed

const suggestions = computed(() => {
  if (triggerStart === -1) return []
  const q = draft.value.slice(triggerStart + 2).toLowerCase()
  return props.projects.filter(p => p.toLowerCase().includes(q)).slice(0, 8)
})

function startEdit() {
  draft.value = props.modelValue
  editing.value = true
  triggerStart = -1
  nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
}

onMounted(() => {
  if (props.autoEdit) startEdit()
})

function onInput() {
  const val = draft.value
  const cursor = inputEl.value?.selectionStart ?? val.length
  // detect [[ trigger
  const before = val.slice(0, cursor)
  const idx = before.lastIndexOf('[[')
  if (idx !== -1 && !before.slice(idx + 2).includes(']]')) {
    triggerStart = idx
    highlightIdx.value = 0
  } else {
    triggerStart = -1
  }
}

function pickSuggestion(name) {
  // Replace from [[ up to cursor with [[name]]
  const val    = draft.value
  const cursor = inputEl.value?.selectionStart ?? val.length
  const before = val.slice(0, triggerStart)
  const after  = val.slice(cursor)
  draft.value  = `${before}[[${name}]]${after}`
  triggerStart = -1
  nextTick(() => {
    const pos = (before + `[[${name}]]`).length
    inputEl.value?.setSelectionRange(pos, pos)
    inputEl.value?.focus()
  })
}

function onKeydown(e) {
  if (suggestions.value.length) {
    if (e.key === 'ArrowDown')  { e.preventDefault(); highlightIdx.value = (highlightIdx.value + 1) % suggestions.value.length; return }
    if (e.key === 'ArrowUp')    { e.preventDefault(); highlightIdx.value = (highlightIdx.value - 1 + suggestions.value.length) % suggestions.value.length; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSuggestion(suggestions.value[highlightIdx.value]); return }
    if (e.key === 'Escape')     { triggerStart = -1; return }
  }
  if (e.key === 'Enter')  { e.preventDefault(); commit() }
  if (e.key === 'Escape') { e.preventDefault(); cancel() }
}

function onBlur() {
  // Small delay so mousedown on suggestion fires first
  setTimeout(() => {
    if (editing.value) commit()
  }, 120)
}

function commit() {
  const val = draft.value.trim() || props.modelValue
  editing.value = false
  triggerStart  = -1
  emit('update:modelValue', val)
  emit('commit', val)
}

function cancel() {
  editing.value = false
  triggerStart  = -1
  emit('cancel')
}

function jiraIssueUrl(ticket) {
  const base = String(props.jiraBaseUrl || '').replace(/\/$/, '')
  if (!base) return ''
  return `${base}/browse/${ticket}`
}
</script>

<style scoped>
.wikilink-display {
  cursor: text;
  flex: 1;
  font-size: 13px;
  word-break: break-word;
}
.wikilink-badge {
  display: inline-block;
  background: rgba(0,122,204,.13);
  color: #6b9bd2;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  margin: 0 1px;
}
.ticket-ref {
  display: inline-block;
  color: #007acc;
  font-size: 11px;
  font-weight: 600;
  background: rgba(0,122,204,.13);
  padding: 1px 4px;
  border-radius: 2px;
  text-decoration: none;
  cursor: pointer;
}
.ticket-ref:hover {
  text-decoration: underline;
  background: rgba(0,122,204,.25);
}
.wikilink-edit-wrap {
  position: relative;
  flex: 1;
  display: flex;
}
.task-edit-input {
  flex: 1;
  background: #2d2d30;
  border: 1px solid #007acc;
  box-shadow: 0 0 0 1px #007acc;
  border-radius: 3px;
  color: #cccccc;
  font-family: inherit;
  font-size: 13px;
  padding: 1px 6px;
  outline: none;
  width: 100%;
}
.wl-dropdown {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  min-width: 180px;
  background: #2d2d30;
  border: 1px solid #3e3e42;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
  z-index: 200;
  list-style: none;
  margin: 0;
  padding: 3px 0;
  font-size: 13px;
}
.wl-dropdown li {
  padding: 5px 12px;
  cursor: pointer;
  color: #cccccc;
  white-space: nowrap;
}
.wl-dropdown li:hover,
.wl-dropdown li.active {
  background: rgba(255,255,255,.07);
}
</style>
