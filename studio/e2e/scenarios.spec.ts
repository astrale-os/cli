import type { APIRequestContext } from '@playwright/test'

import type { ScenarioStore } from '../shared/contracts/scenarios'

import { revisionOf } from '../shared/contracts/scenarios'
import {
  FIXTURE_ID,
  expect,
  indexRail,
  indexRow,
  openSchema,
  sceneBox,
  test,
  type Page,
} from './test'

/**
 * Scenarios at the Data level: a verdict the Rules lens decides is pinned as a step that expects
 * it, and Behavior reads the dataset's Scenarios, each step judged again on the dataset as written.
 *
 * In the fixture's `support-desk` dataset, Ann may not read Bob's ticket (`login`), and may not
 * settle the invoice billed to Acme: `Invoice.settle` asks `mayManageInvoice`, which she fails.
 * `settle` is declared to update the Invoice and create a Payment linked to it; the dataset holds
 * no Payment.
 */

const route = `/api/domain/${encodeURIComponent(FIXTURE_ID)}/scenarios`

/** The suite's reset keeps `scenarios.json`: each run starts and ends with none. */
async function clearScenarios(request: APIRequestContext) {
  const store = (await (await request.get(route)).json()) as ScenarioStore
  for (const scenario of store.scenarios) {
    const response = await request.post(route, {
      data: { action: 'delete', id: scenario.id, revision: revisionOf(store, scenario.id) },
    })
    expect(response.ok()).toBe(true)
  }
}

const stored = async (request: APIRequestContext) =>
  ((await (await request.get(route)).json()) as ScenarioStore).scenarios

test.beforeEach(async ({ request }) => clearScenarios(request))
test.afterEach(async ({ request }) => clearScenarios(request))

async function openSupportDesk(page: Page) {
  await openSchema(page)
  await page.getByTestId('level-dataset').click()
  await page.getByRole('menuitemradio', { name: 'Support desk' }).click()
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  await expect(sceneBox(page, 'core.node.acme')).toBeVisible()
}

const panel = (page: Page) => page.locator('[data-data-panel]')
const lens = (page: Page) => page.getByTestId('data-level')
const toastOf = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

