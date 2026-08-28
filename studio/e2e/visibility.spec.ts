import { expect, test } from '@playwright/test'

test('an imported domain is hidden and restored through its persisted visibility state', async ({
  page,
  request,
}) => {
  const workspace = (await (await request.get('/api/workspace')).json()) as Array<{ id: string }>
  const domainId = workspace[0]!.id
  const visibilityUrl = `/api/domain/${encodeURIComponent(domainId)}/visibility`

  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  const externalFrame = page.locator('.react-flow__node-extDomain').filter({
    hasText: 'remote-e2e',
  })
  await expect(externalFrame).toBeVisible()

  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('option', { name: /Imported domains/ }).click()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Hide in canvas' }).click()
  await expect(externalFrame).toHaveCount(0)
  await expect
    .poll(async () => (await (await request.get(visibilityUrl)).json()).hidden)
    .toEqual({ 'domain.remote-e2e.astrale.ai': true })

  await panel.getByRole('button', { name: 'Show in canvas' }).click()
  await expect(externalFrame).toBeVisible()
  await expect
    .poll(async () => (await (await request.get(visibilityUrl)).json()).hidden)
    .toEqual({})
})
