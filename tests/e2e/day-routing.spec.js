const { test, expect } = require('@playwright/test')

function currentPath(page) {
  return new URL(page.url()).pathname
}

test('root redirects to today route and day navigation keeps URL/date in sync', async ({ page }) => {
  await page.goto('/')

  const dateLabel = page.locator('.date-label')
  await expect(dateLabel).toHaveText(/\d{4}-\d{2}-\d{2}/)

  const initialDate = (await dateLabel.textContent()).trim()
  expect(currentPath(page)).toBe(`/${initialDate}`)

  await page.getByRole('button', { name: '←' }).click()
  await expect(dateLabel).not.toHaveText(initialDate)

  const prevDate = (await dateLabel.textContent()).trim()
  expect(currentPath(page)).toBe(`/${prevDate}`)

  await page.getByRole('button', { name: '→' }).click()
  await expect(dateLabel).toHaveText(initialDate)
  expect(currentPath(page)).toBe(`/${initialDate}`)
})
