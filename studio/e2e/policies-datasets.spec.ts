import type { StudioDataset } from '../shared/contracts/schema'

import {
  clearScenarios,
  datasetCard,
  datasetLabel,
  FIXTURE_ID,
  expect,
  indexRail,
  inspector,
  lensButton,
  levelButton,
  openDatasetCard,
  openSchema,
  sceneBox,
  storedScenarios,
  test,
  type Page,
} from './test'

/**
 * A Policy judged on a dataset. Selected on the Schema's Rules lens, it is carried into the Data
 * level's Access tab, on a dataset of its Domain: the panel says how many pairs — an identity of
 * the dataset, or anyone, and a Node or Edge the Policy is decided over — it admits, each pair a
 * sentence; the map lights who it admits to what, and a pair lit, that pair alone; the Kernel's
 * verdicts where the Policy sits pin as Scenario steps. The datasets themselves are cards on the
 * Domain's Datasets page, and the Index under Access lists the Domain's Policies.
 *
 * The fixture's `support-desk` dataset holds Acme, Ann and Bob who work there, the ticket each
 * raised (`printer` by Ann, `login` by Bob) and an invoice; `mayReadTicket` admits a ticket's
 * reporter.
 */

const origin = 'crm.studio-demo.astrale.ai'
const POLICY = `policy.${origin}:policy.mayReadTicket`
const panel = (page: Page) => page.locator('[data-data-panel]')
const pair = (page: Page, id: string) => panel(page).locator(`[data-policy-pair="${id}"]`)

/** A Policy's Index row, by its name: its id is `policy.<its Domain's key>:policy.<name>`. */
const policyRow = (page: Page, name: string) =>
  indexRail(page).locator(`[data-index-row^="policy."][data-index-row$=":policy.${name}"]`)

/** Opens the Schema's Rules lens and selects a Policy from its Index row. */
async function selectPolicy(page: Page, name: string) {
  await openSchema(page)
  await page.keyboard.press('3')
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true')
  await policyRow(page, name).click()
}

test.describe('a Policy carried to a dataset', () => {
  test.beforeEach(async ({ request }) => clearScenarios(request))
  test.afterEach(async ({ request }) => clearScenarios(request))

  test('says what it admits pair by pair, lights it on the map, and pins a pair as a step', async ({
    page,
    request,
  }) => {
    await selectPolicy(page, 'mayReadTicket')
    await inspector(page).locator(`[data-policy-on-dataset="${POLICY}"]`).click()

    // the selection carries: the dataset opens under Access on the Policy
    const level = page.getByTestId('data-level')
    await expect(level).toHaveAttribute('data-state', 'ready')
    await expect(level).toHaveAttribute('data-tab', 'access')
    await expect(datasetLabel(page)).toHaveText('Support desk')
    const admits = panel(page).locator('[data-policy-admits]')
    await expect(admits).toHaveAttribute('data-policy-admits', '2/6')
    await expect(admits).toContainText('mayReadTicket admits 2 of 6 pairs.')
    await expect(pair(page, 'ann|printer')).toHaveAttribute('data-outcome', 'allowed')
    await expect(pair(page, 'ann|printer')).toContainText('mayReadTicket admits ann on printer.')
    await expect(pair(page, 'bob|login')).toHaveAttribute('data-outcome', 'allowed')
    await expect(pair(page, 'ann|login')).toContainText(
      'mayReadTicket does not admit ann on login.',
    )
    await expect(pair(page, '@anyone|login')).toHaveAttribute('data-outcome', 'refused')
    // the Index lists the Domain's Policies, the one carried selected
    await expect(indexRail(page).locator(`[data-index-row="${POLICY}"]`)).toBeVisible()

    // the map lights who it admits to what
    for (const node of ['ann', 'printer', 'bob', 'login'])
      await expect(sceneBox(page, `core.node.${node}`)).toHaveAttribute('data-emphasis', 'lit')
    await expect(sceneBox(page, 'core.node.invoice-1')).toHaveAttribute('data-emphasis', 'dim')
    // one layer marks a card at a time: what anyone reads stands aside while the Policy is lit
    const readAs = page.getByTestId('data-identity')
    await expect(readAs).toHaveAttribute('data-set-aside', '')
    await expect(readAs).toContainText('Set aside while mayReadTicket is selected')
    await expect(readAs.getByTestId('data-read-summary')).toHaveCount(0)
    await expect(sceneBox(page, 'core.node.login')).not.toContainText("can't read")
    await expect(sceneBox(page, 'core.node.login')).not.toHaveAttribute('data-muted', 'true')

    // a pair lit lights that pair alone, and says what the Kernel decides where the Policy sits
    await pair(page, 'ann|login').locator('[data-pair-light]').click()
    await expect(pair(page, 'ann|login')).toHaveAttribute('data-lit', '')
    await expect(sceneBox(page, 'core.node.ann')).toHaveAttribute('data-emphasis', 'lit')
    await expect(sceneBox(page, 'core.node.login')).toHaveAttribute('data-emphasis', 'lit')
    await expect(sceneBox(page, 'core.node.printer')).toHaveAttribute('data-emphasis', 'dim')
    const verdicts = pair(page, 'ann|login').locator('[data-pair-verdicts]')
    await expect(verdicts).toContainText('ann may not read login.')

    // the verdict pins as a step asked by the pair's identity
    await verdicts.locator('[data-verdict-pin="read:login"]').click()
    await page.locator('[data-pin-menu="read:login"] [data-pin-new]').click()
    await expect
      .poll(async () =>
        (await storedScenarios(request)).flatMap((scenario) =>
          scenario.steps.map(({ does, on, as, expect }) => ({ does, on, as, expect })),
        ),
      )
      .toEqual([{ does: 'read', on: { node: 'login' }, as: 'ann', expect: 'refused' }])

    // the address carries the Policy and the pair lit: a reload lands on both
    await page.reload()
    await expect(level).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
    await expect(pair(page, 'ann|login')).toHaveAttribute('data-lit', '')
    await expect(admits).toHaveAttribute('data-policy-admits', '2/6')
    // a pair lit sets them aside as well
    await expect(sceneBox(page, 'core.node.login')).not.toContainText("can't read")
    await expect(readAs).toHaveAttribute('data-set-aside', '')

    // and back to the Schema, on the same Policy
    await panel(page).locator(`[data-policy-schema="${POLICY}"]`).click()
    await expect(page.getByTestId('schema-level')).toBeVisible()
    await expect(inspector(page).locator(`[data-policy-on-dataset="${POLICY}"]`)).toBeVisible()
  })

  test('the identity read as marks the map again once the Policy is no longer selected', async ({
    page,
  }) => {
    await selectPolicy(page, 'mayReadTicket')
    await inspector(page).locator(`[data-policy-on-dataset="${POLICY}"]`).click()
    await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
    const readAs = page.getByTestId('data-identity')
    await expect(readAs).toHaveAttribute('data-set-aside', '')
    await expect(sceneBox(page, 'core.node.login')).not.toHaveAttribute('data-muted', 'true')

    await page.keyboard.press('Escape')
    await expect(panel(page).locator('[data-policy-admits]')).toHaveCount(0)
    await expect(readAs).not.toHaveAttribute('data-set-aside', '')
    await expect(readAs).toContainText('reads 4 of 6 Nodes')
    await expect(readAs.getByTestId('data-read-summary')).toBeVisible()
    await expect(sceneBox(page, 'core.node.login')).toHaveAttribute('data-muted', 'true')
    await expect(sceneBox(page, 'core.node.login')).toContainText("can't read")
  })

  test('a Domain with no ready dataset keeps the reader on the Schema, and says why', async ({
    page,
  }) => {
    await page.route('**/api/domain/*/datasets', (route) =>
      route.fulfill({ json: { domainId: FIXTURE_ID, datasets: [], extractedAt: '' } }),
    )
    await selectPolicy(page, 'mayReadTicket')
    await inspector(page).locator(`[data-policy-on-dataset="${POLICY}"]`).click()
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'mayReadTicket cannot be read' }),
    ).toContainText('This Domain has no dataset that could be read.')
    await expect(page.getByTestId('schema-level')).toBeVisible()
    await expect(page.getByTestId('data-level')).toHaveCount(0)
  })
})

