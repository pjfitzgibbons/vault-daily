import test from 'node:test'
import assert from 'node:assert/strict'

import { addOneDay, buildNextDayContent } from '../src/utils/rollForward.js'

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
