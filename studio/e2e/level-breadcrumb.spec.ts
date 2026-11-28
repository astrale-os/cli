import {
  chatAction,
  datasetCard,
  datasetLabel,
  expect,
  FIXTURE_ID,
  indexRow,
  inspector,
  lensButton,
  levelButton,
  openDatasetCard,
  openSchema,
  PEER_ID,
  sceneBox,
  test,
  type Page,
} from './test'

/**
 * The breadcrumb says how far in the reader is — Workspace › Domain — and the Schema | Data
 * switch beside it says whether the Domain's Schema or one of its datasets is read. Data opens
 * the dataset last read on the Domain, else its one readable dataset, else its Datasets page; the
 * open dataset's label leads back to that page. The selection is the thread: it survives every
 * level change, so a Class selected on the Schema is still selected when the reader comes back,
 * and a dataset opened meanwhile opens on that Class's Nodes.
 */

const crumbs = (page: Page) => page.getByTestId('level-breadcrumb')
const levelSwitch = (page: Page) => page.getByTestId('level-switch')
const dataLevel = (page: Page) => page.getByTestId('data-level')
const datasetsPage = (page: Page) => page.getByTestId('datasets-page')

const SUPPORT_DESK = './tests/datasets/support-desk.ts'
const BROKEN = './tests/datasets/broken.ts'

test('Workspace opens the Workspace level, and a Domain card leads back to its Schema', async ({
  page,
}) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  await lensButton(page, 'behavior').click()

  await page.getByTestId('level-workspace').click()
  await expect(page.getByTestId('workspace-level')).toBeVisible()
  await expect(page.getByTestId('schema-level')).toHaveCount(0)
  await expect(page.getByTestId('level-workspace')).toHaveAttribute('aria-current', 'page')
  // the Workspace has one view: no lens to switch, no Domain crumb, no Schema | Data switch
  await expect(page.getByTestId('lens-switch')).toHaveCount(0)
  await expect(levelSwitch(page)).toHaveCount(0)

  const card = sceneBox(page, `domain:${FIXTURE_ID}`)
  await expect(card).toContainText('Crm')
  await card.click()
  const domainPage = page.locator('[data-workspace-page="domain"]')
  await expect(domainPage).toHaveAttribute('data-domain-name', 'Crm')
  await domainPage.locator('[data-action="open-schema"]').click()

  // back on the Schema, through the lens it was left in
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible()
})

test('a round trip through the Workspace level keeps the selection', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  await page.getByTestId('level-workspace').click()
  await sceneBox(page, `domain:${FIXTURE_ID}`).click()
  await page.locator('[data-workspace-page="domain"] [data-action="open-schema"]').click()
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page).getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
})

test('Data opens the one dataset the Domain can read, and Schema returns with the selection kept', async ({
  page,
}) => {
  await openSchema(page)
  // the breadcrumb names the Workspace and the Domain, and nothing else
  await expect(crumbs(page).locator('[data-testid^="level-"]')).toHaveCount(2)
  await expect(levelSwitch(page)).toHaveAttribute('data-level', 'schema')
  await expect(levelButton(page, 'schema')).toHaveAttribute('aria-pressed', 'true')
  await expect(levelButton(page, 'data')).toHaveAttribute('aria-pressed', 'false')
  await sceneBox(page, 'class.Ticket').click()
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')

  // the fixture references Support desk and one it cannot read: Support desk opens
  await levelButton(page, 'data').click()
  await expect(dataLevel(page)).toHaveAttribute('data-state', 'ready')
  await expect(dataLevel(page)).toHaveAttribute('data-dataset', 'support-desk')
  await expect(page).toHaveURL(/\/data\?dataset=\.%2Ftests%2Fdatasets%2Fsupport-desk\.ts/)
  await expect(levelSwitch(page)).toHaveAttribute('data-level', 'data')
  await expect(levelButton(page, 'data')).toHaveAttribute('aria-pressed', 'true')
  await expect(datasetLabel(page)).toHaveText('Support desk')
  await expect(page.getByTestId('schema-level')).toHaveCount(0)

  // it opens on the Tickets: the selection carried over from the Schema
  await expect(indexRow(page, 'class.Ticket')).toHaveAttribute('aria-selected', 'true')
  const panel = page.locator('[data-data-panel]')
  await expect(panel).toContainText('Ticket')
  await expect(panel).toContainText('2 in this dataset.')

  await levelButton(page, 'schema').click()
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(levelSwitch(page)).toHaveAttribute('data-level', 'schema')
  await expect(datasetLabel(page)).toHaveCount(0)
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page).getByRole('heading', { name: 'Ticket', exact: true })).toBeVisible()

  // the same two moves from the keyboard, and from the palette
  await page.keyboard.press('d')
  await expect(dataLevel(page)).toHaveAttribute('data-dataset', 'support-desk')
  await page.keyboard.press('s')
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByPlaceholder('Search the schema…').fill('data level')
  await page.getByRole('option', { name: /^Data level · D/ }).click()
  await expect(dataLevel(page)).toHaveAttribute('data-dataset', 'support-desk')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByPlaceholder('Search the schema…').fill('schema level')
  await page.getByRole('option', { name: /^Schema level · S/ }).click()
  await expect(page.getByTestId('schema-level')).toBeVisible()
})

