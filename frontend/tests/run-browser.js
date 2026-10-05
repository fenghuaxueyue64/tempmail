import { createServer } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const candidates = [
  process.env.CHROME_BIN,
  process.platform === 'win32' && `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.platform === 'win32' && `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const browser = candidates.find(existsSync)
if (!browser) throw new Error('Chrome/Edge not found. Set CHROME_BIN to the browser executable.')

const profile = await mkdtemp(join(tmpdir(), 'tempmail-browser-test-'))
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
})
try {
  await server.listen()
  const { port } = server.httpServer.address()
  const { stdout } = await exec(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--window-size=390,844',
    '--virtual-time-budget=12000', '--dump-dom',
    `http://127.0.0.1:${port}/tests/browser.html`,
  ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
  if (!stdout.includes('data-status="passed"')) throw new Error(`Browser regression failed:\n${stdout.slice(-12000)}`)
  console.log('Browser regression passed: HTML extraction, isolated reader, full body, copy and request races.')
} finally {
  await server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
