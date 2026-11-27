import {
  drawnBoxes,
  drawnLinks,
  expect,
  indexRail,
  indexRow,
  inspector,
  lensButton,
  listedRows,
  openSchema,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
} from './test'

/**
 * The Index is the list form of the scene on the canvas: the same cards and links, grouped
 * the same way, and nothing the canvas does not draw. It shares the canvas's selection and
 * its open or closed modules, and it narrows by text and by kind.
 */

test('the Index lists exactly what the canvas draws, in each lens', async ({ page }) => {
  await openSchema(page)
  const listed = new Set(await listedRows(page))
  const boxes = await drawnBoxes(page)
  const links = (await drawnLinks(page)).filter((id) => {
    // an "is a" line selects its subclass, which the Index already lists
    return !boxes.includes(id)
  })
  for (const id of [...boxes, ...links]) expect(listed, `${id} is listed`).toContain(id)
  // modules and the other Domain's frame head their groups, as the canvas frames them
  for (const id of ['module.billing', 'module.support', 'domain.payments.studio-demo.astrale.ai'])
    expect(listed).toContain(id)
  // and nothing listed is missing from the canvas
  const regions = await sceneCanvas(page)
    .locator('[data-region-id]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.regionId!))
  for (const id of listed) expect([...boxes, ...links, ...regions], `${id} is drawn`).toContain(id)

  // Behavior draws another scene; the Index follows it
  await lensButton(page, 'behavior').click()
  await expect(indexRow(page, 'function.Invoice.settle')).toBeVisible()
  await expect(indexRow(page, 'integration.ledger')).toBeVisible()
  await expect(indexRow(page, 'class.Team')).toHaveCount(0)
  await expect(indexRow(page, 'class.WorksAt')).toHaveCount(0)

  // its mutations wait behind their chip; one selected there is drawn on the canvas
  const rail = indexRail(page)
  const mutations = rail.locator('[data-index-row^="mutation."]')
  await expect(mutations).toHaveCount(0)
  await rail
    .getByRole('group', { name: 'Kinds' })
    .getByRole('button', { name: /^Mutations/ })
    .click()
  const id = await mutations.first().getAttribute('data-index-row')
  await mutations.first().click()
  await expect(sceneBox(page, id!)).toHaveAttribute('data-selected', 'true')
})

test('selecting in the Index selects on the canvas, and the reverse', async ({ page }) => {
  await openSchema(page)
  await indexRow(page, 'class.Ticket').click()
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page).getByRole('heading', { name: 'Ticket', exact: true })).toBeVisible()

  await indexRow(page, 'class.WorksAt').click()
  await expect(sceneLink(page, 'class.WorksAt')).toHaveAttribute('data-selected', 'true')
  await expect(sceneBox(page, 'class.Ticket')).not.toHaveAttribute('data-selected', 'true')
  await expect(indexRow(page, 'class.Ticket')).toHaveAttribute('aria-selected', 'false')

  // the canvas brought WorksAt into view; one of its ends is right there to click
  await sceneBox(page, 'class.Company').click()
  await expect(indexRow(page, 'class.Company')).toHaveAttribute('aria-selected', 'true')
  await expect(indexRow(page, 'class.WorksAt')).toHaveAttribute('aria-selected', 'false')
  await expect(indexRail(page).locator('[data-index-row][aria-selected="true"]')).toHaveCount(1)
})

test('the Index narrows by text and by kind, and Enter selects the first match', async ({
  page,
}) => {
  await openSchema(page)
  const rail = indexRail(page)
  const filter = rail.getByLabel('Filter the Index')
  await filter.fill('inv')
  await expect
    .poll(() => listedRows(page))
    .toEqual([
      'module.billing',
      'class.Invoice',
      'class.BilledTo',
      'class.IssuedFrom',
      'class.SettledBy',
    ])
  // the canvas keeps drawing the whole scene
  await expect(sceneBox(page, 'class.Ticket')).toBeVisible()

  await filter.press('Enter')
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')

  await filter.fill('nothing like this')
  await expect(rail).toContainText('Nothing on the canvas matches “nothing like this”.')
  await rail.getByRole('button', { name: 'Clear the filter' }).click()
  await expect(filter).toHaveValue('')
  await expect(indexRow(page, 'class.Ticket')).toBeVisible()

  // a kind toggled off leaves the list; toggled back, it returns
  const relationships = rail.getByRole('button', { name: /^Relationships/ })
  await expect(relationships).toHaveAttribute('aria-pressed', 'true')
  await relationships.click()
  await expect(relationships).toHaveAttribute('aria-pressed', 'false')
  await expect(indexRow(page, 'class.WorksAt')).toHaveCount(0)
  await expect(indexRow(page, 'class.Ticket')).toBeVisible()
  await relationships.click()
  await expect(indexRow(page, 'class.WorksAt')).toBeVisible()
})

test('a module closed in the Index closes on the canvas', async ({ page }) => {
  await openSchema(page)
  const rail = indexRail(page)
  await rail.getByRole('button', { name: 'Close billing' }).click()
  await expect(indexRow(page, 'class.Invoice')).toHaveCount(0)
  await expect(sceneBox(page, 'class.Invoice')).toHaveCount(0)
  const module = sceneBox(page, 'module.billing')
  await expect(module).toHaveAttribute('data-box-kind', 'group')

  await rail.getByRole('button', { name: 'Open billing' }).click()
  await expect(indexRow(page, 'class.Invoice')).toBeVisible()
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible()
})
