import { expect, test } from './test'

/**
 * The Kernel heads the workspace's Domains and drawn like one of them: its Classes,
 * relationships and Functions on the canvas, its members in the detail panel. Nothing in it can
 * be changed, so it starts no thread.
 */
test('the read-only Kernel draws on the canvas and opens in the detail panel', async ({ page }) => {
  const origin = 'kernel.astrale.ai'
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  const rail = page.getByTestId('workspace-domain-tree')
  // first in the rail, marked by a lock alone
  await expect(rail.locator('section').first()).toContainText(origin)
  await expect(rail.getByRole('img', { name: 'Read-only' })).toBeVisible()
  await rail.getByRole('button', { name: `Show ${origin} on the canvas` }).click()
  await expect(page.getByTestId('workspace-domain-@kernel')).toBeVisible({ timeout: 60_000 })

  const identity = page.locator('.react-flow__node-classNode').filter({ hasText: /^Identity/ })
  const domain = page.locator('.react-flow__node-classNode').filter({ hasText: /^Domain/ })
  await expect(identity).toBeVisible()
  // laid out, not stacked: a relationship to a Class the canvas leaves off used to make the
  // layout engine reject the whole Kernel
  const identityBox = (await identity.boundingBox())!
  const domainBox = (await domain.boundingBox())!
  expect([identityBox.x, identityBox.y]).not.toEqual([domainBox.x, domainBox.y])

  await identity.click()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByText('whoami', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // a comment would have nowhere to go: targeting the Kernel says so instead
  await page.keyboard.press('c')
  await domain.click()
  await expect(page.getByText('The Kernel is read-only', { exact: false })).toBeVisible()

  await rail.getByRole('button', { name: `Hide ${origin} on the canvas` }).click()
  await expect(page.getByTestId('workspace-domain-@kernel')).toHaveCount(0)
})
