import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fulfillKernel } from './kernel'

const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-credential-'))
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
const hostHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const hostScript = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8')

test.afterAll(() => rmSync(temporary, { recursive: true, force: true }))

async function mount(page: Page, context: BrowserContext) {
  let available = true
  let tokens = 0
  let documents = 0
  const reports: string[] = []
  await page.clock.install()
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'kernel.example') return fulfillKernel(route)
    if (url.hostname === 'view.example') {
      if (url.pathname !== '/child.js') documents += 1
      return route.fulfill({
        contentType: url.pathname === '/child.js' ? 'application/javascript' : 'text/html',
        body:
          url.pathname === '/child.js' ? child : '<script type="module" src="/child.js"></script>',
      })
    }
    if (url.hostname !== 'host.example') return route.abort()
    if (url.pathname === '/config.json')
      return route.fulfill({
        json: {
          view: {
            target: '/:browser-fixture.example',
            route: {
              key: 'browser-fixture.example:view.application',
              declaration: { target: { kind: 'domain' } },
              href: 'https://view.example/',
              handshake: 'shell',
              issuer: 'https://browser-fixture.example',
              release: `sha256:${'a'.repeat(64)}`,
              revision: `sha256:${'d'.repeat(64)}`,
            },
          },
          revision: 0,
          externalOrigins: [],
          delegationTtlSeconds: 60,
          kernelUrl: 'https://kernel.example',
          kernelIssuer: 'https://kernel.example',
          identity: 'fixture',
          instance: 'fixture',
          sessionId: 'credential-fixture',
        },
      })
    if (url.pathname === '/token') {
      tokens += 1
      if (!available)
        return route.fulfill({ status: 503, json: { message: 'Controlled issuer unavailable' } })
      const now = await page.evaluate(() => Date.now())
      return route.fulfill({
        json: { token: `fixture-${tokens}`, expiresAt: now + 240_000, kind: 'minted' },
      })
    }
    if (url.pathname === '/status') {
      const { state } = route.request().postDataJSON() as { state: string }
      if (state !== 'alive') reports.push(state)
      return route.fulfill({ json: { revision: 0 } })
    }
    return route.fulfill({
      contentType: url.pathname === '/main.js' ? 'application/javascript' : 'text/html',
      body: url.pathname === '/main.js' ? hostScript : hostHtml,
    })
  })
  await page.goto('https://host.example/')
  const frame = page.frameLocator('#frame iframe')
  await expect(frame.locator('output')).toHaveText('ready')
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'connected')
  await frame.getByRole('textbox', { name: 'Draft' }).fill('Unsaved draft')
  const element = await page.locator('#frame iframe').elementHandle()
  return {
    frame,
    available: (value: boolean) => {
      available = value
    },
    tokens: () => tokens,
    reports,
    preserved: async () => {
      expect(documents).toBe(1)
      await expect(page.locator('#frame iframe')).toHaveCount(1)
      expect(
        await element!.evaluate((iframe) => iframe === document.querySelector('#frame iframe')),
      ).toBe(true)
      await expect(frame.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved draft')
    },
  }
}

test('shows degraded and expired credentials, then automatically recovers the same View', async ({
  page,
  context,
}) => {
  const view = await mount(page, context)
  view.available(false)
  await page.clock.fastForward(181_000)
  await expect.poll(view.tokens).toBeGreaterThan(1)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'degraded')
  await expect(page.locator('#session-error')).toContainText('Session renewal failed')
  await page.clock.fastForward(61_000)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'expired')
  await expect(page.getByRole('button', { name: 'Retry session' })).toBeEnabled()
  await expect.poll(() => view.reports.at(-1)).toBe('expired')
  expect(view.reports).not.toContain('failed')
  await view.preserved()

  view.available(true)
  await page.clock.fastForward(30_000)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'connected')
  await expect(page.locator('#session-error')).toBeHidden()
  await expect.poll(() => view.reports.at(-1)).toBe('connected')
  await expect(view.frame.locator('output')).not.toHaveAttribute('data-refreshes', '0')
  await view.preserved()
})

test('retry uses the Shell credential owner and preserves input after failure and recovery', async ({
  page,
  context,
}) => {
  const view = await mount(page, context)
  view.available(false)
  await page.clock.fastForward(241_000)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'expired')
  const retry = page.getByRole('button', { name: 'Retry session' })
  const before = view.tokens()
  await retry.click()
  await expect.poll(view.tokens).toBeGreaterThan(before)
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'expired')
  await expect(retry).toBeEnabled()
  await view.preserved()

  view.available(true)
  await retry.click()
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'connected')
  await expect(page.locator('#session-error')).toBeHidden()
  await expect(view.frame.locator('output')).not.toHaveAttribute('data-refreshes', '0')
  await view.preserved()
})
