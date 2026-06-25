<template>
  <header id="toolbar">
    <div class="nav">
      <button data-action="nav-prev" @click="navigatePrev">←</button>
      <button data-action="nav-today" @click="navigateToday">Today</button>
      <span class="date-label">{{ currentDate }}</span>
      <button data-action="nav-next" @click="navigateNext">→</button>
    </div>
    <div class="spacer" />
    <button data-action="roll-forward" @click="emit('roll-forward')">↻ Roll Forward</button>
    <button
      data-action="standup-open"
      :disabled="submitting"
      @click="emit('submit-standup')"
    >☁ Standup</button>
    <button class="primary" :disabled="!dirty" data-action="save" @click="emit('save')">Save</button>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { todayStr, addOneDay, subOneDay } from '../utils/rollForward.js'

const props = defineProps({
  currentDate: { type: String, required: true },
  dirty:       { type: Boolean, default: false },
  submitting:  { type: Boolean, default: false },
})
const emit = defineEmits(['navigate', 'roll-forward', 'submit-standup', 'save'])

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
  background: #252526;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
.spacer { flex: 1; }
.nav { display: flex; align-items: center; gap: 4px; }
.date-label { font-weight: 600; min-width: 104px; text-align: center; }
button {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #cccccc;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
button:hover:not(:disabled) { background: #3e3e42; border-color: #999; }
button:disabled { opacity: .35; cursor: default; }
.primary { background: #007acc; border-color: #007acc; color: #fff; }
.primary:hover:not(:disabled) { background: #1a8ad4; }
</style>
