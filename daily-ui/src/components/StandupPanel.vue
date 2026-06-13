<template>
  <section class="panel">
    <h2>Standup</h2>
    <div class="sf">
      <label>Yesterday</label>
      <textarea v-model="yesterday" placeholder="- item" @blur="emit('change', current)" />
    </div>
    <div class="sf">
      <label>Today</label>
      <textarea v-model="today" placeholder="- item" @blur="emit('change', current)" />
    </div>
    <div class="sf">
      <label>Blockers</label>
      <input type="text" v-model="blockers" placeholder="None" @blur="emit('change', current)" />
    </div>
  </section>
</template>

<script setup>
import { ref, watch, computed } from 'vue'

const props = defineProps({
  standup: { type: Object, default: () => ({ yesterday: [], today: [], blockers: '' }) },
})
const emit = defineEmits(['change'])

const yesterday = ref('')
const today     = ref('')
const blockers  = ref('')

watch(() => props.standup, s => {
  yesterday.value = s.yesterday.map(l => `- ${l}`).join('\n')
  today.value     = s.today.map(l => `- ${l}`).join('\n')
  blockers.value  = s.blockers
}, { immediate: true })

const current = computed(() => ({
  yesterday: yesterday.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^-\s*/, '')),
  today:     today.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^-\s*/, '')),
  blockers:  blockers.value.trim(),
}))
</script>

<style scoped>
.panel {
  overflow-y: auto;
  min-height: 0;
  background: #252526;
  border: 1px solid #3e3e42;
  border-radius: 4px;
  padding: 10px 12px 12px;
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
}
.sf { margin-bottom: 9px; }
.sf label {
  display: block;
  font-size: 11px;
  color: #808080;
  font-weight: 600;
  margin-bottom: 3px;
}
.sf textarea, .sf input[type=text] {
  width: 100%;
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #cccccc;
  padding: 5px 8px;
  font-family: inherit;
  font-size: 13px;
  border-radius: 3px;
  box-sizing: border-box;
}
.sf textarea { min-height: 56px; resize: vertical; }
.sf textarea:focus, .sf input:focus {
  outline: none;
  border-color: #007acc;
  box-shadow: 0 0 0 1px #007acc;
}
</style>