test('verdicts pinned from Rules make a Scenario that Behavior judges again, step by step', async ({
  page,
  request,
}) => {
  await openSupportDesk(page)

  // no Scenario yet: Behavior says what one is, and the first step is one action away
  await page.keyboard.press('2')
  await expect(lens(page)).toHaveAttribute('data-lens', 'behavior')
  await expect(panel(page).locator('[data-scenario-empty]')).toContainText(
    'A Scenario is a list of steps on this dataset',
  )
  await panel(page).locator('[data-scenario-first]').click()
  await expect(lens(page)).toHaveAttribute('data-lens', 'rules')

  await page.getByTestId('data-identity-trigger').click()
  await page.locator('[data-identity="ann"]').click()

  // Ann's refused read of Bob's ticket starts a new Scenario
  await indexRow(page, 'core.node.login').click()
  await panel(page).locator('[data-verdict-pin="read:login"]').click()
  await page.locator('[data-pin-menu="read:login"] [data-pin-new]').click()
  await expect(toastOf(page, 'New Scenario')).toBeVisible()

  // her refused call of settle joins it; the ask it holds is marked, and not offered twice
  await indexRow(page, 'core.node.invoice-1').click()
  const settle = panel(page).locator('[data-verdict-pin="call:Invoice.settle"]')
  await settle.click()
  const menu = page.locator('[data-pin-menu="call:Invoice.settle"]')
  await expect(menu).toContainText('Pin as a step that expects it refused')
  await menu.locator('[data-pin-scenario]').click()
  await expect(settle).toHaveAttribute('data-held', '')
  await settle.click()
  await expect(menu.locator('[data-pin-scenario]')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await expect.poll(async () => (await stored(request)).map((one) => one.steps.length)).toEqual([2])

  // in Behavior the selected Node offers the steps that involve it
  await page.keyboard.press('2')
  await expect(panel(page).locator('[data-involving-step]')).toHaveCount(1)
  await expect(panel(page).locator('[data-involving-step]')).toContainText('Invoice.settle')

  // the Index lists the Scenario with its standing; opened, its steps read as sentences
  const listed = indexRail(page).locator('[data-index-row^="scenario."]')
  await expect(listed).toHaveCount(1)
  await expect(listed).toContainText('2 of 2 as expected')
  await listed.click()
  const steps = panel(page).locator('[data-scenario-steps] [data-step]')
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(0)).toContainText('ann reads login — refused, as expected')
  await expect(steps.nth(1)).toContainText('ann calls Invoice.settle')
  await expect(steps.nth(1)).toContainText('refused, as expected')
  await expect(panel(page).locator('[data-scenario-standing]')).toHaveText('2 of 2 as expected')
  // the limit is said once, on the Scenario
  await expect(panel(page).locator('[data-scenario-limit]')).toHaveText(
    'Each step is judged on the dataset as written; writes are listed as declared, not applied.',
  )

  // a call step lights who acts, what it acts on, and the Classes it is declared to write
  await steps.nth(1).locator('[data-step-select]').click()
  const declared = steps.nth(1).locator('[data-step-declared]')
  const creates = declared.locator('[data-effect="create"]')
  await expect(creates).toContainText('creates Payment · SettledBy')
  await expect(creates.locator('[data-effect-verb="create"]')).toHaveText('creates')
  // a declared Class the dataset holds no Node of is said, and drawn as a quiet stand-in
  await expect(creates).toContainText('No Node of this dataset is a Payment.')
  await expect(declared.locator('[data-effect="update"]')).toContainText('updates Invoice')
  // the actor says it calls, apart from a read
  const ann = sceneBox(page, 'core.node.ann')
  await expect(ann.locator('[data-badge="calls"]')).toHaveAttribute('data-badge-tone', 'call')
  // the declared write is marked, as declared, where it would land
  const invoice = sceneBox(page, 'core.node.invoice-1')
  await expect(invoice.locator('[data-badge="declared"][data-outline]')).toBeVisible()
  await expect(invoice.locator('[data-badge="updates"][data-outline]')).toHaveAttribute(
    'data-badge-tone',
    'update',
  )
  const payment = page.locator('[data-testid="scene-canvas"] .scene-box[data-box-id^="absent."]')
  await expect(payment).toHaveCount(1)
  await expect(payment).toHaveAttribute('data-absent', 'true')
  await expect(payment).toContainText('Payment')
  await expect(payment.locator('[data-badge="creates"][data-outline]')).toBeVisible()
  for (const lit of ['ann', 'invoice-1'])
    await expect(sceneBox(page, `core.node.${lit}`)).toHaveAttribute('data-emphasis', 'lit')
  await expect(payment).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneBox(page, 'core.node.bob')).toHaveAttribute('data-emphasis', 'dim')

  // the read step's actor reads
  await steps.nth(0).locator('[data-step-select]').click()
  await expect(ann.locator('[data-badge="reads"]')).toHaveAttribute('data-badge-tone', 'read')
  await expect(ann.locator('[data-badge="calls"]')).toHaveCount(0)
  await expect(payment).toHaveCount(0)

  // flipped, the read no longer stands as expected: it is reported first, expected against found
  await steps.nth(0).locator('[data-step-flip]').click()
  await expect(steps.nth(0)).toHaveAttribute('data-expect', 'allowed')
  await expect(steps.nth(0)).toHaveAttribute('data-standing', 'unexpected')
  const broken = panel(page).locator('[data-scenario-broken] [data-broken-step]')
  await expect(broken).toHaveCount(1)
  await expect(broken).toContainText('ann reads login — refused, expected allowed')
  await expect(broken).toContainText('By Policy mayReadTicket')
  const [brokenAt, stepsAt] = [
    await panel(page).locator('[data-scenario-broken]').boundingBox(),
    await panel(page).locator('[data-scenario-steps]').boundingBox(),
  ]
  expect(brokenAt!.y).toBeLessThan(stepsAt!.y)
  await expect(panel(page).locator('[data-scenario-standing]')).toHaveText('1 of 2 as expected')
  await expect(listed).toContainText('1 of 2 as expected')

  // a step selected in Behavior arrives in Rules on its verdict
  await steps.nth(1).locator('[data-step-select]').click()
  await steps.nth(1).locator('[data-step-rules]').click()
  await expect(lens(page)).toHaveAttribute('data-lens', 'rules')
  await expect(page.getByTestId('data-identity-trigger')).toHaveText('ann')
  await expect(panel(page).locator('[data-verdict="call:Invoice.settle"]')).toHaveAttribute(
    'data-lit',
    '',
  )

  await expect
    .poll(async () => (await stored(request))[0]?.steps.map((one) => one.expect))
    .toEqual(['allowed', 'refused'])

  // reloaded, everything is where it was left
  await page.reload()
  await openSupportDesk(page)
  await page.keyboard.press('2')
  await expect(lens(page)).toHaveAttribute('data-lens', 'behavior')
  const row = panel(page).locator('[data-scenario-row]')
  await expect(row).toHaveCount(1)
  await expect(row.locator('[data-scenario-standing]')).toHaveText('1 of 2 as expected')
  await row.click()
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(0)).toHaveAttribute('data-expect', 'allowed')
  await expect(broken).toHaveCount(1)

  // a step deleted comes back where it was on undo
  await steps.nth(0).locator('[data-step-select]').click()
  await steps.nth(0).locator('[data-step-delete]').click()
  await expect(steps).toHaveCount(1)
  await toastOf(page, 'Step 1 deleted').getByRole('button', { name: 'Undo' }).click()
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(0)).toContainText('ann reads login')

  // the Scenario deleted leaves the dataset with none, and comes back whole on undo
  await panel(page).locator('[data-scenario-delete]').click()
  await expect(panel(page).locator('[data-scenario-empty]')).toBeVisible()
  await expect(listed).toHaveCount(0)
  await expect.poll(async () => (await stored(request)).length).toBe(0)
  await toastOf(page, 'Scenario Ann reads login deleted')
    .getByRole('button', { name: 'Undo' })
    .click()
  await expect(listed).toHaveCount(1)
  await expect(listed).toContainText('1 of 2 as expected')
  await expect.poll(async () => (await stored(request)).map((one) => one.steps.length)).toEqual([2])
})

