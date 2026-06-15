import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

async function waitFor(url, attempts = 40, delayMs = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // server not ready yet
    }
    await new Promise(r => setTimeout(r, delayMs))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

test('GET /api/jira/config returns non-secret jira config shape', async (t) => {
  const port = 18000 + Math.floor(Math.random() * 1000)
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    ALLOW_REMOTE: '1',
    LOG_LEVEL: 'error',
  }

  const child = spawn('node', ['src/server.cjs'], {
    env,
    stdio: 'ignore',
  })

  t.after(() => {
    if (!child.killed) child.kill('SIGTERM')
  })

  const url = `http://127.0.0.1:${port}/api/jira/config`
  await waitFor(url)

  const res = await fetch(url)
  assert.equal(res.status, 200)

  const data = await res.json()
  assert.equal(typeof data.baseUrl, 'string')
  assert.equal(typeof data.fields, 'object')
  assert.equal('email' in data, false)
  assert.equal('token' in data, false)
})
