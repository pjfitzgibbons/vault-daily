const { test, expect } = require('@playwright/test')

function collectClientLogEvents(page) {
  const events = []
  page.on('request', req => {
    if (!req.url().includes('/api/client-log') || req.method() !== 'POST') return
    try {
      const payload = JSON.parse(req.postData() || '{}')
      events.push(payload)
    } catch {
      // ignore malformed payloads in test collection
    }
  })
  return events
}

function hasEvent(events, name) {
  return events.some(e => e && e.event === name)
}

test('standup nav + modal interactions emit client-log events', async ({ page }) => {
  const events = collectClientLogEvents(page)

  await page.goto('/2026-06-15')

  await page.getByRole('button', { name: '☁ Standup' }).click()
  await expect(page.getByRole('heading', { name: 'Submit Standup to Jira' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: '☁ Standup' }).click()
  await page.getByRole('button', { name: 'Submit' }).click()

  // Submit may fail due Jira credentials in test env, but event emission must still happen.
  await expect.poll(() => hasEvent(events, 'standup-submit.started')).toBe(true)

  expect(hasEvent(events, 'toolbar.standup.clicked')).toBe(true)
  expect(hasEvent(events, 'jira-modal.state-changed')).toBe(true)
  expect(hasEvent(events, 'jira-modal.close')).toBe(true)
  expect(hasEvent(events, 'jira-modal.submit.clicked')).toBe(true)
})

test('inline edits and controls emit interaction logs', async ({ page }) => {
  const events = collectClientLogEvents(page)

  const date = '2026-06-15'
  const seededContent = [
    '# Daily',
    '',
    '## Standup',
    '- Yesterday',
    '- Today',
    '- Blockers',
    '',
    '## Tasks',
    '- [ ] TEST-1 logging interaction task',
    '',
    '## Notes',
    'seeded notes',
    '',
    '## On Deck',
    '- [ ] TEST-2 on deck item',
    '',
  ].join('\n')

  const seedRes = await page.request.put(`/api/daily/${date}`, {
    data: { content: seededContent },
  })
  expect(seedRes.ok()).toBeTruthy()

  await page.goto(`/${date}`)
  const tasksPanel = page.locator('#section-tasks')
  const seededTask = tasksPanel.locator('.task-item').filter({
    hasText: 'TEST-1 logging interaction task',
  }).first()
  await expect(seededTask).toBeVisible()

  // Checkbox toggle interaction.
  await seededTask.locator('input[type="checkbox"]').check()

  // Notes input interaction.
  const notes = page.locator('section.notes-panel textarea')
  await notes.fill('interaction logging notes')
  await page.getByRole('heading', { name: 'Notes' }).click()

  await expect.poll(() => events.filter(e => String(e?.event || '').startsWith('ui.interaction.')).length).toBeGreaterThan(5)

  expect(hasEvent(events, 'ui.interaction.click')).toBe(true)
  expect(hasEvent(events, 'ui.interaction.input')).toBe(true)
  expect(hasEvent(events, 'ui.interaction.change')).toBe(true)
})
