import { expect, FIXTURE_ID, PEER_ID, test } from './test'

test('an imported domain is hidden and restored through its persisted visibility state', async ({
  page,
  request,
}) => {
  const workspace = (await (await request.get('/api/workspace')).json()) as Array<{ id: string }>
  const domainId = workspace.find((domain) => domain.id === FIXTURE_ID)!.id
  const visibilityUrl = `/api/domain/${encodeURIComponent(domainId)}/visibility`

  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  const externalFrame = page.locator('.react-flow__node-extDomain').filter({
    hasText: 'payments',
  })
  await expect(externalFrame).toBeVisible()

  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('option', { name: /Imported domains crm\.studio-demo\.astrale\.ai/ }).click()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Hide in canvas' }).click()
  await expect(externalFrame).toHaveCount(0)
  await expect
    .poll(async () => (await (await request.get(visibilityUrl)).json()).hidden)
    .toEqual({ 'domain.payments.studio-demo.astrale.ai': true })

  await panel.getByRole('button', { name: 'Show in canvas' }).click()
  await expect(externalFrame).toBeVisible()
  await expect
    .poll(async () => (await (await request.get(visibilityUrl)).json()).hidden)
    .toEqual({})
})

test('domain eyes recompose only the canvas while the schema shell stays mounted', async ({
  page,
}) => {
  const origin = 'ops.studio-demo.astrale.ai'
  await page.goto('/')
  const section = page.getByTestId('workspace-schema-section')
  const rail = page.getByTestId('workspace-domain-tree')
  await expect(section).toBeVisible()
  const mounted = [await section.elementHandle(), await rail.elementHandle()]
  const stillMounted = async () => {
    for (const element of mounted)
      expect(await element!.evaluate((node) => node.isConnected)).toBe(true)
  }

  const peerRow = rail.locator(`[data-anchor-ref="domain.${origin}"]`)
  await peerRow.getByRole('button', { name: `Show ${origin} on the canvas` }).click()
  await expect(page.getByTestId(`workspace-domain-${PEER_ID}`)).toBeVisible()
  await stillMounted()

  await peerRow.getByRole('button', { name: `Hide ${origin} on the canvas` }).click()
  await expect(page.getByTestId(`workspace-domain-${PEER_ID}`)).toHaveCount(0)
  await stillMounted()
})
