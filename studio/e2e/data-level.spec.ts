import type { StudioDatasets } from '../shared/contracts/schema'

import {
  datasetCard,
  datasetLabel,
  expect,
  indexRow,
  listedRows,
  openDatasetCard,
  openSupportDesk,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
  type Page,
} from './test'

/**
 * Through Rules and Behavior the Data level reads a dataset whole on the canvas: its Nodes grouped
 * by Class, its Edges as links, the selection read in sentences in the panel. Through Rules it
 * reads the dataset as one of its identities: what that identity cannot read dims, and a selected
 * Node says its verdict, by which rule, and lights the Edges that prove it. Through Structure the
 * dataset is asked, never drawn whole (`data-ask.spec.ts`).
 *
 * The fixture's `support-desk` dataset holds Acme, Ann and Bob who work there, the ticket each
 * raised, and an invoice billed to Acme; the Ticket read Policy admits only who raised it.
 */

const panel = (page: Page) => page.locator('[data-data-panel]')

/** Whether one drawn element lies inside another, on screen. */
async function inside(page: Page, inner: string, outer: string): Promise<boolean> {
  const [a, b] = [
    await page.locator(inner).first().boundingBox(),
    await page.locator(outer).first().boundingBox(),
  ]
  if (!a || !b) return false
  return (
    a.x >= b.x - 1 &&
    a.y >= b.y - 1 &&
    a.x + a.width <= b.x + b.width + 1 &&
    a.y + a.height <= b.y + b.height + 1
  )
}

test('a dataset read whole draws its Nodes grouped by Class, and a selected Edge reads as a sentence', async ({
  page,
}) => {
  await openSupportDesk(page)
  await page.keyboard.press('3')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-lens', 'rules')
  const nodes = ['acme', 'invoice-1', 'ann', 'bob', 'login', 'printer']
  for (const node of nodes) await expect(sceneBox(page, `core.node.${node}`)).toBeVisible()
  for (let edge = 0; edge < 6; edge++)
    await expect(sceneLink(page, `core.edge.${edge}`)).toHaveCount(1)

  // a Class with several Nodes is a region around them; a Class of one names it on its card
  const regions = sceneCanvas(page).locator('[data-region-id]')
  await expect(regions).toHaveCount(2)
  for (const [region, members] of [
    ['class.Person', ['ann', 'bob']],
    ['class.Ticket', ['login', 'printer']],
  ] as const) {
    await expect(
      sceneCanvas(page).locator(`[data-region-id="${region}"] .scene-region-label`),
    ).toHaveText(new RegExp(`^${region.slice('class.'.length)}\\b`))
    for (const member of members)
      expect(
        await inside(
          page,
          `.scene-box[data-box-id="core.node.${member}"]`,
          `[data-region-id="${region}"]`,
        ),
        `${member} sits in ${region}`,
      ).toBe(true)
  }
  await expect(sceneBox(page, 'core.node.acme')).toContainText('Company')
  await expect(sceneBox(page, 'core.node.invoice-1')).toContainText('Invoice')

  // the Index lists the same, Class by Class, each with its Nodes and the Edges they hold, under
  // the Domain's Policies
  const listed = await listedRows(page)
  expect(listed.slice(listed.indexOf('class.Company'))).toEqual([
    'class.Company',
    'core.node.acme',
    'class.Invoice',
    'core.node.invoice-1',
    'core.edge.2',
    'class.Person',
    'core.node.ann',
    'core.node.bob',
    'core.edge.0',
    'core.edge.1',
    'class.Ticket',
    'core.node.login',
    'core.node.printer',
    'core.edge.3',
    'core.edge.4',
    'core.edge.5',
  ])

  // nothing selected, the panel reads the dataset itself
  await expect(panel(page)).toContainText('Support desk')
  await expect(panel(page)).toContainText('6 Nodes, 6 Edges, 4 Classes')

  await indexRow(page, 'core.edge.0').click()
  await expect(sceneLink(page, 'core.edge.0')).toHaveAttribute('data-selected', 'true')
  await expect(panel(page)).toContainText('ann → acme')
  await expect(panel(page)).toContainText('ann —WorksAt→ acme.')
  // its ends stay lit, the rest of the dataset steps back
  for (const end of ['ann', 'acme'])
    await expect(sceneBox(page, `core.node.${end}`)).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneBox(page, 'core.node.bob')).toHaveAttribute('data-emphasis', 'dim')
})

