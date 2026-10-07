import test from 'node:test'
import assert from 'node:assert/strict'

import { buildNextDayContent } from '../src/utils/rollForward.js'
import { parseSections } from '../src/utils/parser.js'
import { rebuildWeeklyUpdateSection, rebuildNotesSection } from '../src/utils/mutations.js'

test('parseSections exposes Weekly Update as its own section on Fridays', () => {
  // 2026-07-10 is a Friday, so the note includes a Weekly Update section.
  const content = buildNextDayContent('2026-07-10', [], [], [], [], [])
  const { sections } = parseSections(content)
  assert.ok(sections['Weekly Update'], 'Weekly Update section should exist')
  const body = sections['Weekly Update'].join('\n')
  assert.match(body, /Hi Karen,/)
  assert.match(body, /### Wins this week/)
  assert.match(body, /Kindest Regards,\nPeter Fitzgibbons/)
})

test('rebuildWeeklyUpdateSection replaces only the Weekly Update body', () => {
  const content = buildNextDayContent('2026-07-10', [], [], [], [], [])
  const edited = rebuildWeeklyUpdateSection(content, 'Hi Karen,\n\nDraft snapshot.')
  const { sections } = parseSections(edited)
  assert.equal(sections['Weekly Update'].join('\n').trim(), 'Hi Karen,\n\nDraft snapshot.')
  // Other sections remain intact.
  assert.ok(sections['Notes'])
  assert.ok(sections['Tasks'])
})

test('rebuildNotesSection stops at the Weekly Update heading', () => {
  const content = buildNextDayContent('2026-07-10', [], [], [], [], [])
  const edited = rebuildNotesSection(content, 'my notes text')
  const { sections } = parseSections(edited)
  assert.equal(sections['Notes'].join('\n').trim(), 'my notes text')
  // Weekly Update survives untouched.
  assert.match(sections['Weekly Update'].join('\n'), /### Priorities for next week/)
})
