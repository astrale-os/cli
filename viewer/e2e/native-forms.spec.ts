import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-native-forms-'))
const submissions: string[] = []
let receiver: Server | undefined
let viewer: ChildProcess | undefined
let receiverOrigin = ''
let viewerOrigin = ''

const form = (saved?: string): string => `<!doctype html><html lang="en"><title>Native form</title>
  ${saved === undefined ? '' : `<h1>Saved ${saved}</h1>`}
  <form action="/submit" method="post">
    <label>Title <input name="title" required></label>
    <button type="submit">Add item</button>
  </form></html>`

test.beforeAll(async () => {
  // This is a real HTTP form receiver. No JavaScript submission handler, mocked
  // request or Kernel is involved: Chromium must issue the native POST itself.
  receiver = createServer(async (request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    if (request.method === 'POST' && request.url === '/submit') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const title = new URLSearchParams(body).get('title') ?? ''
      submissions.push(title)
      response.end(form(title))
    } else response.end(form())
  })
  await new Promise<void>((resolve) => receiver!.listen(0, '127.0.0.1', resolve))
  const address = receiver.address()
  if (typeof address !== 'object' || address === null)
    throw new Error('Form receiver did not listen')
  receiverOrigin = `http://127.0.0.1:${address.port}`

  // Drive the shipped viewer through its real session server. A no-handshake
  // View requires no auth, token mint or Kernel traffic and still gets the
  // shared Shell sandbox profile used by Studio previews.
  const config = {
    session: {
      id: 'v-nativeforms',
      pid: 0,
      port: 0,
      nonce: 'nativeforms',
      pageUrl: '',
      view: {
        target: '/:native-forms.example',
        route: {
          key: 'native-forms.example:view.application',
          declaration: { target: { kind: 'domain' } },
          href: receiverOrigin,
          handshake: 'none',
          issuer: 'https://native-forms.example',
          etag: `sha256:${'a'.repeat(64)}`,
          revision: `sha256:${'b'.repeat(64)}`,
        },
      },
      createdAt: '2026-10-06T00:00:00.000Z',
    },
    kernel: {},
    proxy: {
      kernelUrl: 'https://unused-kernel.example',
      issuer: 'https://unused-kernel.example',
      direct: true,
    },
    externalOrigins: [],
    idleMs: 600_000,
  }
  const bootstrap = join(temporary, 'serve.ts')
  writeFileSync(
    bootstrap,
    `
    import { startViewServer } from ${JSON.stringify(join(repository, 'src/lib/view/server.ts'))}
    const server = startViewServer(${JSON.stringify(config)})
    server.on('listening', () => console.log('PORT ' + server.address().port))
    await new Promise(() => {})
  `,
  )
  viewer = spawn('bun', [bootstrap], {
    cwd: repository,
    env: {
      ...process.env,
      ASTRALE_HOME: temporary,
      ASTRALE_VIEWER_DIR: join(repository, 'viewer/dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise<string>((resolve, reject) => {
    let output = ''
    let failure = ''
    const deadline = setTimeout(
      () => reject(new Error(`View server did not listen\n${failure}`)),
      30_000,
    )
    viewer!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/PORT (\d+)/)
      if (match) {
        clearTimeout(deadline)
        resolve(match[1])
      }
    })
    viewer!.stderr!.on('data', (chunk: Buffer) => {
      failure += chunk.toString()
    })
    viewer!.on('exit', (code) => {
      clearTimeout(deadline)
      reject(new Error(`View server exited with ${code}\n${failure}`))
    })
  })
  viewerOrigin = `http://127.0.0.1:${port}/s/nativeforms/`
})

test.afterAll(async () => {
  if (viewer && viewer.exitCode === null && viewer.signalCode === null) {
    const stopped = once(viewer, 'exit')
    viewer.kill('SIGKILL')
    await stopped
  }
  receiver?.closeAllConnections()
  if (receiver) await new Promise<void>((resolve) => receiver!.close(() => resolve()))
  rmSync(temporary, { recursive: true, force: true })
})

/** @evidence TEST-CLI-VIEW-NATIVE-FORMS-POST-THREE-TIMES */
test('the shared viewer profile permits three native form submissions to a real HTTP receiver', async ({
  page,
}) => {
  const unexpectedTraffic: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('unused-kernel.example') || request.url().endsWith('/token')) {
      unexpectedTraffic.push(request.url())
    }
  })
  await page.goto(viewerOrigin)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
  const iframe = page.locator('#frame iframe')
  const frame = page.frameLocator('#frame iframe')
  expect((await iframe.getAttribute('sandbox'))?.split(/\s+/)).toContain('allow-forms')

  for (const title of ['first', 'second', 'third']) {
    await frame.getByLabel('Title').fill(title)
    await frame.getByRole('button', { name: 'Add item' }).click()
    await expect(frame.getByRole('heading')).toHaveText(`Saved ${title}`)
  }

  expect(submissions).toEqual(['first', 'second', 'third'])
  expect(unexpectedTraffic).toEqual([])
  await expect(page.getByRole('alert')).toBeHidden()
})
