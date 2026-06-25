# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: interactions.logging.spec.js >> standup nav + modal interactions emit client-log events
- Location: tests/e2e/interactions.logging.spec.js:21:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Submit Standup to Jira' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Submit Standup to Jira' })

```

```yaml
- banner:
  - button "←"
  - button "Today"
  - text: 2026-06-15
  - button "→"
  - button "↻ Roll Forward"
  - button "☁ Standup"
  - button "Save" [disabled]
- text: daily/2026-06-15.md
- main:
  - heading "Standup" [level=2]
  - text: Yesterday
  - textbox "- item"
  - text: Today
  - textbox "- item"
  - text: Blockers
  - textbox "None"
  - heading "Tasks" [level=2]
  - text: ◉ Worked Today
  - checkbox
  - button "◉"
  - text: WIP ▾
  - link "TEST-1":
    - /url: https://cryoport.atlassian.net/browse/TEST-1
  - text: logging interaction task
  - button "×"
  - button "+ Add"
  - heading "Notes" [level=2]
  - textbox: seeded notes
  - button "⏱ Insert Time"
  - heading "On Deck" [level=2]
  - checkbox
  - button "◉"
  - text: WIP ▾
  - link "TEST-2":
    - /url: https://cryoport.atlassian.net/browse/TEST-2
  - text: on deck item
  - button "×"
  - button "+ Add"
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test')
  2  | 
  3  | function collectClientLogEvents(page) {
  4  |   const events = []
  5  |   page.on('request', req => {
  6  |     if (!req.url().includes('/api/client-log') || req.method() !== 'POST') return
  7  |     try {
  8  |       const payload = JSON.parse(req.postData() || '{}')
  9  |       events.push(payload)
  10 |     } catch {
  11 |       // ignore malformed payloads in test collection
  12 |     }
  13 |   })
  14 |   return events
  15 | }
  16 | 
  17 | function hasEvent(events, name) {
  18 |   return events.some(e => e && e.event === name)
  19 | }
  20 | 
  21 | test('standup nav + modal interactions emit client-log events', async ({ page }) => {
  22 |   const events = collectClientLogEvents(page)
  23 | 
  24 |   await page.goto('/2026-06-15')
  25 | 
  26 |   await page.getByRole('button', { name: '☁ Standup' }).click()
> 27 |   await expect(page.getByRole('heading', { name: 'Submit Standup to Jira' })).toBeVisible()
     |                                                                               ^ Error: expect(locator).toBeVisible() failed
  28 | 
  29 |   await page.getByRole('button', { name: 'Cancel' }).click()
  30 | 
  31 |   await page.getByRole('button', { name: '☁ Standup' }).click()
  32 |   await page.getByRole('button', { name: 'Submit' }).click()
  33 | 
  34 |   // Submit may fail due Jira credentials in test env, but event emission must still happen.
  35 |   await expect.poll(() => hasEvent(events, 'standup-submit.started')).toBe(true)
  36 | 
  37 |   expect(hasEvent(events, 'toolbar.standup.clicked')).toBe(true)
  38 |   expect(hasEvent(events, 'jira-modal.state-changed')).toBe(true)
  39 |   expect(hasEvent(events, 'jira-modal.close')).toBe(true)
  40 |   expect(hasEvent(events, 'jira-modal.submit.clicked')).toBe(true)
  41 | })
  42 | 
  43 | test('inline edits and controls emit interaction logs', async ({ page }) => {
  44 |   const events = collectClientLogEvents(page)
  45 | 
  46 |   const date = '2026-06-15'
  47 |   const seededContent = [
  48 |     '# Daily',
  49 |     '',
  50 |     '## Standup',
  51 |     '- Yesterday',
  52 |     '- Today',
  53 |     '- Blockers',
  54 |     '',
  55 |     '## Tasks',
  56 |     '- [ ] TEST-1 logging interaction task',
  57 |     '',
  58 |     '## Notes',
  59 |     'seeded notes',
  60 |     '',
  61 |     '## On Deck',
  62 |     '- [ ] TEST-2 on deck item',
  63 |     '',
  64 |   ].join('\n')
  65 | 
  66 |   const seedRes = await page.request.put(`/api/daily/${date}`, {
  67 |     data: { content: seededContent },
  68 |   })
  69 |   expect(seedRes.ok()).toBeTruthy()
  70 | 
  71 |   await page.goto(`/${date}`)
  72 |   const tasksPanel = page.locator('#section-tasks')
  73 |   const seededTask = tasksPanel.locator('.task-item').filter({
  74 |     hasText: 'TEST-1 logging interaction task',
  75 |   }).first()
  76 |   await expect(seededTask).toBeVisible()
  77 | 
  78 |   // Checkbox toggle interaction.
  79 |   await seededTask.locator('input[type="checkbox"]').check()
  80 | 
  81 |   // Notes input interaction.
  82 |   const notes = page.locator('section.notes-panel textarea')
  83 |   await notes.fill('interaction logging notes')
  84 |   await page.getByRole('heading', { name: 'Notes' }).click()
  85 | 
  86 |   await expect.poll(() => events.filter(e => String(e?.event || '').startsWith('ui.interaction.')).length).toBeGreaterThan(5)
  87 | 
  88 |   expect(hasEvent(events, 'ui.interaction.click')).toBe(true)
  89 |   expect(hasEvent(events, 'ui.interaction.input')).toBe(true)
  90 |   expect(hasEvent(events, 'ui.interaction.change')).toBe(true)
  91 | })
  92 | 
```