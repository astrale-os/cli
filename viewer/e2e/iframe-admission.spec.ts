import { TRUSTED_VIEW_IFRAME_PROFILE } from '@astrale-os/shell'
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { fulfillKernel } from './kernel'

const hostHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const hostScript = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8')

test('remote legacy iframe options cannot broaden the fixed shared browser profile', async ({
  page,
  context,
}) => {
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'kernel.example') return fulfillKernel(route)
    if (url.hostname === 'view.example')
      return route.fulfill({ contentType: 'text/html', body: '<title>View ready</title>' })
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
              release: `sha256:${'a'.repeat(64)}`,
              revision: `sha256:${'d'.repeat(64)}`,
              iframe: { allow: ['usb'], sandbox: ['allow-top-navigation'] },
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
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
  const frame = page.locator('#frame iframe')
  await expect(frame).toHaveCount(1)
  await expect(frame).toHaveAttribute('sandbox', TRUSTED_VIEW_IFRAME_PROFILE.sandbox.join(' '))
  await expect(frame).toHaveAttribute(
    'allow',
    TRUSTED_VIEW_IFRAME_PROFILE.allow.map((feature) => `${feature} *`).join('; '),
  )
  expect((await frame.getAttribute('sandbox'))?.split(' ')).not.toContain('allow-top-navigation')
  expect(await frame.getAttribute('allow')).not.toContain('usb')
  await expect(page.locator('#error')).toBeHidden()
})
