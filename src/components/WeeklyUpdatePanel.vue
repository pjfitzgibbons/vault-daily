<template>
  <section class="panel weekly-panel">
    <header class="weekly-head">
      <h2>Weekly Update</h2>
      <div class="weekly-tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: mode === 'edit' }"
          @click="mode = 'edit'"
        >Edit</button>
        <button
          type="button"
          class="tab"
          :class="{ active: mode === 'preview' }"
          @click="mode = 'preview'"
        >Preview</button>
      </div>
      <button
        type="button"
        class="draft-btn"
        :disabled="drafting"
        data-action="weekly-redraft"
        @click="emit('redraft')"
      >{{ drafting ? 'Drafting…' : 'Draft with Claude' }}</button>
      <button
        v-if="mode === 'preview'"
        type="button"
        class="draft-btn"
        data-action="weekly-copy"
        @click="copyFormatted"
      >{{ copied ? 'Copied ✓' : 'Copy formatted' }}</button>
    </header>
    <textarea
      ref="taRef"
      v-show="mode === 'edit'"
      v-model="draft"
      spellcheck="false"
      :disabled="drafting"
      @blur="emit('change', draft)"
    />
    <div v-if="mode === 'preview'" class="weekly-preview" v-html="html" />
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import { useAutosize } from '../composables/useAutosize.js'

const props = defineProps({
  lines: { type: Array, default: () => [] },
  drafting: { type: Boolean, default: false },
})
const emit = defineEmits(['change', 'redraft'])

const draft = ref('')
const taRef = ref(null)
const mode = ref('edit')
const copied = ref(false)

const html = computed(() => marked.parse(draft.value || ''))

useAutosize(taRef, () => draft.value)

watch(() => props.lines, lines => {
  draft.value = lines.join('\n').trim()
}, { immediate: true })

async function copyFormatted() {
  // Wrap in explicit light styling so Office never inherits dark-mode colors.
  const body = html.value.replace(/<a /g, '<a style="color:#0563c1" ')
  const rendered =
    '<div style="color:#000000;background-color:#ffffff;' +
    'font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4">' +
    body + '</div>'
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([rendered], { type: 'text/html' }),
        'text/plain': new Blob([draft.value], { type: 'text/plain' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(draft.value)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>

<style scoped>
.weekly-panel {
  display: flex;
  flex-direction: column;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  padding: 10px 12px 12px;
  min-height: 0;
}
.weekly-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--c-warn);
  margin: 0;
}
.weekly-tabs {
  display: inline-flex;
  gap: 2px;
}
.tab {
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text);
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .12s, color .12s;
}
.tab:hover:not(.active) {
  border-color: var(--c-border);
  color: var(--c-text-strong);
}
.tab.active {
  color: var(--c-text-strong);
  border-color: var(--c-accent);
}
.draft-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text);
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  border-radius: 3px;
  padding: 3px 9px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .12s, color .12s;
}
.draft-btn:hover:not(:disabled) {
  border-color: var(--c-accent);
  color: var(--c-text-strong);
}
.draft-btn:disabled {
  opacity: .6;
  cursor: default;
}
textarea {
  min-height: 120px;
  width: 100%;
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 7px 8px;
  font-family: 'SF Mono', 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.5;
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
.weekly-preview {
  min-height: 120px;
  width: 100%;
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 7px 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 3px;
  box-sizing: border-box;
  overflow-y: auto;
}
.weekly-preview h1,
.weekly-preview h2,
.weekly-preview h3 {
  margin: 8px 0 4px;
  font-weight: 600;
  color: var(--c-text-strong);
}
.weekly-preview h1 {
  font-size: 16px;
}
.weekly-preview h2 {
  font-size: 14px;
}
.weekly-preview h3 {
  font-size: 13px;
}
.weekly-preview p {
  margin: 4px 0;
}
.weekly-preview ul,
.weekly-preview ol {
  margin: 4px 0;
  padding-left: 20px;
}
.weekly-preview li {
  margin: 2px 0;
}
.weekly-preview a {
  color: var(--c-accent);
  text-decoration: none;
}
.weekly-preview a:hover {
  text-decoration: underline;
}
.weekly-preview strong {
  font-weight: 600;
  color: var(--c-text-strong);
}
.weekly-preview em {
  font-style: italic;
}
.weekly-preview code {
  font-family: 'SF Mono', 'Consolas', 'Menlo', monospace;
  background: var(--c-bg);
  color: var(--c-code);
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 11px;
}
</style>
