import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Who a View session belongs to, proven in a browser against the real session
 * server: the operator pops a View out into their own tab, the Studio dialog
 * that opened it goes away, and the tab keeps working until the operator closes
 * it themselves.
 */

const NONCE = 'ownership'
const GRACE_MS = 400
const repository = fileURLToPath(new URL('../..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-ownership-'))

let child: ChildProcess | undefined
let origin = ''

const base = () => `${origin}/s/${NONCE}`
const alive = async (): Promise<boolean> => {
  try {
    return (await fetch(`${base()}/state`)).ok
  } catch {
    return false
  }
}

test.beforeAll(async () => {
  const config = {
    session: {
      id: 'v-ownership',
      pid: 0,
      // The OS picks the port; the bootstrap reports the one it got.
      port: 0,
      nonce: NONCE,
      pageUrl: '',
      view: {
        target: '/:ownership.example',
        route: {
          key: 'ownership.example:view.board',
          declaration: { target: { kind: 'domain' } },
          href: 'https://view.example/board',
          handshake: 'none',
          issuer: 'https://ownership.example',
          etag: `sha256:${'a'.repeat(64)}`,
          revision: `sha256:${'b'.repeat(64)}`,
        },
      },
      instance: 'fixture',
      identity: 'fixture',
      createdAt: '2026-09-22T00:00:00.000Z',
    },
    kernel: {},
    proxy: { kernelUrl: 'https://kernel.example', issuer: 'https://kernel.example', direct: true },
    externalOrigins: [],
    // Long enough that only the ownership rule can end this session.
    idleMs: 600_000,
    releaseGraceMs: GRACE_MS,
  }
  const bootstrap = join(temporary, 'serve.ts')
  writeFileSync(
    bootstrap,
    [
      `import { startViewServer } from ${JSON.stringify(join(repository, 'src/lib/view/server.ts'))}`,
      `const server = startViewServer(${JSON.stringify(config)})`,
      `server.on('listening', () => {`,
      `  const value = server.address()`,
      `  console.log('PORT ' + (typeof value === 'object' && value !== null ? value.port : ''))`,
      `})`,
      `await new Promise(() => {})`,
      '',
    ].join('\n'),
  )

  child = spawn('bun', [bootstrap], {
    cwd: repository,
    env: { ...process.env, ASTRALE_VIEWER_DIR: join(repository, 'viewer/dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise<string>((resolve, reject) => {
    let output = ''
    child!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/PORT (\d+)/)
      if (match) resolve(match[1])
    })
    child!.stderr!.on('data', (chunk: Buffer) => reject(new Error(chunk.toString())))
    child!.on('exit', (code) => reject(new Error(`session server exited with ${code}`)))
    setTimeout(() => reject(new Error(`session server did not listen: ${output}`)), 20_000)
  })
  origin = `http://127.0.0.1:${port}`
})

test.afterAll(() => {
  child?.kill('SIGKILL')
  rmSync(temporary, { recursive: true, force: true })
})

test('a popped-out View outlives the dialog that opened it, and ends with its own tab', async ({
  context,
}) => {
  await context.route('https://view.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Board</title>' }),
  )

  // The Studio dialog mounts the session under the page id it will hand back.
  const dialog = await context.newPage()
  await dialog.goto(`${base()}/?page=studio-dialog`)
  await expect(dialog.locator('#status-dot')).toHaveAttribute('data-state', 'plain')

  // The operator opens the same View in a tab of their own.
  const popped = await context.newPage()
  await popped.goto(`${base()}/`)
  await expect(popped.locator('#status-dot')).toHaveAttribute('data-state', 'plain')

  // Closing the dialog releases exactly its own page.
  const released = await fetch(`${base()}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-astrale-view-host': '1' },
    body: JSON.stringify({ page: 'studio-dialog' }),
  })
  expect(released.status).toBe(200)
  expect(await released.json()).toEqual({ released: true, attached: 1 })
  await dialog.close()

  // Well past the grace, the tab is still a working View on a live session.
  await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 5))
  expect(await alive()).toBe(true)
  await expect(popped.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
  await expect(popped.locator('#error')).toBeHidden()
  expect(await popped.locator('iframe').getAttribute('src')).toBe('https://view.example/board')

  // A reload of the tab is a page leaving and coming back; the session holds.
  await popped.reload()
  await expect(popped.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
  await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 5))
  expect(await alive()).toBe(true)

  // The operator closes their tab: the last page leaves and the session ends.
  await popped.close()
  await expect.poll(alive, { timeout: 15_000 }).toBe(false)
})
