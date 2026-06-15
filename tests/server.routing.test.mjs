import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function waitFor(url, attempts = 40, delayMs = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // server not ready
    }
    await new Promise(r => setTimeout(r, delayMs))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function startServer(t) {
  const port = 19000 + Math.floor(Math.random() * 1000)
  const child = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ALLOW_REMOTE: '1',
      LOG_LEVEL: 'error',
    },
    stdio: 'ignore',
  })

  t.after(() => {
    if (!child.killed) child.kill('SIGTERM')
  })

  return { port }
}

test('GET / redirects to /YYYY-MM-DD for today', async (t) => {
  const { port } = startServer(t)
  const base = `http://127.0.0.1:${port}`
  await waitFor(base)

  const res = await fetch(`${base}/`, { redirect: 'manual' })
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), `/${todayStr()}`)
})

test('GET /YYYY-MM-DD serves app shell', async (t) => {
  const { port } = startServer(t)
  const base = `http://127.0.0.1:${port}`
  await waitFor(base)

  const res = await fetch(`${base}/2026-06-15`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
})