test('the label leads to the Datasets page, and Data reopens the dataset last read, across a reload', async ({
  page,
}) => {
  const domain = `/domain/${encodeURIComponent(FIXTURE_ID)}`
  await page.goto(`${domain}/data?dataset=${encodeURIComponent(SUPPORT_DESK)}`)
  await expect(dataLevel(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })

  await datasetLabel(page).click()
  await expect(datasetsPage(page)).toHaveAttribute('data-state', 'some')
  await expect(page).toHaveURL(/\/data(\?lens=structure)?$/)
  await expect(datasetCard(page, SUPPORT_DESK)).toBeVisible()
  await expect(datasetCard(page, BROKEN)).toHaveAttribute('data-standing', 'unreadable')
  // the page is a place of its own: Back and Forward cross it
  await page.goBack()
  await expect(dataLevel(page)).toHaveAttribute('data-dataset', 'support-desk')
  await page.goForward()
  await expect(datasetsPage(page)).toBeVisible()

  // a dataset that cannot be read is the reader's choice too, and its level says why
  await openDatasetCard(page, BROKEN)
  await expect(dataLevel(page)).toHaveAttribute('data-state', 'failed')
  await expect(datasetLabel(page)).toHaveText('broken')
  await levelButton(page, 'schema').click()
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await levelButton(page, 'data').click()
  await expect(dataLevel(page)).toHaveAttribute('data-state', 'failed')
  await expect(dataLevel(page)).toHaveAttribute('data-dataset-path', BROKEN)

  // kept in the browser: a reload, then Data, opens it again
  await datasetLabel(page).click()
  await openDatasetCard(page, SUPPORT_DESK)
  await expect(dataLevel(page)).toHaveAttribute('data-state', 'ready')
  await page.goto(domain)
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await levelButton(page, 'data').click()
  await expect(dataLevel(page)).toHaveAttribute('data-dataset', 'support-desk')
})

test('the Domain crumb switches Domain, and Data reads only what that one declares', async ({
  page,
}) => {
  await openSchema(page)
  const domainCrumb = page.getByTestId('level-domain')
  await expect(domainCrumb).toContainText('crm.studio-demo.astrale.ai')
  await domainCrumb.click()
  await page.getByRole('menuitemradio', { name: 'ops.studio-demo.astrale.ai' }).click()
  await expect(domainCrumb).toContainText('ops.studio-demo.astrale.ai')
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(sceneBox(page, 'class.Invoice')).toHaveCount(0)

  await levelButton(page, 'data').click()
  await expect(datasetsPage(page)).toHaveAttribute('data-state', 'none')
  await expect(datasetCard(page, SUPPORT_DESK)).toHaveCount(0)
  await levelButton(page, 'schema').click()

  await domainCrumb.click()
  await page.getByRole('menuitemradio', { name: 'crm.studio-demo.astrale.ai' }).click()
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible({ timeout: 60_000 })
  await expect(crumbs(page)).toContainText('crm.studio-demo.astrale.ai')
})

/** Counts the turns submitted to the agent from now on: a prepared request is never one. */
function submissions(page: Page): () => number {
  let submitted = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/agent/submit')) submitted += 1
  })
  return () => submitted
}

/** Asks for a Dataset through `ask`, and reads the unsent request the agent's composer then holds. */
async function askForDataset(page: Page, ask: () => Promise<void>): Promise<string> {
  const opened = chatAction(page, 'open')
  await ask()
  const chat = (await (await opened).json()) as { id: string }
  const composer = page.locator('[data-agent-composer]')
  await expect(composer).toHaveValue(
    /^Write a demo Dataset for the ops\.studio-demo\.astrale\.ai Domain/,
  )
  const request = await composer.inputValue()
  await page.request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  return request
}

test('a Domain with no Dataset says so on the Data segment, and its Datasets page shows the code and asks', async ({
  page,
}) => {
  const submitted = submissions(page)
  await page.goto(`/domain/${PEER_ID}`)
  await expect(page.getByTestId('schema-level')).toBeVisible()

  // the Data segment says it, quietly: a glyph and its title, before anything opens
  const data = levelButton(page, 'data')
  await expect(data).toHaveAttribute('data-hint', 'ask-dataset')
  await expect(
    data.locator('svg[aria-label="No Dataset referenced: the agent can be asked to write one"]'),
  ).toBeVisible()
  await data.hover()
  await expect(page.getByRole('tooltip')).toContainText(
    'No Dataset referenced: the agent can be asked to write one',
  )

  await data.click()
  await expect(levelSwitch(page)).toHaveAttribute('data-level', 'data')
  await expect(page).toHaveURL(/\/data(\?lens=structure)?$/)
  const datasets = datasetsPage(page)
  await expect(datasets).toHaveAttribute('data-state', 'none')
  const empty = datasets.locator('[data-no-dataset="page"]')
  await expect(empty).toContainText(
    'A Dataset is a small graph of Nodes and Edges, written in code, that the Data level draws and the Rules lens decides on.',
  )
  await expect(empty).toContainText('export default defineDataset(schema, { id, title, graph })')
  await expect(empty).toContainText(
    "tests: tests({ datasets: [dataset('./tests/datasets/<name>.ts')] })",
  )
  const request = await askForDataset(page, () =>
    empty.getByRole('button', { name: 'Ask the agent to write one' }).click(),
  )
  expect(request).toContain("tests: tests({ datasets: [dataset('./tests/datasets/<name>.ts')] })")
  // the request is prepared beside the page, which stays where it was
  await expect(datasets).toHaveAttribute('data-state', 'none')
  expect(submitted()).toBe(0)
})
