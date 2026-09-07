import { expect, test } from './test'

const PEER = { id: 'peer', origin: 'ops.studio-demo.astrale.ai' }

test('domain eyes recompose only the canvas while the schema shell stays mounted', async ({
  page,
}) => {
  await page.goto('/')
  const section = page.getByTestId('workspace-schema-section')
  const rail = page.getByTestId('workspace-domain-tree')
  await expect(section).toBeVisible()
  const sectionElement = await section.elementHandle()
  const railElement = await rail.elementHandle()

  const peerRow = rail.locator(`[data-anchor-ref="domain.${PEER.origin}"]`)
  await peerRow.getByRole('button', { name: `Show ${PEER.origin} on the canvas` }).click()
  await expect(page.getByTestId(`workspace-domain-${PEER.id}`)).toBeVisible()
  expect(await sectionElement!.evaluate((element) => element.isConnected)).toBe(true)
  expect(await railElement!.evaluate((element) => element.isConnected)).toBe(true)

  await peerRow.getByRole('button', { name: `Hide ${PEER.origin} on the canvas` }).click()
  await expect(page.getByTestId(`workspace-domain-${PEER.id}`)).toHaveCount(0)
  expect(await sectionElement!.evaluate((element) => element.isConnected)).toBe(true)
  expect(await railElement!.evaluate((element) => element.isConnected)).toBe(true)
})
