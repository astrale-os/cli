import { expect, test } from './test'

const updates = {
  stale: true,
  cli: { stale: false, managed: true },
  skills: { status: 'current' },
  sdk: {
    stale: true,
    inProject: true,
    outdated: [
      { pkg: '@astrale-os/sdk', current: '0.5.0-beta.106', latest: '0.5.0-beta.107' },
      { pkg: '@astrale-os/ui', current: '0.4.0', latest: '0.5.0' },
    ],
  },
}

test('a quiet domain package hint prepares a new unsent agent request', async ({ page }) => {
  let submitted = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/agent/submit')) submitted += 1
  })
  await page.route('**/api/domain/*/updates', (route) => route.fulfill({ json: updates }))

  await page.goto('/')
  const hint = page.getByTestId('workspace-domain-tree').getByRole('button', {
    name: '2 Astrale package updates available for crm.studio-demo.astrale.ai',
  })
  await expect(hint).toBeVisible()
  await hint.click()

  await expect(page.getByText('@astrale-os/sdk', { exact: true })).toBeVisible()
  await expect(page.getByText('0.5.0-beta.106 → 0.5.0-beta.107')).toBeVisible()
  await page.getByRole('button', { name: 'Prepare update with agent' }).click()

  const composer = page.getByPlaceholder('Message the agent…')
  await expect(composer).toContainText('')
  await expect(composer).toHaveValue(/Update the Astrale packages for the crm\.studio-demo/)
  await expect(composer).toHaveValue(/@astrale-os\/ui: 0\.4\.0 → 0\.5\.0/)
  expect(submitted).toBe(0)
})
