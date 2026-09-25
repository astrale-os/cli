import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const hostHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const hostScript = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8')

test('refuses a View requiring a browser feature beyond the shared profile, as the GUI does', async ({
  page,
  context,
}) => {
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
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
              handshake: 'none',
              issuer: 'https://browser-fixture.example',
              etag: `sha256:${'a'.repeat(64)}`,
              revision: `sha256:${'d'.repeat(64)}`,
              iframe: { allow: ['usb'] },
            },
          },
          revision: 0,
          externalOrigins: [],
          delegationTtlSeconds: 60,
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
    if (url.pathname === '/status') return route.fulfill({ json: { revision: 0 } })
    return route.fulfill({
      contentType: url.pathname === '/main.js' ? 'application/javascript' : 'text/html',
      body: url.pathname === '/main.js' ? hostScript : hostHtml,
    })
  })
  await page.goto('https://host.example/')
  // `astrale view` grants what the GUI grants: a feature outside the profile is not granted locally.
  await expect(page.getByRole('alert')).toHaveText(
    'The trusted Shell host denied the complete iframe requirement set.',
  )
  await expect(page.locator('#frame iframe')).toHaveCount(0)
})
