import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  moveTaskBetweenSections,
  promoteSettledOnDeck,
  editTaskBody,
  plainTaskLine,
  isSettledTask,
} from '../src/utils/mutations.js'

const doc = (tasks, onDeck) => [
  '## Tasks', ...tasks, '', '## On Deck', ...onDeck, '', '## Notes', 'n', ''
].join('\n')

test('isSettledTask: checked, worked flag, or non-wip status', () => {
  assert.equal(isSettledTask('- [x] foo'), true)
  assert.equal(isSettledTask('- [ ] > foo'), true)
  assert.equal(isSettledTask('- [ ] qa CIAM-1 foo'), true)
  assert.equal(isSettledTask('- [ ] wip foo'), false)
  assert.equal(isSettledTask('- [ ] foo'), false)
  assert.equal(isSettledTask('- '), false)
})

test('promoteSettledOnDeck moves settled On Deck lines to end of Tasks', () => {
  const before = doc(['- [ ] a'], ['- [ ] > b', '- [ ] c', '- [ ] in-review d'])
  const after = promoteSettledOnDeck(before)
  assert.equal(after, doc(['- [ ] a', '- [ ] > b', '- [ ] in-review d'], ['- [ ] c']))
})

test('promoteSettledOnDeck is a no-op when nothing is settled', () => {
  const before = doc(['- [ ] a'], ['- [ ] c', '- '])
  assert.equal(promoteSettledOnDeck(before), before)
})

test('moveTaskBetweenSections drops a Tasks line onto On Deck as a plain wip line', () => {
  const before = doc(['- [ ] > qa CIAM-9 thing', '- [x] done one'], ['- '])
  const after = moveTaskBetweenSections(before, 'Tasks', 'On Deck', '- [ ] > qa CIAM-9 thing')
  assert.equal(after, doc(['- [x] done one'], ['- ', '- [ ] CIAM-9 thing']))
})

test('moveTaskBetweenSections keeps the line as-is when dropped onto Tasks', () => {
  const before = doc(['- [ ] a'], ['- [ ] b'])
  const after = moveTaskBetweenSections(before, 'On Deck', 'Tasks', '- [ ] b')
  assert.equal(after, doc(['- [ ] a', '- [ ] b'], []))
})

test('moveTaskBetweenSections only removes from the named source section', () => {
  const before = doc(['- [ ] dup'], ['- [ ] dup'])
  const after = moveTaskBetweenSections(before, 'On Deck', 'Tasks', '- [ ] dup')
  assert.equal(after, doc(['- [ ] dup', '- [ ] dup'], []))
})

test('editTaskBody with autoWorked:false does not flag an On Deck item', () => {
  const content = doc([], ['- [ ] old'])
  const out = editTaskBody(content, '- [ ] old', 'new', { autoWorked: false })
  assert.match(out, /^- \[ \] new$/m)
  assert.doesNotMatch(out, /> new/)
})

test('editTaskBody default still flags a Tasks item as worked', () => {
  const out = editTaskBody(doc(['- [ ] old'], []), '- [ ] old', 'new')
  assert.match(out, /^- \[ \] > new$/m)
})

test('plainTaskLine strips checkbox state, worked flag and status', () => {
  assert.equal(plainTaskLine('- [x] > in-review foo'), '- [ ] foo')
})