test('several datasets are cards on their page; the one open says what it holds', async ({
  page,
}) => {
  const datasets: StudioDataset[] = ['First scenario', 'Second scenario'].map((title, i) => ({
    status: 'ready',
    path: `tests/scenario-${i}.ts`,
    id: `scenario-${i}`,
    title,
    description: `Description of scenario ${i}`,
    origin,
    revision: 'test',
    schemaMatch: true,
    references: {},
    variables: {},
    nodes: [{ path: `company-${i}`, className: 'Company', data: { displayName: 'Example' } }],
    edges: [],
  }))
  await page.route('**/api/domain/*/datasets', (route) =>
    route.fulfill({ json: { domainId: FIXTURE_ID, datasets, extractedAt: '' } }),
  )
  await openSchema(page)
  // two it can read, none read before: Data opens their page, where one is picked
  await levelButton(page, 'data').click()
  await expect(page.getByTestId('datasets-page')).toHaveAttribute('data-state', 'some')
  await expect(page.locator('[data-dataset-card] [data-action="open-dataset"]')).toHaveText([
    'First scenario',
    'Second scenario',
  ])
  await expect(datasetCard(page, 'tests/scenario-0.ts')).toContainText('Description of scenario 0')
  await openDatasetCard(page, 'tests/scenario-0.ts')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  // the dataset opens measured against its Schema
  const measure = page.locator('[data-ask-page="measure"]')
  await expect(measure).toContainText('Description of scenario 0')

  // the label leads back to the page: a button, no menu of datasets
  await expect(datasetLabel(page)).not.toHaveAttribute('aria-haspopup')
  await datasetLabel(page).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await openDatasetCard(page, 'tests/scenario-1.ts')
  await expect(measure).toContainText('Description of scenario 1')
  await expect(measure).not.toContainText('Description of scenario 0')
  // its one Company counts on the Company card; a Class it holds no Node of stands quiet
  await expect(sceneBox(page, 'class.Company')).not.toHaveAttribute('data-absent')
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-absent', 'true')

  // under Access, the Index lists the Domain's Policies in words, each with where it sits
  await page.keyboard.press('2')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-tab', 'access')
  await expect(policyRow(page, 'mayReadTicket')).toContainText('2 places')
  await expect(policyRow(page, 'mayManageInvoice')).toContainText('may manage Invoice')
  await expect(policyRow(page, 'mayManageInvoice')).toContainText('1 place')
})

test('a Domain that references no dataset says so on Data, which opens a page with none to open', async ({
  page,
}) => {
  await page.route('**/api/domain/*/datasets', (route) =>
    route.fulfill({ json: { domainId: FIXTURE_ID, datasets: [], extractedAt: '' } }),
  )
  await openSchema(page)
  await expect(levelButton(page, 'data')).toHaveAttribute('data-hint', 'ask-dataset')
  await levelButton(page, 'data').click()
  // nothing to open: the Datasets page says what a Dataset is and how to write one
  const datasets = page.getByTestId('datasets-page')
  await expect(datasets).toHaveAttribute('data-state', 'none')
  await expect(datasets.getByText('No Dataset referenced', { exact: true })).toBeVisible()
  await expect(datasets.locator('[data-dataset-card]')).toHaveCount(0)
})