test('a Scenario written in another window reaches this one without a reload', async ({
  page,
  request,
}) => {
  await openSupportDesk(page)
  await page.keyboard.press('2')
  await expect(lens(page)).toHaveAttribute('data-lens', 'behavior')
  await expect(panel(page).locator('[data-scenario-empty]')).toBeVisible()

  // another window writes one through the same route
  const written = await request.post(route, {
    data: {
      action: 'put',
      revision: 0,
      scenario: {
        id: 'written-elsewhere',
        dataset: './tests/datasets/support-desk.ts',
        name: 'Written elsewhere',
        steps: [{ id: 'one', as: 'ann', does: 'read', on: { node: 'login' }, expect: 'refused' }],
      },
    },
  })
  expect(written.ok()).toBe(true)
  const row = panel(page).locator('[data-scenario-row="written-elsewhere"]')
  await expect(row).toBeVisible()
  await expect(row.locator('[data-scenario-standing]')).toHaveText('1 of 1 as expected')

  // and one deleted there leaves this one too
  const deleted = await request.post(route, {
    data: { action: 'delete', id: 'written-elsewhere', revision: 1 },
  })
  expect(deleted.ok()).toBe(true)
  await expect(row).toHaveCount(0)
  await expect(panel(page).locator('[data-scenario-empty]')).toBeVisible()
})
