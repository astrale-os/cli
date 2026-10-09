import { expect, test } from './test'

test('CLI replacement remains visible when the old parser loses every domain', async ({ page }) => {
  let installedVersion = '1.0.0-beta.129'
  let unavailable = false
  let emptyCatalog = false
  let mutated = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && !request.url().endsWith('/api/workspace/state')) mutated++
  })
  await page.route('**/api/workspace/runtime', (route) =>
    unavailable
      ? route.fulfill({ status: 502, json: { error: 'Installation unavailable' } })
      : route.fulfill({
          json: {
            runningVersion: '1.0.0-beta.129',
            installedVersion,
            restartCommand: [
              '/opt/astrale cli',
              'studio',
              "/projects/Bryan's domain",
              '--port',
              '4399',
            ],
          },
        }),
  )
  await page.route('**/api/workspace', (route) =>
    emptyCatalog ? route.fulfill({ json: [] }) : route.continue(),
  )
  await page.clock.install()
  const firstProbe = page.waitForResponse('**/api/workspace/runtime')
  await page.goto('/')
  await firstProbe
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  const notice = page.getByRole('button', { name: 'Restart Studio', exact: true })
  await expect(notice).toHaveCount(0)
  installedVersion = '1.0.0-beta.130'
  await page.clock.fastForward(16_000)
  await expect(notice).toBeVisible()
  await notice.click()
  await expect(page.getByText(/Studio is running 1\.0\.0-beta\.129/)).toBeVisible()
  await expect(page.getByText(/The installed CLI is 1\.0\.0-beta\.130/)).toBeVisible()
  await expect(page.locator('code').filter({ hasText: '/opt/astrale cli' })).toHaveText(
    new RegExp("^'/opt/astrale cli' 'studio' '/projects/Bryan'\"'\"'s domain' '--port' '\\d+'$"),
  )
  await page.keyboard.press('Escape')

  // A failed probe must retain the confirmed skew rather than silently clearing it.
  unavailable = true
  await page.clock.fastForward(16_000)
  await expect(notice).toBeVisible()

  unavailable = false
  emptyCatalog = true
  await page.reload()
  await expect(notice).toBeVisible()
  expect(mutated).toBe(0)
})
