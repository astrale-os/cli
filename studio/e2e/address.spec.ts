import type { APIRequestContext } from '@playwright/test'

import type { Scenario } from '../shared/contracts/scenarios'
import type { StudioDatasets } from '../shared/contracts/schema'

import {
  clearScenarios,
  expect,
  FIXTURE_ID,
  indexRow,
  lensButton,
  levelButton,
  openSchema,
  sceneBox,
  scenariosRoute,
  test,
  type Page,
} from './test'

/**
 * Where a reader is, is an address: the URL's path and query name the level, the Domain, the
 * dataset, the lens and the selection — at the Data level the Scenario and its step too. A
 * reload and the address pasted in another browser land on the same view; Back and Forward walk
 * the places visited; what an address names that is gone lands on the nearest thing that is,
 * said once.
 */

const DOMAIN = `/domain/${encodeURIComponent(FIXTURE_ID)}`
const ORIGIN = 'crm.studio-demo.astrale.ai'

/** The path and query the page is at. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

const toastOf = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

/** The toast says it, and says it once: nothing re-reports it once the page settles. */
async function reportedOnce(page: Page, text: string) {
  await expect(toastOf(page, text)).toHaveCount(1)
  await page.waitForTimeout(1_000)
  await expect(toastOf(page, text)).toHaveCount(1)
}

const schemaLevel = (page: Page) => page.getByTestId('schema-level')
const selected = (page: Page, id: string) =>
  expect(sceneBox(page, id)).toHaveAttribute('data-selected', 'true', { timeout: 60_000 })

/** The address in a browser that has never seen it. */
async function inAnotherBrowser(
  page: Page,
  address: string,
  lands: (page: Page) => Promise<void>,
): Promise<void> {
  const other = await page.context().browser()!.newContext()
  try {
    const elsewhere = await other.newPage()
    await elsewhere.goto(address)
    await lands(elsewhere)
  } finally {
    await other.close()
  }
}

// ─── The Schema level ─────────────────────────────────────────────────────────

