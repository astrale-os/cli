import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { fulfillKernel } from './kernel'

/**
 * The owner-mode identity picker of the View host page: "Open as" Root, a User, or another
 * Identity of the instance, switching and reloading through the session server.
 */

const hostHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const hostScript = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8')

const IDENTITIES = [
  { id: null, label: 'Root', kind: 'root' },
  { id: 'alice', label: 'alice@x.test', kind: 'user' },
  { id: 'bob', label: 'bob@x.test', kind: 'user' },
  { id: 'agent', label: 'Support agent', kind: 'identity', className: 'Agent' },
]

/** A host whose session runs as `selected`, and records what the page asks it to switch to. */
async function serve(page: Page, context: BrowserContext, listing = true) {
  let revision = 0
  let selected: string | null = null
  const switches: unknown[] = []
  await context.route('https://kernel.example/**', fulfillKernel)
  await context.route('https://view.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Board</title>' }),
  )
  await context.route('https://host.example/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/config.json') {
      return route.fulfill({
        json: {
          view: {
            target: '/:open-as.example',
            route: {
              key: 'open-as.example:view.board',
              declaration: { target: { kind: 'domain' } },
              href: 'https://view.example/board',
              handshake: 'none',
              issuer: 'https://open-as.example',
              release: `sha256:${'a'.repeat(64)}`,
              revision: `sha256:${'b'.repeat(64)}`,
            },
          },
          revision,
          externalOrigins: [],
          delegationTtlSeconds: 60,
          kernelUrl: 'https://kernel.example',
          kernelIssuer: 'https://kernel.example',
          identity: IDENTITIES.find((identity) => identity.id === selected)!.label,
          instance: 'mine',
          sessionId: 'open-as-fixture',
          owner: true,
        },
      })
    }
    if (url.pathname === '/identities') {
      expect(request.headers()['x-astrale-view-host']).toBe('1')
      if (!listing) {
        return route.fulfill({ status: 502, json: { error: 'Admin refused the root token.' } })
      }
      return route.fulfill({ json: { selected, identities: IDENTITIES } })
    }
    if (url.pathname === '/identity') {
      expect(request.headers()['x-astrale-view-revision']).toBe(String(revision))
      const body = request.postDataJSON() as { identity: string | null }
      switches.push(body)
      selected = body.identity
      revision += 1
      return route.fulfill({ json: { revision } })
    }
    if (url.pathname === '/status') return route.fulfill({ json: { revision } })
    return route.fulfill({
      contentType: url.pathname === '/main.js' ? 'application/javascript' : 'text/html',
      body: url.pathname === '/main.js' ? hostScript : hostHtml,
    })
  })
  await page.goto('https://host.example/')
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
  return { switches }
}

test('opens as Root, lists Users then other Identities, and switches as the chosen one', async ({
  page,
  context,
}) => {
  const host = await serve(page, context)
  const picker = page.getByLabel('Open as')
  const button = page.getByRole('button', { name: 'Switch & reload' })
  await expect(picker).toBeEnabled()
  await expect(picker).toHaveValue('')
  await expect(page.locator('#identity-label')).toHaveText('Root @ mine')
  await expect(picker.locator('option')).toHaveText([
    'Root',
    'alice@x.test',
    'bob@x.test',
    'Support agent · Agent',
  ])
  await expect(picker.locator('optgroup')).toHaveCount(2)
  await expect(picker.locator('optgroup').first()).toHaveAttribute('label', 'Users')
  await expect(picker.locator('optgroup').last()).toHaveAttribute('label', 'Other identities')
  // The identity in force is no switch.
  await expect(button).toBeDisabled()

  await picker.selectOption('alice')
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.locator('#identity-label')).toHaveText('alice@x.test @ mine')
  await expect(page.getByLabel('Open as')).toHaveValue('alice')
  await expect(page.getByRole('button', { name: 'Switch & reload' })).toBeDisabled()

  await page.getByLabel('Open as').selectOption({ label: 'Root' })
  await page.getByRole('button', { name: 'Switch & reload' }).click()
  await expect(page.locator('#identity-label')).toHaveText('Root @ mine')
  expect(host.switches).toEqual([{ identity: 'alice' }, { identity: null }])
})

test('a list that cannot be read leaves the View mounted and says so', async ({
  page,
  context,
}) => {
  await serve(page, context, false)
  await expect(page.getByLabel('Open as')).toBeDisabled()
  await expect(page.getByLabel('Open as').locator('option')).toHaveText(['Identities unavailable'])
  await expect(page.locator('#error')).toContainText('Admin refused the root token.')
  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'plain')
})
