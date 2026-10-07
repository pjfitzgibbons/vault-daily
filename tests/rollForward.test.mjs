import test from 'node:test'
import assert from 'node:assert/strict'

import { addOneDay, buildNextDayContent, isFriday } from '../src/utils/rollForward.js'

function section(content, heading, nextHeading) {
  const start = content.indexOf(`## ${heading}\n`)
  if (start < 0) return ''
  const from = start + `## ${heading}\n`.length
  const end = nextHeading ? content.indexOf(`\n## ${nextHeading}\n`, from) : content.length
  return (end >= 0 ? content.slice(from, end) : content.slice(from)).trim()
}

test('roll forward includes worked On Deck items in Standup Today and Tasks', () => {
  const content = buildNextDayContent(
    '2026-06-16',
    ['CP-100 - finished thing'],
    ['CP-101 - task worked'],
    ['CP-102 - task remaining'],
    ['CP-103 - ondeck worked'],
    ['- [ ] CP-104 - ondeck remaining']
  )

  const today = section(content, 'Standup', 'Tasks')
  const tasks = section(content, 'Tasks', 'On Deck')
  const onDeck = section(content, 'On Deck', 'Notes')

  assert.match(today, /Continuing ondeck worked \(CP-103\)/)
  assert.match(tasks, /- \[ \] CP-103 - ondeck worked/)
  assert.match(onDeck, /- \[ \] CP-104 - ondeck remaining/)
})

test('addOneDay skips weekend', () => {
  assert.equal(addOneDay('2026-06-12'), '2026-06-15')
})

test('Weekly Update is appended only on Fridays', () => {
  // 2026-07-10 is a Friday.
  assert.equal(isFriday('2026-07-10'), true)
  const friday = buildNextDayContent('2026-07-10', [], [], [], [], [])
  assert.match(friday, /## Weekly Update/)
  assert.match(friday, /### Wins this week/)
  assert.match(friday, /### Unblocked or moved forward/)
  assert.match(friday, /### Risks or blockers on my radar/)
  assert.match(friday, /### Priorities for next week/)
  assert.match(friday, /Kindest Regards,\nPeter Fitzgibbons/)

  // 2026-07-09 is a Thursday — no Weekly Update.
  assert.equal(isFriday('2026-07-09'), false)
  const thursday = buildNextDayContent('2026-07-09', [], [], [], [], [])
  assert.doesNotMatch(thursday, /## Weekly Update/)
})
