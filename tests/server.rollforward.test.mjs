import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

test('POST /api/daily/:date/roll-forward and /task mutate a note byte-correctly', async (t) => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-rollforward-test-'))
  fs.mkdirSync(path.join(vaultPath, 'daily'), { recursive: true })
  fs.writeFileSync(path.join(vaultPath, 'daily', '2026-06-15.md'), [
    '---', 'date: 2026-06-15', '---', '',
    '# 2026-06-15', '',
    '## Standup', '**Yesterday:**', '**Today:**', '**Blockers:** ', '',
    '## Tasks',
    '- [ ] CIAM-15 Finish the thing',
    '- [x] CIAM-9 Done already', '',
    '## On Deck', '- ', '',
    '## Notes', '<!-- placeholder -->', '',
  ].join('\n'))

  const port = 18000 + Math.floor(Math.random() * 1000)
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    ALLOW_REMOTE: '1',
    LOG_LEVEL: 'error',
    VAULT_PATH: vaultPath,
  }

  const child = spawn('node', ['src/server.cjs'], { env, stdio: 'ignore' })
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM')
    fs.rmSync(vaultPath, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  await waitFor(`${base}/api/jira/config`)

  const rfRes = await fetch(`${base}/api/daily/2026-06-16/roll-forward`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(rfRes.status, 200)
  const rfData = await rfRes.json()
  assert.match(rfData.content, /- \[ \] CIAM-15 Finish the thing/)
  assert.ok(fs.existsSync(path.join(vaultPath, 'daily', '2026-06-16.md')))

  const setRes = await fetch(`${base}/api/daily/2026-06-16/task`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', key: 'CIAM-15', status: 'wip', workedToday: true }),
  })
  assert.equal(setRes.status, 200)
  const setData = await setRes.json()
  assert.equal(setData.line, '- [ ] > CIAM-15 Finish the thing')

  const addRes = await fetch(`${base}/api/daily/2026-06-16/task`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', text: 'Agile Standup', done: true }),
  })
  assert.equal(addRes.status, 200)
  const addData = await addRes.json()
  assert.equal(addData.line, '- [x] Agile Standup')

  const finalContent = fs.readFileSync(path.join(vaultPath, 'daily', '2026-06-16.md'), 'utf8')
  assert.match(finalContent, /- \[ \] > CIAM-15 Finish the thing/)
  assert.match(finalContent, /- \[x\] Agile Standup/)

  const missingRes = await fetch(`${base}/api/daily/2026-06-16/task`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', key: 'NOPE-1', status: 'wip' }),
  })
  assert.equal(missingRes.status, 404)
})
