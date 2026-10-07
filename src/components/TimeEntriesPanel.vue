<template>
  <section class="panel">
    <div class="panel-header">
      <h2>Time Entries</h2>
      <span class="hint">Click a cell to edit · saves on blur</span>
    </div>
    <table>
      <thead>
        <tr><th>Time</th><th>Ticket</th><th>Posting Time</th><th class="col-delete"></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="i" class="entry-row">
          <td
            v-for="col in COLUMNS"
            :key="col"
            contenteditable="true"
            :class="col"
            @keydown.enter.prevent="$event.target.blur()"
            @blur="onCellBlur(i, col, $event)"
          >{{ row[col] }}</td>
          <td class="col-delete">
            <button class="btn-delete" title="Delete" @click="onDeleteRow(i)">×</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- add row -->
    <div class="entry-add-row">
      <button class="btn-add-entry" @click="onAddRow">+ Add entry</button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { parseTimeEntryRows, timeEntriesBodyLines } from '../utils/timeEntries.js'
import { setSectionBody } from '../utils/mutations.js'

const COLUMNS = ['time', 'ticket', 'posting']

const props = defineProps({
  lines:      { type: Array,  default: () => [] },
  rawContent: { type: String, required: true },
})
const emit = defineEmits(['update:rawContent'])

const rows = computed(() => parseTimeEntryRows(props.lines))

function onCellBlur(index, col, e) {
  const text = e.target.innerText.replace(/\r?\n/g, ' ').trim()
  if (text === rows.value[index][col]) return
  const next = rows.value.map((r, i) => (i === index ? { ...r, [col]: text } : r))
  emit('update:rawContent', setSectionBody(props.rawContent, 'Time Entries', timeEntriesBodyLines(next)))
}

function onDeleteRow(index) {
  const next = rows.value.filter((_, i) => i !== index)
  emit('update:rawContent', setSectionBody(props.rawContent, 'Time Entries', timeEntriesBodyLines(next)))
}

function onAddRow() {
  const next = [...rows.value, { time: '', ticket: '', posting: '' }]
  emit('update:rawContent', setSectionBody(props.rawContent, 'Time Entries', timeEntriesBodyLines(next)))
}
</script>

<style scoped>
.panel {
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  padding: 10px 12px 12px;
  margin: 0 8px 8px;
}
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--c-text-dim);
  margin: 0;
}
.panel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--c-border);
}
.hint { font-size: 10px; color: var(--c-text-faint); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  font-size: 11px;
  color: var(--c-text-dim);
  font-weight: 600;
  padding: 4px 8px;
  border-bottom: 1px solid var(--c-border);
}
th.col-delete {
  text-align: center;
  width: 20px;
  padding: 4px 2px;
}
td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--c-border);
  outline: none;
}
td:focus { background: var(--c-bg-input); box-shadow: inset 0 0 0 1px var(--c-accent); }
td.time { width: 90px; font-variant-numeric: tabular-nums; }
td.ticket { width: 110px; font-weight: 600; }
td.col-delete {
  width: 20px;
  padding: 4px 2px;
  text-align: center;
}
.entry-row:hover .btn-delete { opacity: 1; }

/* delete button */
.btn-delete {
  opacity: 0;
  transition: opacity .12s, color .12s;
  background: none;
  border: none;
  color: var(--c-text-dim);
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
}
.btn-delete:hover { color: var(--c-danger); }

/* add entry row */
.entry-add-row {
  display: flex;
  align-items: center;
  margin-top: 4px;
}
.btn-add-entry {
  background: none;
  border: none;
  color: var(--c-text-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
}
.btn-add-entry:hover { color: var(--c-text); background: var(--c-bg-input); }
</style>
