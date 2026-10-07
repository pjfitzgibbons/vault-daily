import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactRange, rowsFromDraft, timeEntriesBodyLines, parseTimeEntryRows } from '../src/utils/timeEntries.js'
import { setSectionBody } from '../src/utils/mutations.js'

test('compactRange drops colons and joins 24-hour ranges', () => {
  assert.equal(compactRange('16:30-17:00'), '1630-1700')
  assert.equal(compactRange('14:00-15:00'), '1400-1500')
})

test('rowsFromDraft maps blocks to time/ticket/posting rows', () => {
  const rows = rowsFromDraft({ blocks: [
    { hour_label: '16:00-16:30', dominant_ticket: 'CIAM-3', detail: 'Continued planning' },
    { hour_label: '08:00-09:00', dominant_ticket: null, detail: null },
  ] })
  assert.deepEqual(rows, [
    { time: '1600-1630', ticket: 'CIAM-3', posting: 'Continued planning' },
    { time: '0800-0900', ticket: '', posting: '' },
  ])
})

test('table round-trips through markdown, including escaped pipes', () => {
  const rows = [{ time: '1400-1500', ticket: 'IIT-2', posting: 'a | b' }]
  const lines = timeEntriesBodyLines(rows)
  assert.deepEqual(parseTimeEntryRows(lines), rows)
})

test('parseTimeEntryRows ignores non-table content', () => {
  assert.deepEqual(parseTimeEntryRows(['', 'just text']), [])
})

test('setSectionBody replaces an existing section body and keeps neighbours', () => {
  const doc = ['# d', '', '## Notes', 'n', '', '## Time Entries', 'old', '', '## Tail', 'x', ''].join('\n')
  const out = setSectionBody(doc, 'Time Entries', ['| Time | Ticket | Posting Time |', 'new'])
  assert.equal(out, ['# d', '', '## Notes', 'n', '', '## Time Entries', '| Time | Ticket | Posting Time |', 'new', '', '## Tail', 'x', ''].join('\n'))
})

test('setSectionBody appends a missing section at the end', () => {
  const out = setSectionBody('# d\n\n## Notes\nn\n', 'Time Entries', ['row'])
  assert.equal(out, '# d\n\n## Notes\nn\n\n## Time Entries\nrow\n')
})

test('blank rows round-trip through markdown', () => {
  const rows = [
    { time: '1400-1500', ticket: 'CIAM-1', posting: 'some work' },
    { time: '', ticket: '', posting: '' },
    { time: '1600-1700', ticket: 'CIAM-2', posting: '' },
  ]
  const lines = timeEntriesBodyLines(rows)
  assert.deepEqual(parseTimeEntryRows(lines), rows)
})
