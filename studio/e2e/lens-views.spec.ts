import type { InstanceInfo, InstancesState } from '@shared/contracts/workspace'

import { clearRegistry, PAYMENTS, serveRegistry } from './registry'
import { expect, FIXTURE_ID, indexRow, openSchema, sceneBox, test, type Page } from './test'

/**
 * Views answers "what people see": every View the Domain declares is a card, after Rules and
 * before the locked Scenarios. A View opens on the active instance its user owns; when it
 * cannot, its one action is disabled and says why beside it. The Data level does not read
 * Views: its tab stays, disabled, its tooltip saying where Views are read.
 *
 * The fixture declares one View, `overview` ("CRM overview."), and no frontend serves it.
 */

const DOMAIN = `/domain/${encodeURIComponent(FIXTURE_ID)}`

const lensTab = (page: Page, lens: string) =>
  page.getByTestId('lens-switch').locator(`button[data-lens="${lens}"]`)

const viewPage = (page: Page) => page.locator('[data-inspector-view="overview"]')
const openAction = (page: Page) => viewPage(page).locator('[data-action="open-view"]')
const openBlocker = (page: Page) => viewPage(page).locator('[data-open-blocker]')

const instance = (input: Partial<InstanceInfo>): InstanceInfo => ({
  name: 'mine',
  url: 'https://mine.eu.astrale.ai/api',
  active: true,
  kind: 'bookmark',
  owned: true,
  ...input,
})

/** The instances the Studio reads, as the CLI would list them. */
async function instancesAre(page: Page, state: InstancesState) {
  await page.route('**/api/instances', (route) => route.fulfill({ json: state }))
}

test('Views sits after Rules and before Scenarios, and is a lens the address keeps', async ({
  page,
}) => {
  await openSchema(page)
  const tabs = page.getByTestId('lens-switch').locator('button[data-lens]')
  await expect(tabs).toHaveCount(5)
  expect(
    await tabs.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-lens'))),
  ).toEqual(['structure', 'behavior', 'rules', 'views', 'scenarios'])
  await expect(lensTab(page, 'views')).toBeEnabled()
  await expect(lensTab(page, 'scenarios')).toBeDisabled()

  await lensTab(page, 'views').click()
  await expect(page).toHaveURL(/[?&]lens=views\b/)
  await expect(page.getByTestId('schema-level')).toHaveAttribute('data-lens', 'views')
  await expect(sceneBox(page, 'view.overview')).toBeVisible({ timeout: 60_000 })

  await page.reload()
  await expect(lensTab(page, 'views')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneBox(page, 'view.overview')).toBeVisible({ timeout: 60_000 })

  await page.keyboard.press('1')
  await expect(page.getByTestId('schema-level')).toHaveAttribute('data-lens', 'structure')
  await page.keyboard.press('4')
  await expect(page.getByTestId('schema-level')).toHaveAttribute('data-lens', 'views')
  await page.goBack()
  await expect(page.getByTestId('schema-level')).toHaveAttribute('data-lens', 'structure')
  await page.goForward()
  await expect(page.getByTestId('schema-level')).toHaveAttribute('data-lens', 'views')
})

test('a View is a card and an Index row; its page says what it is and why it cannot open', async ({
  page,
}) => {
  await instancesAre(page, { active: null, instances: [] })
  await openSchema(page)
  await lensTab(page, 'views').click()

  const card = sceneBox(page, 'view.overview')
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card).toContainText('overview')
  await expect(card).toContainText('CRM overview.')
  await expect(card).toContainText('no code found')
  await expect(indexRow(page, 'view.overview')).toBeVisible()

  await indexRow(page, 'view.overview').click()
  await expect(card).toHaveAttribute('data-selected', 'true')
  await expect(viewPage(page)).toBeVisible()
  await expect(viewPage(page).getByRole('heading', { name: 'overview' })).toBeVisible()
  await expect(viewPage(page)).toContainText('CRM overview.')
  await expect(openAction(page)).toBeDisabled()
  await expect(openBlocker(page)).toHaveText('Choose an instance you own in the header to open it.')
  await expect(openAction(page)).toHaveAttribute(
    'aria-describedby',
    (await openBlocker(page).getAttribute('id'))!,
  )
})

test('a View opens only on an active instance its user owns', async ({ page }) => {
  await instancesAre(page, {
    active: 'team',
    instances: [instance({ name: 'team', owned: false, reason: 'Not owner' })],
  })
  await page.goto(`${DOMAIN}?lens=views&select=view.overview`)
  await expect(openAction(page)).toBeDisabled({ timeout: 60_000 })
  await expect(openBlocker(page)).toHaveText(
    'You are not the owner of team in Admin (Not owner). Its Views cannot be opened in Studio.',
  )

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await instancesAre(page, { active: 'mine', instances: [instance({})] })
  await page.reload()
  await expect(openAction(page)).toBeEnabled({ timeout: 60_000 })
  await expect(openBlocker(page)).toHaveCount(0)
})

test('the Data level does not read Views: its tab is disabled and says where they are read', async ({
  page,
}) => {
  await openSchema(page)
  await lensTab(page, 'views').click()
  await page.getByTestId('level-dataset').click()
  await page.getByRole('menuitemradio', { name: 'Support desk' }).click()
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-lens', 'structure')

  await expect(lensTab(page, 'views')).toBeDisabled()
  await lensTab(page, 'views').locator('..').hover()
  await expect(page.locator('[data-lens-reason="views"]')).toHaveText(
    'A View renders on an instance, not over a Dataset yet: read Views at the Schema level.',
  )

  // an address naming Views at the Data level lands on the dataset without it, said once
  const pasted = new URL(page.url())
  pasted.searchParams.set('lens', 'views')
  await page.goto(`${pasted.pathname}${pasted.search}`)
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
  await expect(page.getByTestId('data-level')).toHaveAttribute('data-lens', 'structure')
  await expect(
    page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'The Data level does not read Views: read Views at the Schema level.' }),
  ).toHaveCount(1)
})

test.describe('a Publication', () => {
  test.beforeEach(async () =>
    serveRegistry({
      [PAYMENTS]: {
        answer: 'index',
        publications: [
          { version: '1.1.0', stage: 'as-built', publishedAt: '2026-11-10T09:00:00.000Z' },
        ],
      },
    }),
  )
  test.afterEach(async ({ request }) => clearRegistry(request, [PAYMENTS]))

  test('reads its declared Views, and says no View code comes with it', async ({ page }) => {
    await page.goto(`/publication/${PAYMENTS}/1.1.0?lens=views`)
    await expect(page.locator('[data-publication-notice="views"]')).toContainText(
      'A published bundle holds no View code, so none of them opens here.',
      { timeout: 60_000 },
    )
    await expect(page.getByTestId('scene-empty')).toHaveText(
      'The published Schema declares no View.',
    )
  })
})
