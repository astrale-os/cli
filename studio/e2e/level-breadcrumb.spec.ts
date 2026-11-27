import {
  chatAction,
  expect,
  FIXTURE_ID,
  indexRow,
  inspector,
  lensButton,
  openSchema,
  PEER_ID,
  sceneBox,
  test,
  type Page,
} from './test'

/**
 * The breadcrumb says how far in the reader is — Workspace › Domain › dataset — and each
 * crumb moves between levels. The selection is the thread: it survives every level change,
 * so a Class selected on the Schema is still selected when the reader comes back, and a
 * dataset opened meanwhile opens on that Class's Nodes.
 */

const crumbs = (page: Page) => page.getByTestId('level-breadcrumb')

async function openDataset(page: Page, title: string) {
  await page.getByTestId('level-dataset').click()
  await page.getByRole('menuitemradio', { name: title }).click()
}

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
  // the Workspace has one view: no lens to switch, no Domain or dataset crumb
  await expect(page.getByTestId('lens-switch')).toHaveCount(0)
  await expect(page.getByTestId('level-dataset')).toHaveCount(0)

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

test('the dataset crumb opens the Data level, and Schema only returns with the selection kept', async ({
  page,
}) => {
  await openSchema(page)
  await sceneBox(page, 'class.Ticket').click()
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')

  await openDataset(page, 'Support desk')
  const level = page.getByTestId('data-level')
  await expect(level).toHaveAttribute('data-state', 'ready')
  await expect(level).toHaveAttribute('data-dataset', 'support-desk')
  await expect(page.getByTestId('level-dataset')).toHaveText('Support desk')
  await expect(page.getByTestId('schema-level')).toHaveCount(0)

  // it opens on the Tickets: the selection carried over from the Schema
  await expect(indexRow(page, 'class.Ticket')).toHaveAttribute('aria-selected', 'true')
  const panel = page.locator('[data-data-panel]')
  await expect(panel).toContainText('Ticket')
  await expect(panel).toContainText('2 in this dataset.')

  await page.getByTestId('level-dataset').click()
  await page.getByRole('menuitemradio', { name: 'Schema only' }).click()
  await expect(page.getByTestId('schema-level')).toBeVisible()
  // none open: the crumb counts the ones there are
  await expect(page.getByTestId('level-dataset')).toHaveText(/^\d+ datasets?$/)
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page).getByRole('heading', { name: 'Ticket', exact: true })).toBeVisible()
})

test('the Domain crumb switches Domain, and the dataset crumb lists only what this one declares', async ({
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

  await page.getByTestId('level-dataset').click()
  await expect(page.getByRole('menuitemradio', { name: 'Support desk' })).toHaveCount(0)
  await expect(page.getByText('No Dataset referenced')).toBeVisible()
  await page.keyboard.press('Escape')

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

test('a Domain with no Dataset says so on the crumb, and its menu prepares an unsent request', async ({
  page,
}) => {
  const submitted = submissions(page)
  await page.goto(`/domain/${PEER_ID}`)
  await expect(page.getByTestId('schema-level')).toBeVisible()

  // the crumb itself says it, quietly: a glyph and its title, before the menu opens
  const crumb = page.getByTestId('level-dataset')
  await expect(crumb).toHaveAttribute('data-hint', 'ask-dataset')
  await expect(crumb).toHaveAttribute(
    'title',
    'No Dataset referenced: the agent can be asked to write one',
  )
  await expect(crumb).toHaveText('No dataset')

  await crumb.click()
  const notice = page.locator('[data-no-dataset="note"]')
  await expect(notice).toContainText(
    'A Dataset is a small graph of Nodes and Edges, written in code, that the Data level draws and the Rules lens decides on.',
  )
  await expect(notice).toContainText(
    'It is a module defined with defineDataset from @astrale-os/sdk/testing, listed in astrale.config.ts.',
  )
  const request = await askForDataset(page, () =>
    notice.getByRole('button', { name: 'Ask the agent to write one' }).click(),
  )
  await expect(notice).toHaveCount(0)
  expect(request).toContain("tests: tests({ datasets: [dataset('./tests/datasets/<name>.ts')] })")
  expect(submitted()).toBe(0)
})

test('the menu of a Domain with no Dataset leads to its Datasets page, which shows the code and asks too', async ({
  page,
}) => {
  const submitted = submissions(page)
  await page.goto(`/domain/${PEER_ID}`)
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await page.getByTestId('level-dataset').click()
  await page.locator('[data-action="dataset-declaration"]').click()

  const datasets = page.getByTestId('datasets-page')
  await expect(datasets).toHaveAttribute('data-state', 'none')
  await expect(page.getByTestId('level-dataset')).toHaveText('All datasets')
  const empty = datasets.locator('[data-no-dataset="page"]')
  await expect(empty).toContainText('export default defineDataset(schema, { id, title, graph })')
  await expect(empty).toContainText(
    "tests: tests({ datasets: [dataset('./tests/datasets/<name>.ts')] })",
  )
  await askForDataset(page, () =>
    empty.getByRole('button', { name: 'Ask the agent to write one' }).click(),
  )
  // the request is prepared beside the page, which stays where it was
  await expect(datasets).toHaveAttribute('data-state', 'none')
  expect(submitted()).toBe(0)
})
