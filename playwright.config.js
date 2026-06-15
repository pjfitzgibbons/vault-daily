// Run browser tests against an already-running local instance.
/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './tests/e2e',
  timeout: 30_000,
  webServer: {
    command: 'node src/server.cjs',
    url: 'http://127.0.0.1:8008',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8008',
    headless: true,
  },
}
