<template>
  <section class="panel notes-panel">
    <h2>Notes</h2>
    <textarea
      ref="taRef"
      v-model="draft"
      spellcheck="false"
      @blur="emit('change', draft)"
    />
    <div class="footer">
      <button @click="insertTime">⏱ Insert Time</button>
    </div>
  </section>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useAutosize } from '../composables/useAutosize.js'

const props = defineProps({
  lines: { type: Array, default: () => [] },
})
const emit = defineEmits(['change'])

const draft = ref('')
const taRef = ref(null)

useAutosize(taRef, () => draft.value)

watch(() => props.lines, lines => {
  draft.value = lines.join('\n').trimEnd()
}, { immediate: true })

function pad(n) { return String(n).padStart(2, '0') }

function insertTime() {
  const ta  = taRef.value
  const now = new Date()
  const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const pos = ta.selectionStart
  const val = ta.value
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1
  const lineText  = val.slice(lineStart, pos)
  const insert    = lineText.trim() === '' ? ts + ' ' : '\n' + ts + ' '
  draft.value     = val.slice(0, pos) + insert + val.slice(pos)
  emit('change', draft.value)
  nextTick(() => {
    ta.setSelectionRange(pos + insert.length, pos + insert.length)
    ta.focus()
  })
}
</script>

<style scoped>
.notes-panel {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  padding: 10px 12px 12px;
  min-height: 0;
}
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--c-text-dim);
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
textarea {
  min-height: 80px;
  width: 100%;
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 7px 8px;
  font-family: 'SF Mono', 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  border-radius: 3px;
  resize: vertical;
  overflow-y: hidden;
  box-sizing: border-box;
}
textarea:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 1px var(--c-accent);
}
.footer { flex-shrink: 0; margin-top: 7px; }
button {
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
button:hover { background: var(--c-border); }
</style>
