// Run browser tests against an already-running local instance.
/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8008',
    headless: true,
  },
}