test('the Schema level is addressed by its Domain, lens and selection', async ({ page }) => {
  await openSchema(page)
  // a bare `/` lands where the Workspace left the reader, and writes where that is
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure`)
  await sceneBox(page, 'class.Invoice').locator('.scene-box-title').click()
  await selected(page, 'class.Invoice')
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure&select=class.Invoice`)
  await lensButton(page, 'rules').click()
  const address = `${DOMAIN}?lens=rules&select=class.Invoice`
  await expect.poll(() => here(page)).toBe(address)

  const lands = async (on: Page) => {
    await expect(schemaLevel(on)).toHaveAttribute('data-lens', 'rules', { timeout: 60_000 })
    await selected(on, 'class.Invoice')
    await expect.poll(() => here(on)).toBe(address)
  }
  await page.reload()
  await lands(page)
  await inAnotherBrowser(page, address, lands)

  // a selection is made within a place; a lens is a place: Back returns to Structure, as it was
  await page.goBack()
  await expect(schemaLevel(page)).toHaveAttribute('data-lens', 'structure')
  await selected(page, 'class.Invoice')
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure&select=class.Invoice`)
  await page.goForward()
  await lands(page)
})

test('a Schema address naming what is gone lands on what holds it, and says so once', async ({
  page,
}) => {
  await page.goto(`${DOMAIN}?lens=structure&select=class.Invoice.property.discount`)
  await selected(page, 'class.Invoice')
  await reportedOnce(
    page,
    `${ORIGIN} has no class.Invoice.property.discount: class.Invoice is selected instead.`,
  )
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure&select=class.Invoice`)

  // gone with what holds it: nothing is selected
  await page.goto(`${DOMAIN}?select=class.Ledger`)
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible({ timeout: 60_000 })
  await reportedOnce(page, `${ORIGIN} has no class.Ledger: nothing is selected.`)
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure`)

  // a Domain this Workspace does not hold opens the Workspace; an unknown lens reads as the last
  await page.goto('/domain/ledger-gone?lens=cubist')
  await expect(page.getByTestId('workspace-level')).toBeVisible()
  await reportedOnce(page, 'The address names the lens “cubist”, which the Studio does not know.')
  await reportedOnce(
    page,
    'This Workspace holds no Domain ledger-gone: the Workspace is open instead.',
  )
  await expect.poll(() => here(page)).toBe('/workspace')
})

// ─── The Data level ───────────────────────────────────────────────────────────

/** The fixture's Support desk, by the module path the address names it with. */
async function supportDesk(request: APIRequestContext): Promise<string> {
  const answer = (await (
    await request.get(`/api/domain/${encodeURIComponent(FIXTURE_ID)}/datasets`)
  ).json()) as StudioDatasets
  const found = answer.datasets.find(
    (entry) => entry.status === 'ready' && entry.title === 'Support desk',
  )
  expect(found, 'the Support desk dataset').toBeDefined()
  return found!.path
}

/** Ann's refused read of Bob's ticket, then her refused call of `Invoice.settle`. */
const walk = (dataset: string): Scenario => ({
  id: 'address-walk',
  dataset,
  name: 'What Ann may not do',
  steps: [
    { id: 'read-login', does: 'read', on: { node: 'login' }, as: 'ann', expect: 'refused' },
    {
      id: 'settle',
      does: 'call',
      fn: 'Invoice.settle',
      on: { node: 'invoice-1' },
      as: 'ann',
      expect: 'refused',
    },
  ],
})

test.describe('the Data level', () => {
  test.beforeEach(async ({ request }) => clearScenarios(request))
  test.afterEach(async ({ request }) => clearScenarios(request))

  test('is addressed by its dataset, lens, open Scenario and step', async ({ page, request }) => {
    const dataset = await supportDesk(request)
    const put = await request.post(scenariosRoute, {
      data: { action: 'put', scenario: walk(dataset), revision: 0 },
    })
    expect(put.ok()).toBe(true)

    await openSchema(page)
    await levelButton(page, 'data').click()
    const level = page.getByTestId('data-level')
    await expect(level).toHaveAttribute('data-state', 'ready')
    const data = `${DOMAIN}/data?dataset=${encodeURIComponent(dataset)}`
    await expect.poll(() => here(page)).toBe(`${data}&lens=structure`)

    await lensButton(page, 'behavior').click()
    await expect(level).toHaveAttribute('data-lens', 'behavior')
    await indexRow(page, 'scenario.address-walk').click()
    const panel = page.locator('[data-data-panel]')
    await panel.locator('[data-step-select="settle"]').click()
    // a step puts its Node, identity and verdict in view: the address carries them with it
    const address = `${data}&lens=behavior&select=core.node.invoice-1&as=ann&verdict=call%3AInvoice.settle&scenario=address-walk&step=settle`
    await expect.poll(() => here(page)).toBe(address)

    const lands = async (on: Page) => {
      const opened = on.getByTestId('data-level')
      await expect(opened).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
      await expect(opened).toHaveAttribute('data-lens', 'behavior')
      const steps = on.locator('[data-data-panel] [data-scenario-steps] [data-step]')
      await expect(steps).toHaveCount(2)
      await expect(on.locator('[data-step="settle"]')).toHaveAttribute('data-selected', '')
      await expect(on.locator('[data-step="read-login"]')).not.toHaveAttribute('data-selected')
      await expect(sceneBox(on, 'core.node.invoice-1')).toHaveAttribute('data-selected', 'true')
      await expect.poll(() => here(on)).toBe(address)
    }
    await page.reload()
    await lands(page)
    await inAnotherBrowser(page, address, lands)

    // Back: the Structure lens on the dataset, then the Schema level it was opened from
    await page.goBack()
    await expect(level).toHaveAttribute('data-lens', 'structure')
    await expect.poll(() => here(page)).toBe(`${data}&lens=structure`)
    await page.goBack()
    await expect(schemaLevel(page)).toBeVisible()
    await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure`)
    await page.goForward()
    await expect(level).toHaveAttribute('data-lens', 'structure')
  })

  test('an address naming a step or a Node that is gone opens without it, said once', async ({
    page,
    request,
  }) => {
    const dataset = await supportDesk(request)
    await request.post(scenariosRoute, {
      data: { action: 'put', scenario: walk(dataset), revision: 0 },
    })
    const data = `${DOMAIN}/data?dataset=${encodeURIComponent(dataset)}`

    await page.goto(`${data}&lens=behavior&scenario=address-walk&step=escalate`)
    await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready', {
      timeout: 60_000,
    })
    await reportedOnce(
      page,
      'The address names the step escalate of What Ann may not do, which Support desk does not hold: the dataset is open without it.',
    )
    await expect(page.locator('[data-scenario-steps] [data-step]')).toHaveCount(2)
    await expect(page.locator('[data-step][data-selected]')).toHaveCount(0)
    await expect.poll(() => here(page)).toBe(`${data}&lens=behavior&scenario=address-walk`)

    await page.goto(`${data}&lens=structure&select=core.node.carol&as=carol`)
    await expect(page.getByTestId('data-level')).toHaveAttribute('data-ask', 'measure', {
      timeout: 60_000,
    })
    await reportedOnce(
      page,
      'The address names the Node carol and the identity carol, which Support desk does not hold: the dataset is open without them.',
    )
    await expect.poll(() => here(page)).toBe(`${data}&lens=structure`)

    await page.goto(`${DOMAIN}/data?dataset=tests%2Fdatasets%2Fgone.ts`)
    await reportedOnce(
      page,
      `${ORIGIN} declares no dataset tests/datasets/gone.ts: its datasets are listed instead.`,
    )
    await expect(page.getByTestId('datasets-page')).toHaveAttribute('data-state', 'some')
    await expect.poll(() => here(page)).toBe(`${DOMAIN}/data?lens=structure`)
  })

  test("a Domain's Datasets page is a place: the palette, reload, Back, Forward and a pasted address reach it", async ({
    page,
    request,
  }) => {
    const dataset = await supportDesk(request)
    await openSchema(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByPlaceholder('Search the schema…').fill('datasets')
    await page.getByRole('option', { name: /^Datasets/ }).click()
    const datasets = page.getByTestId('datasets-page')
    await expect(datasets).toHaveAttribute('data-state', 'some', { timeout: 60_000 })
    const listed = `${DOMAIN}/data?lens=structure`
    await expect.poll(() => here(page)).toBe(listed)

    // each dataset is a card that says how it stands; one the Schema refuses says why
    const card = (path: string) => datasets.locator(`[data-dataset-card="${path}"]`)
    await expect(card(dataset)).toHaveAttribute('data-standing', 'admitted')
    await expect(card(dataset)).toContainText('Admitted against this Schema')
    await expect(card(dataset).locator('[data-dataset-holdings]')).toContainText('Nodes')
    const broken = card('./tests/datasets/broken.ts')
    await expect(broken).toHaveAttribute('data-standing', 'unreadable')
    await expect(broken.locator('[data-dataset-reason]')).toHaveText(
      'Dataset edge source nobody is not a Node of this Dataset.',
    )

    const lands = async (on: Page) =>
      expect(on.getByTestId('datasets-page')).toHaveAttribute('data-state', 'some', {
        timeout: 60_000,
      })
    await page.reload()
    await lands(page)
    await expect.poll(() => here(page)).toBe(listed)

    // a card opens its dataset; Back returns to the page, Forward to the dataset
    await card(dataset).click()
    const level = page.getByTestId('data-level')
    await expect(level).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
    const opened = `${DOMAIN}/data?dataset=${encodeURIComponent(dataset)}&lens=structure`
    await expect.poll(() => here(page)).toBe(opened)
    await page.goBack()
    await lands(page)
    await expect.poll(() => here(page)).toBe(listed)
    await page.goForward()
    await expect(level).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
    await expect.poll(() => here(page)).toBe(opened)

    await inAnotherBrowser(page, listed, lands)
  })

  test('the retired Tests address lands on the Data level with the same dataset, said once', async ({
    page,
    request,
  }) => {
    const dataset = await supportDesk(request)
    await page.goto(`${DOMAIN}/tests?dataset=${encodeURIComponent(dataset)}`)
    const level = page.getByTestId('data-level')
    await expect(level).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
    await expect(level).toHaveAttribute('data-dataset-path', dataset)
    await expect(level).toHaveAttribute('data-lens', 'rules')
    await reportedOnce(
      page,
      'The address names Tests, which the Studio no longer has: the Data level reads the same dataset.',
    )
    await expect
      .poll(() => here(page))
      .toBe(`${DOMAIN}/data?dataset=${encodeURIComponent(dataset)}&lens=rules`)
  })

  test('a notice waits while the dataset is read, then stays long enough to be read', async ({
    page,
    request,
  }) => {
    const dataset = await supportDesk(request)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/domain/*/datasets', async (route) => {
      await held
      await route.continue()
    })
    await page.goto(`${DOMAIN}/tests?dataset=${encodeURIComponent(dataset)}`)
    // the wait names the dataset and what is read for it, and how long past a second
    const wait = page.locator('[data-data-wait]')
    // unread, the dataset is named by its module
    const unread = dataset
      .split('/')
      .pop()!
      .replace(/\.[a-z]+$/i, '')
    await expect(wait).toContainText(`Opening ${unread}`, { timeout: 60_000 })
    await expect(wait).toContainText(`Reading the datasets ${ORIGIN} declares`)
    await expect(wait.locator('[data-reading-elapsed]')).toBeVisible()
    const notice = toastOf(
      page,
      'The address names Tests, which the Studio no longer has: the Data level reads the same dataset.',
    )
    // nothing is said while the level it concerns is not on screen
    await page.waitForTimeout(2_000)
    await expect(notice).toHaveCount(0)

    release()
    await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready', {
      timeout: 60_000,
    })
    await expect(notice).toHaveCount(1)
    // past the 4 s a toast used to stand, it is still there to be read
    await page.waitForTimeout(5_000)
    await expect(notice).toBeVisible()
    await expect(notice).toHaveCount(1)
  })
})

// ─── The Workspace level ──────────────────────────────────────────────────────

test('the Workspace level is addressed by what its map selects', async ({ page }) => {
  await openSchema(page)
  await page.getByTestId('level-workspace').click()
  await expect(page.getByTestId('workspace-level')).toBeVisible()
  await expect.poll(() => here(page)).toBe('/workspace')
  await sceneBox(page, `domain:${FIXTURE_ID}`).click()
  const address = `/workspace?domain=${encodeURIComponent(FIXTURE_ID)}`
  await expect.poll(() => here(page)).toBe(address)

  const lands = async (on: Page) => {
    await expect(on.locator('[data-workspace-page="domain"]')).toHaveAttribute(
      'data-domain-name',
      'Crm',
      { timeout: 60_000 },
    )
    await expect.poll(() => here(on)).toBe(address)
  }
  await page.reload()
  await lands(page)
  await inAnotherBrowser(page, address, lands)

  // a dependency is selected within the map; Back leaves the Workspace for the Schema level
  await page.goto(`${address}&dependency=payments`)
  await expect(page.locator('[data-workspace-page="dependency"]')).toBeVisible()
  await page.goBack()
  await lands(page)
  await page.goBack()
  await expect(schemaLevel(page)).toBeVisible()
  await expect.poll(() => here(page)).toBe(`${DOMAIN}?lens=structure`)
})

test('a Workspace address naming what the map does not draw says so once', async ({ page }) => {
  await page.goto(`/workspace?domain=${encodeURIComponent(FIXTURE_ID)}&dependency=ledger`)
  await expect(page.locator('[data-workspace-page="domain"]')).toHaveAttribute(
    'data-domain-name',
    'Crm',
    { timeout: 60_000 },
  )
  await reportedOnce(
    page,
    `The Workspace map draws no dependency “ledger” of ${ORIGIN}: ${ORIGIN} is selected instead.`,
  )
  await expect.poll(() => here(page)).toBe(`/workspace?domain=${encodeURIComponent(FIXTURE_ID)}`)

  await page.goto('/workspace?domain=ledger-gone')
  await expect(page.locator('[data-workspace-page="workspace"]')).toBeVisible({ timeout: 60_000 })
  await reportedOnce(page, 'The Workspace map draws no Domain ledger-gone: nothing is selected.')
  await expect.poll(() => here(page)).toBe('/workspace')
})
