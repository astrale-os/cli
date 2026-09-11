import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-browser-'))
const childFile = join(temporary, 'child.js')
execFileSync(
  'bun',
  [
    'build',
    fileURLToPath(new URL('./child.ts', import.meta.url)),
    '--target=browser',
    '--format=esm',
    `--outfile=${childFile}`,
  ],
  { stdio: 'pipe' },
)
const child = readFileSync(childFile, 'utf8')
const hostHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const hostScript = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8')

test.afterAll(() => rmSync(temporary, { recursive: true, force: true }))

test('published requirements grant only each mounted View and isolate its provider window', async ({
  page,
  context,
}) => {
  let provider = 'https://provider-a.example'
  let revision = 0
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname.startsWith('provider-'))
      return route.fulfill({ contentType: 'text/html', body: '<title>Provider ready</title>' })
    if (url.hostname === 'view.example' || url.hostname === 'nested.view.example') {
      return route.fulfill({
        contentType: url.pathname === '/child.js' ? 'application/javascript' : 'text/html',
        body:
          url.pathname === '/child.js' ? child : '<script type="module" src="/child.js"></script>',
      })
    }
    if (url.hostname !== 'host.example') return route.abort()
    const view = {
      target: '/:browser-fixture.example',
      route: {
        key: 'browser-fixture.example:view.application',
        declaration: { target: { kind: 'domain' } },
        href: `https://view.example/?provider=${encodeURIComponent(provider)}`,
        handshake: 'shell',
        issuer: 'https://browser-fixture.example',
        etag: `sha256:${(revision === 0 ? 'a' : 'b').repeat(64)}`,
        revision: `sha256:${'d'.repeat(64)}`,
        host: { navigation: { external: { origins: [provider] } } },
      },
    }
    if (url.pathname === '/config.json')
      return route.fulfill({
        json: {
          view,
          revision,
          externalOrigins: [],
          kernelUrl: 'https://kernel.example',
          kernelIssuer: 'https://kernel.example',
          identity: 'fixture',
          instance: 'fixture',
          sessionId: 'browser-fixture',
        },
      })
    if (url.pathname === '/token')
      return route.fulfill({
        json: { token: 'browser-fixture', expiresAt: Date.now() + 240_000, kind: 'minted' },
      })
    if (url.pathname === '/status') return route.fulfill({ json: { revision } })
    return route.fulfill({
      contentType: url.pathname === '/main.js' ? 'application/javascript' : 'text/html',
      body: url.pathname === '/main.js' ? hostScript : hostHtml,
    })
  })
  await page.goto('https://host.example/')
  const frame = page.frameLocator('#frame iframe').first()
  await expect(frame.locator('#status')).toHaveText('ready')
  const popupEvent = context.waitForEvent('page')
  await frame.getByRole('button', { name: 'Open provider', exact: true }).click()
  const popup = await popupEvent
  await expect(popup).toHaveURL('https://provider-a.example/session')
  await expect.poll(() => popup.evaluate(() => window.opener)).toBeNull()
  await expect(frame.locator('#status')).toHaveText('opened')
  await popup.close()

  await frame.getByRole('button', { name: 'Open other', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText('denied')
  expect(context.pages()).toHaveLength(1)

  await frame.getByRole('button', { name: 'Escalate nested', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText('nested-denied')
  await expect(frame.locator('#nested-host iframe')).toHaveCount(0)
  await frame.getByRole('button', { name: 'Mount nested', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText('nested-ready')
  const nested = frame.frameLocator('#nested-host iframe')
  await expect(nested.locator('#status')).toHaveText('ready')
  const nestedPopupEvent = context.waitForEvent('page')
  await nested.getByRole('button', { name: 'Open provider', exact: true }).click()
  const nestedPopup = await nestedPopupEvent
  await expect(nestedPopup).toHaveURL('https://provider-a.example/session')
  await expect(nested.locator('#status')).toHaveText('opened')
  await nestedPopup.close()

  // A new publication must replace the old origins in the next handshake.
  provider = 'https://provider-b.example'
  revision += 1
  await page.reload()
  await expect(frame.locator('#status')).toHaveText('ready')
  await frame.getByRole('button', { name: 'Open other', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText('denied')
  expect(context.pages()).toHaveLength(1)

  // Slow authorization still settles; native popup policy varies by browser/profile.
  await frame.getByRole('button', { name: 'Slow open', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText(/^(opened|blocked)$/, { timeout: 15_000 })
  if ((await frame.locator('#status').textContent()) === 'opened') {
    const delayed = context.pages().find((candidate) => candidate !== page)!
    await expect(delayed).toHaveURL('https://provider-b.example/session')
    await expect.poll(() => delayed.evaluate(() => window.opener)).toBeNull()
    await delayed.close()
  }

  // Exercise a refused native open deterministically, then retry the retained URL.
  await page.evaluate(() => {
    const nativeOpen = window.open
    window.open = () => {
      window.open = nativeOpen
      return null
    }
  })
  await frame.getByRole('button', { name: 'Open provider', exact: true }).click()
  await expect(frame.locator('#status')).toHaveText('blocked')
  expect(context.pages()).toHaveLength(1)
  const retryEvent = context.waitForEvent('page')
  await frame.getByRole('button', { name: 'Open provider', exact: true }).click()
  const retry = await retryEvent
  await expect(retry).toHaveURL('https://provider-b.example/session')
  await expect(frame.locator('#status')).toHaveText('opened')
  await retry.close()
})
