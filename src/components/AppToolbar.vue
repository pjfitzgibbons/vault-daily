<template>
  <header id="toolbar">
    <div class="nav">
      <button data-action="nav-prev" @click="navigatePrev">←</button>
      <button data-action="nav-today" @click="navigateToday">Today</button>
      <span class="date-label">{{ currentDate }}</span>
      <button data-action="nav-next" @click="navigateNext">→</button>
    </div>
    <div class="spacer" />
    <button
      class="theme-toggle"
      data-action="theme-toggle"
      :title="`Theme: ${themeLabel} (click to change)`"
      @click="cycleTheme"
    >{{ themeGlyph }} {{ themeLabel }}</button>
    <button data-action="roll-forward" @click="emit('roll-forward')">↻ Roll Forward</button>
    <button
      data-action="standup-open"
      :disabled="submitting"
      @click="emit('submit-standup')"
    >☁ Standup</button>
    <button data-action="time-entries" @click="emit('time-entries')">⏱ Time Entries</button>
    <button class="primary" :disabled="!dirty" data-action="save" @click="emit('save')">Save</button>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { todayStr, addOneDay, subOneDay } from '../utils/rollForward.js'
import { useTheme } from '../composables/useTheme.js'

const props = defineProps({
  currentDate: { type: String, required: true },
  dirty:       { type: Boolean, default: false },
  submitting:  { type: Boolean, default: false },
})
const emit = defineEmits(['navigate', 'roll-forward', 'submit-standup', 'time-entries', 'save'])

const { mode, cycleTheme } = useTheme()
const themeGlyph = computed(() =>
  ({ auto: '🖥', light: '☀', dark: '☾' })[mode.value] ?? '🖥'
)
const themeLabel = computed(() =>
  ({ auto: 'Auto', light: 'Light', dark: 'Dark' })[mode.value] ?? 'Auto'
)

const today = computed(() => todayStr())

function addDays(date, n) {
  if (n > 0) return addOneDay(date)
  return subOneDay(date)
}

function navigatePrev() {
  emit('navigate', addDays(props.currentDate, -1), 'prev')
}

function navigateToday() {
  emit('navigate', today.value, 'today')
}

function navigateNext() {
  emit('navigate', addDays(props.currentDate, 1), 'next')
}
</script>

<style scoped>
#toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: var(--c-bg-panel);
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
.spacer { flex: 1; }
.nav { display: flex; align-items: center; gap: 4px; }
.date-label {
  font-weight: 600;
  min-width: 104px;
  text-align: center;
  line-height: 26px;
}
button {
  box-sizing: border-box;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 0 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
}
button:hover:not(:disabled) { background: var(--c-border); border-color: var(--c-border-strong); }
button:disabled { opacity: .35; cursor: default; }
.primary { background: var(--c-accent); border-color: var(--c-accent); color: #fff; }
.primary:hover:not(:disabled) { background: var(--c-accent-hover); }
.theme-toggle { gap: 5px; }
</style>
