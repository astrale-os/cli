import type { APIRequestContext } from '@playwright/test'

import type { ScenarioStore } from '../shared/contracts/scenarios'
import type { StudioDataset } from '../shared/contracts/schema'

import { revisionOf } from '../shared/contracts/scenarios'
import {
  FIXTURE_ID,
  expect,
  indexRail,
  inspector,
  lensButton,
  openSchema,
  sceneBox,
  test,
  type Page,
} from './test'

/**
 * A Policy judged on a dataset. Selected on the Schema's Rules lens, it is carried into the Data
 * level's Rules lens, on a dataset of its Domain: the panel says how many pairs — an identity of
 * the dataset, or anyone, and a Node or Edge the Policy is decided over — it admits, each pair a
 * sentence; the map lights who it admits to what, and a pair lit, that pair alone; the Kernel's
 * verdicts where the Policy sits pin as Scenario steps. The datasets themselves are choices in
 * the dataset crumb, and the Rules lens's Index lists the Domain's Policies.
 *
 * The fixture's `support-desk` dataset holds Acme, Ann and Bob who work there, the ticket each
 * raised (`printer` by Ann, `login` by Bob) and an invoice; `mayReadTicket` admits a ticket's
 * reporter.
 */

const origin = 'crm.studio-demo.astrale.ai'
const POLICY = `policy.${origin}:policy.mayReadTicket`
const scenarios = `/api/domain/${encodeURIComponent(FIXTURE_ID)}/scenarios`
const panel = (page: Page) => page.locator('[data-data-panel]')
const pair = (page: Page, id: string) => panel(page).locator(`[data-policy-pair="${id}"]`)

async function clearScenarios(request: APIRequestContext) {
  const store = (await (await request.get(scenarios)).json()) as ScenarioStore
  for (const scenario of store.scenarios)
    await request.post(scenarios, {
      data: { action: 'delete', id: scenario.id, revision: revisionOf(store, scenario.id) },
    })
}

/** Opens the Schema's Rules lens and selects a Policy from its Index row. */
async function selectPolicy(page: Page, name: string) {
  await openSchema(page)
  await page.keyboard.press('3')
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true')
  await indexRail(page)
    .locator(`[data-index-row^="policy."][data-index-row$=":policy.${name}"]`)
    .click()
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

    // the selection carries: the dataset opens under Rules on the Policy
    const level = page.getByTestId('data-level')
    await expect(level).toHaveAttribute('data-state', 'ready')
    await expect(level).toHaveAttribute('data-lens', 'rules')
    await expect(page.getByTestId('level-dataset')).toContainText('Support desk')
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
      .poll(async () => {
        const store = (await (await request.get(scenarios)).json()) as ScenarioStore
        return store.scenarios.flatMap((scenario) =>
          scenario.steps.map(({ does, on, as, expect }) => ({ does, on, as, expect })),
        )
      })
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

test('datasets are choices in the crumb; the one open says what it holds', async ({ page }) => {
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
  await page.getByTestId('level-dataset').click()
  const menu = page.getByRole('menu')
  const choices = menu.getByRole('menuitemradio')
  await expect(choices).toHaveText(['No dataset', 'First scenario', 'Second scenario'])
  await expect(menu).not.toContainText('Description')
  await menu.getByRole('menuitemradio', { name: 'First scenario' }).click()
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  await expect(panel(page)).toContainText('Description of scenario 0')

  await page.getByTestId('level-dataset').click()
  await menu.getByRole('menuitemradio', { name: 'Second scenario' }).click()
  await expect(panel(page)).toContainText('Description of scenario 1')
  await expect(panel(page)).not.toContainText('Description of scenario 0')
  await expect(sceneBox(page, 'core.node.company-1')).toBeVisible()

  // under Rules, the Index lists the Domain's Policies, each with where it sits
  await page.keyboard.press('3')
  const policies = indexRail(page).locator('[data-index-row^="policy."]')
  await expect(policies.filter({ hasText: 'mayReadTicket' })).toContainText('2 places')
  await expect(policies.filter({ hasText: 'mayManageInvoice' })).toContainText('1 place')
})

test('a Domain that references no dataset says so in the crumb, concisely', async ({ page }) => {
  await page.route('**/api/domain/*/datasets', (route) =>
    route.fulfill({ json: { domainId: FIXTURE_ID, datasets: [], extractedAt: '' } }),
  )
  await openSchema(page)
  await page.getByTestId('level-dataset').click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('No Dataset referenced', { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitemradio')).toHaveText(['No dataset'])
})