test('read as an identity, what it cannot read dims, and a Node says its verdict with its proof', async ({
  page,
}) => {
  await openSupportDesk(page)
  await page.keyboard.press('3')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-lens', 'rules')

  const identity = page.getByTestId('data-identity')
  const trigger = page.getByTestId('data-identity-trigger')
  await expect(trigger).toHaveText('anyone')
  await expect(identity).toContainText('reads 4 of 6 Nodes')
  await expect(sceneBox(page, 'core.node.login')).toHaveAttribute('data-muted', 'true')
  await expect(sceneBox(page, 'core.node.printer')).toHaveAttribute('data-muted', 'true')

  await trigger.click()
  await page.locator('[data-identity="ann"]').click()
  await expect(trigger).toHaveText('ann')
  await expect(identity).toContainText('reads 5 of 6 Nodes')
  // Ann reads the ticket she raised, not Bob's
  const login = sceneBox(page, 'core.node.login')
  await expect(login).toHaveAttribute('data-muted', 'true')
  await expect(login).toContainText("can't read")
  const printer = sceneBox(page, 'core.node.printer')
  await expect(printer).not.toHaveAttribute('data-muted', 'true')
  await expect(printer).toContainText('can read')
  await expect(
    sceneCanvas(page).locator('[data-region-id="class.Ticket"] .scene-region-label'),
  ).toHaveText('Ticket · 1 of 2 readable')

  // a refused Node says so, and by which Policy
  await indexRow(page, 'core.node.login').click()
  const refused = panel(page).locator('[data-verdict="read:login"]')
  await expect(refused).toHaveAttribute('data-outcome', 'refused')
  await expect(refused).toContainText('ann may not read login.')
  await expect(refused).toContainText('By Policy mayReadTicket')

  // an allowed one says through which Edges, and lights them on the map
  await indexRow(page, 'core.node.printer').click()
  const allowed = panel(page).locator('[data-verdict="read:printer"]')
  await expect(allowed).toHaveAttribute('data-outcome', 'allowed')
  await expect(allowed).toContainText('ann may read printer.')
  await expect(allowed.locator('[data-verdict-path]')).toContainText('printer —RaisedBy→ ann')
  await expect(allowed).toHaveAttribute('data-lit', '')
  await expect(sceneLink(page, 'core.edge.5')).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneLink(page, 'core.edge.4')).toHaveAttribute('data-emphasis', 'dim')
  await expect(sceneBox(page, 'core.node.ann')).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneBox(page, 'core.node.bob')).toHaveAttribute('data-emphasis', 'dim')

  // its walk and its Figure stand on the stage, not in the panel, marked on this case: the Edge
  // that admits it wears the number of the step that follows it
  const stage = page.getByTestId('rule-stage')
  await expect(stage).toBeVisible()
  await expect(stage.locator('[data-walk-step]')).toHaveText([
    /^1\s*Start at the Ticket$/,
    /^2\s*Follow \S+ to you$/,
  ])
  await expect(stage.locator('[data-figure-step]')).toHaveText(['1', '2'])
  await expect(allowed.locator('.vr-figure')).toHaveCount(0)
  await expect(allowed.locator('[data-path-edge="core.edge.5"]')).toHaveAttribute(
    'data-path-step',
    '2',
  )
  // the map numbers the walk where each step stands, with the stage's numbers
  const mapStep = (number: number) =>
    sceneCanvas(page).locator(`.scene-step[data-step-number="${number}"]`)
  await expect(mapStep(1)).toHaveAttribute('data-step', 'core.node.printer')
  await expect(mapStep(2)).toHaveAttribute('data-step', 'core.edge.5')

  // Behavior on data is Scenarios: said, not drawn yet
  await page.keyboard.press('2')
  await expect(page.getByTestId('data-behavior')).toBeVisible()
})

test('a dataset its Schema refuses is listed, and opening it says where and why', async ({
  page,
}) => {
  await openSupportDesk(page)
  await datasetLabel(page).click()
  await expect(datasetCard(page, './tests/datasets/support-desk.ts')).toBeVisible()
  // it has no title to show: it is named by its module, and marked with why
  const broken = datasetCard(page, './tests/datasets/broken.ts')
  await expect(broken).toHaveAttribute('data-standing', 'unreadable')
  await expect(broken.locator('[data-action="open-dataset"]')).toHaveText('broken')
  await expect(broken).toContainText('Dataset edge source nobody is not a Node of this Dataset.')
  await openDatasetCard(page, './tests/datasets/broken.ts')

  const failed = page.getByTestId('data-level-failed')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'failed')
  await expect(failed.getByRole('heading', { name: 'broken' })).toBeVisible()
  await expect(failed).toContainText('This dataset could not be read')
  await expect(page.getByTestId('data-level-failed-path')).toHaveText('./tests/datasets/broken.ts')
  await expect(page.getByTestId('data-level-failed-reason')).toHaveText(
    'Dataset edge source nobody is not a Node of this Dataset.',
  )
  await expect(datasetLabel(page)).toHaveText('broken')

  // another dataset is one choice away: the label leads back to every dataset
  await datasetLabel(page).click()
  await openDatasetCard(page, './tests/datasets/support-desk.ts')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  await expect(datasetLabel(page)).toHaveText('Support desk')
})

test('a dataset that stops loading while open says where and why, and comes back once fixed', async ({
  page,
  request,
}) => {
  await openSupportDesk(page)

  // the module breaks while it is open: the server's next extraction refuses it
  const failure = 'E2E: the dataset module threw while loading.'
  await page.route('**/api/domain/*/datasets', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as StudioDatasets
    body.datasets = body.datasets.map((entry) =>
      entry.path === './tests/datasets/support-desk.ts'
        ? { status: 'failed', path: entry.path, error: { message: failure } }
        : entry,
    )
    await route.fulfill({ response, json: body })
  })
  expect((await request.post('/api/workspace/refresh')).ok()).toBe(true)

  const failed = page.getByTestId('data-level-failed')
  await expect(failed).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'failed')
  // the same dataset, by its module: the reader stays where it was
  await expect(failed.getByRole('heading', { name: 'support-desk' })).toBeVisible()
  await expect(failed).toContainText('This dataset could not be read')
  await expect(page.getByTestId('data-level-failed-path')).toHaveText(
    './tests/datasets/support-desk.ts',
  )
  await expect(page.getByTestId('data-level-failed-reason')).toHaveText(failure)
  await expect(sceneBox(page, 'class.Company')).toHaveCount(0)

  // fixed, it is extracted again and drawn where the reader stands
  await page.unroute('**/api/domain/*/datasets')
  expect((await request.post('/api/workspace/refresh')).ok()).toBe(true)
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready', {
    timeout: 60_000,
  })
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-ask', 'measure')
  await expect(sceneBox(page, 'class.Company')).toBeVisible()
})
