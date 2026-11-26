import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fulfillHostPage } from './host'
import { fulfillKernel } from './kernel'

const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-release-'))
const childFile = join(temporary, 'child.js')
execFileSync(
  'bun',
  [
    'build',
    fileURLToPath(new URL('./credential-child.ts', import.meta.url)),
    '--target=browser',
    '--format=esm',
    `--outfile=${childFile}`,
  ],
  { stdio: 'pipe' },
)
const child = readFileSync(childFile, 'utf8')

test.afterAll(() => rmSync(temporary, { recursive: true, force: true }))

/** One release of the session's View: each deployment of its Domain has its own issuer. */
const release = (name: string, issuer: string) => ({
  target: '/:browser-fixture.example',
  route: {
    key: 'browser-fixture.example:view.application',
    declaration: { target: { kind: 'domain' } },
    href: `https://view.example/${name}/`,
    handshake: 'shell',
    issuer,
    release: `sha256:${name.repeat(64)}`,
    revision: `sha256:${'d'.repeat(64)}`,
  },
})
const FIRST = release('a', 'https://a.browser-fixture.example')
const NEXT = release('b', 'https://b.browser-fixture.example')

test('a redeploy moves the open View to the release the Kernel serves, with its own credential', async ({
  page,
  context,
}) => {
  let served = FIRST
  const issuers: string[] = []
  const documents: string[] = []
  const configs: number[] = []
  const reports: string[] = []
  await page.clock.install()
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'kernel.example') return fulfillKernel(route)
    if (url.hostname === 'view.example') {
      if (url.pathname.endsWith('/child.js'))
        return route.fulfill({ contentType: 'application/javascript', body: child })
      documents.push(url.pathname)
      return route.fulfill({
        contentType: 'text/html',
        body: `<script type="module" src="${url.pathname}child.js"></script>`,
      })
    }
    if (url.hostname !== 'host.example') return route.abort()
    if (url.pathname === '/config.json') {
      configs.push(configs.length)
      return route.fulfill({
        json: {
          // The session's record still names the release it opened.
          view: FIRST,
          revision: 0,
          externalOrigins: [],
          delegationTtlSeconds: 60,
          kernelUrl: 'https://kernel.example',
          kernelIssuer: 'https://kernel.example',
          identity: 'fixture',
          instance: 'fixture',
          sessionId: 'release-fixture',
        },
      })
    }
    if (url.pathname === '/current') return route.fulfill({ json: { view: served } })
    if (url.pathname === '/kernel-token')
      return route.fulfill({
        json: { token: 'kernel-fixture', expiresAt: Date.now() + 3_600_000, kind: 'minted' },
      })
    if (url.pathname === '/token') {
      const { view } = route.request().postDataJSON() as { view: typeof FIRST }
      issuers.push(view.route.issuer)
      const now = await page.evaluate(() => Date.now())
      return route.fulfill({
        json: { token: `for ${view.route.issuer}`, expiresAt: now + 240_000, kind: 'exchanged' },
      })
    }
    if (url.pathname === '/status') {
      const { state } = route.request().postDataJSON() as { state: string }
      if (state !== 'alive') reports.push(state)
      return route.fulfill({ json: { revision: 0 } })
    }
    return fulfillHostPage(route, url.pathname)
  })

  await page.goto('https://host.example/')
  const frame = page.frameLocator('#frame iframe')
  await expect(frame.locator('output')).toHaveText('ready')
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'connected')
  expect(issuers).toEqual([FIRST.route.issuer])
  const element = await page.locator('#frame iframe').elementHandle()
  await page.evaluate(() => Object.assign(window, { untouched: true }))

  // The Domain is redeployed: the Kernel now serves its next release, under another issuer.
  served = NEXT
  await page.clock.fastForward(191_000)
  await expect.poll(() => documents).toEqual(['/a/', '/b/'])
  await expect(frame.locator('output')).toHaveText('ready')
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'connected')

  // The window moved in place, on the next release's own credential; the page never reloaded.
  expect(issuers.at(-1)).toBe(NEXT.route.issuer)
  expect(
    await element!.evaluate((iframe) => iframe === document.querySelector('#frame iframe')),
  ).toBe(true)
  expect(await page.evaluate(() => 'untouched' in window)).toBe(true)
  expect(configs).toHaveLength(1)
  expect(reports).not.toContain('failed')

  // From then on, it renews for the release it runs.
  const renewed = issuers.length
  await page.clock.fastForward(191_000)
  await expect.poll(() => issuers.length).toBeGreaterThan(renewed)
  expect(issuers.slice(renewed)).toEqual(issuers.slice(renewed).map(() => NEXT.route.issuer))
  expect(documents).toEqual(['/a/', '/b/'])
})
