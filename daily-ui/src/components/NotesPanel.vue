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

const props = defineProps({
  lines: { type: Array, default: () => [] },
})
const emit = defineEmits(['change'])

const draft = ref('')
const taRef = ref(null)

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
  overflow: hidden;
  background: #252526;
  border: 1px solid #3e3e42;
  border-radius: 4px;
  padding: 10px 12px 12px;
  min-height: 0;
}
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #808080;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #cccccc;
  padding: 7px 8px;
  font-family: 'SF Mono', 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  border-radius: 3px;
  resize: none;
  box-sizing: border-box;
}
textarea:focus {
  outline: none;
  border-color: #007acc;
  box-shadow: 0 0 0 1px #007acc;
}
.footer { flex-shrink: 0; margin-top: 7px; }
button {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #cccccc;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
button:hover { background: #3e3e42; }
</style>
