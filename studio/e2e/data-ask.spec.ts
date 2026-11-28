import {
  clearScenarios,
  datasetLabel,
  drawnBoxes,
  expect,
  fixtureBundle,
  indexRail,
  indexRow,
  openSupportDesk,
  sceneBox,
  sceneCanvas,
  storedScenarios,
  test,
  type Page,
} from './test'

/**
 * Through Structure the Data level asks a dataset, never draws it whole. At rest the map is the
 * dataset measured against its Schema: each Class with its Node count, each relationship with its
 * Edge count. The Index lists the Domain's Queries under the Class each starts from; picking one
 * asks it, and the map is the slice it reaches from the Nodes its slots hold, as whoever asks may
 * read it. The bar over the map says the dataset, its size, who asks and the question; the panel
 * reads the answer. Through Behavior the Index also lists the Domain's functions; one picked is
 * asked as a call on a Node of the dataset, by one of its identities or anyone: the bar says the
 * verdict the Kernel would give and what the function is declared to write, and the call is kept
 * as a Scenario step.
 *
 * The fixture declares three Queries: `ticketsAboutAccount` takes a Company and an optional status
 * and reads each Ticket about it with that Company and who raised it; `ticketPage` takes one
 * Ticket; `companies` takes nothing. In `support-desk`, Ann raised `printer`, which is about Acme,
 * and Bob raised `login`, which is about no account; the Ticket read Policy admits only who raised
 * a ticket. `Invoice.settle` admits only the Company an invoice is billed to, and the dataset's
 * identities are people; `Invoice.remind` admits every caller.
 */

const level = (page: Page) => page.getByTestId('data-level')
const bar = (page: Page) => page.getByTestId('question-bar')
const barTitle = (page: Page) => bar(page).locator('[data-ask-title]')
const slot = (page: Page, id: string) => page.locator(`[data-ask-slot="${id}"]`)
const summary = (page: Page) => page.locator('[data-ask-summary]')
const measurePage = (page: Page) => page.locator('[data-ask-page="measure"]')
const answerPage = (page: Page) => page.locator('[data-ask-page="answer"]')
/** The popover a chip of the bar opens. */
const chipMenu = (page: Page) => page.getByRole('dialog')
const factor = (page: Page, times: number) => page.locator(`[data-ask-factor="${times}"]`)

/** The Node cards on the map, by path, in any order. */
const drawnNodes = async (page: Page) =>
  (await drawnBoxes(page))
    .filter((id) => id.startsWith('core.node.'))
    .map((id) => id.slice('core.node.'.length))
    .sort()

/** Open Support desk measured, and ask it one of the fixture's Queries from the Index. */
async function ask(page: Page, query: string) {
  await openSupportDesk(page)
  await indexRow(page, `query.${query}`).click()
  await expect(level(page)).toHaveAttribute('data-ask', query)
}

/** Read the question as another identity, or as the Domain itself. */
async function readAs(page: Page, name: RegExp) {
  await page.locator('[data-ask-as]').click()
  await chipMenu(page).getByRole('option', { name }).click()
}

test("the Domain's Queries reach the Studio with what they read and what they take", async ({
  request,
}) => {
  const { overlay } = await fixtureBundle(request)
  const queries = new Map(
    overlay.definitions.filter((one) => one.kind === 'query').map((one) => [one.id, one]),
  )
  expect([...queries.keys()].sort()).toEqual([
    'crm.company.all',
    'crm.ticket.about-account',
    'crm.ticket.page',
  ])
  const reads = (id: string) =>
    queries.get(id)!.effects?.map((effect) => `${effect.kind} ${effect.role} ${effect.class}`)

  expect(reads('crm.ticket.about-account')).toEqual([
    'read root Ticket',
    'read traverse AboutAccount',
    'read traverse Company',
    'read traverse RaisedBy',
    'read traverse Person',
  ])
  expect(queries.get('crm.ticket.about-account')!.input).toMatchObject({
    form: 'fields',
    fields: [
      {
        name: 'account',
        kind: 'node',
        optional: false,
        uses: [{ kind: 'node', class: 'Company' }],
      },
      {
        name: 'status',
        kind: 'value',
        optional: true,
        uses: [{ kind: 'property', class: 'Ticket', property: 'status' }],
      },
    ],
  })

  expect(reads('crm.ticket.page')).toEqual([
    'read root Ticket',
    'read traverse RaisedBy',
    'read traverse Person',
    'read traverse AboutAccount',
    'read traverse Company',
    'read traverse MessageOn',
    'read traverse Message',
  ])
  expect(queries.get('crm.ticket.page')!.input).toMatchObject({
    form: 'value',
    fields: [{ name: 'ticket', kind: 'node', optional: false }],
  })

  expect(reads('crm.company.all')).toEqual(['read root Company'])
  expect(queries.get('crm.company.all')!.input).toEqual({ form: 'none', fields: [] })
})

test('at rest, the dataset is measured against its Schema, Class by Class', async ({ page }) => {
  await openSupportDesk(page)
  await expect(level(page)).toHaveAttribute('data-lens', 'structure')
  await expect(level(page)).toHaveAttribute('data-ask', 'measure')
  await expect(datasetLabel(page)).toHaveText('Support desk')
  await expect(bar(page)).toContainText('6 Nodes · 6 Edges')
  await expect(barTitle(page)).toHaveText('Measured against its Schema')
  await expect(indexRow(page, 'ask.measure')).toHaveAttribute('aria-selected', 'true')
  // the Index lists each Query under the Class it starts from
  await expect(indexRow(page, 'ask.queries.Ticket')).toContainText('Ticket · queries')
  await expect(indexRow(page, 'query.crm.ticket.about-account')).toHaveText('Tickets about account')
  await expect(indexRow(page, 'query.crm.ticket.page')).toHaveText('Ticket page')
  await expect(indexRow(page, 'ask.queries.Company')).toContainText('Company · queries')
  await expect(indexRow(page, 'query.crm.company.all')).toHaveText('Companies')

  // the map is the Schema, each Class counting its Nodes; no Node is drawn
  for (const cls of ['Ticket', 'Person'])
    await expect(sceneBox(page, `class.${cls}`).locator('.scene-box-count')).toHaveAttribute(
      'title',
      '2 Nodes',
    )
  await expect(sceneBox(page, 'class.Message')).toHaveAttribute('data-absent', 'true')
  await expect(sceneBox(page, 'class.Ticket')).not.toHaveAttribute('data-absent')
  await expect(sceneCanvas(page).locator('.scene-box[data-box-id^="core.node."]')).toHaveCount(0)

  // the panel measures it whole: what it holds, Class by Class and relationship by relationship
  const measure = measurePage(page)
  await expect(measure).toContainText('Dataset · measured')
  await expect(measure).toContainText('6 Nodes, 6 Edges, 4 Classes')
  await expect(measure.locator('tr', { hasText: 'Ticket' })).toContainText('2')
  await expect(measure).toContainText('WorksAt 2 Edges')
  // a relationship selected says its Edge count on the map
  await measure.getByRole('button', { name: 'WorksAt', exact: true }).click()
  await expect(
    sceneCanvas(page).locator('.scene-label[data-selected]', { hasText: 'WorksAt' }),
  ).toHaveText('WorksAt · 2')
})

test('a Query picked in the Index is asked: its slots filled, its slice drawn, its answer read', async ({
  page,
}) => {
  await ask(page, 'crm.ticket.about-account')
  await expect(indexRow(page, 'query.crm.ticket.about-account')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(barTitle(page)).toHaveText('Tickets about account')

  // the required slot is filled for the reader, and says it was picked; the optional one is free
  const account = slot(page, 'account')
  await expect(account).toHaveAttribute('data-held', '')
  await expect(account).toContainText('acme')
  await expect(account.getByLabel('picked by the Studio')).toBeVisible()
  await expect(slot(page, 'status')).not.toHaveAttribute('data-held')
  await expect(slot(page, 'status')).toContainText('any')
  await account.click()
  await expect(chipMenu(page)).toContainText('The Company the tickets are about.')
  await expect(chipMenu(page)).toContainText(
    'Picked for you: acme, the fullest answer: 3 Nodes of 3 kinds.',
  )
  await page.keyboard.press('Escape')
  await expect(chipMenu(page)).toHaveCount(0)

  // the map is the slice it reaches: the ticket about Acme, Acme and who raised it
  await expect.poll(() => drawnNodes(page)).toEqual(['acme', 'ann', 'printer'])
  await expect(summary(page)).toHaveText('1 Ticket · 1 Company · 1 Person')
  await expect(page.locator('[data-ask-approximate]')).toHaveText('approximate')

  // the panel reads the answer row by row, and what the Studio leaves out of the Query
  const answer = answerPage(page).locator('[data-ask-answer="1"]')
  for (const node of ['printer', 'acme', 'ann']) await expect(answer).toContainText(node)
  await expect(answerPage(page)).toContainText('picked for you: acme')
  await expect(answerPage(page)).toContainText('filters, order and bounds are not applied')
})

test('a slot changed through its chip asks again: another Node, a value the dataset holds, any', async ({
  page,
}) => {
  await ask(page, 'crm.ticket.page')
  await expect(slot(page, 'ticket')).toContainText('printer')
  await expect.poll(() => drawnNodes(page)).toEqual(['acme', 'ann', 'printer'])

  // each Node it can take says what asking with it gives
  await slot(page, 'ticket').click()
  const printer = chipMenu(page).getByRole('option', { name: /^printer/ })
  await expect(printer).toHaveAttribute('aria-selected', 'true')
  await expect(printer).toContainText('1 row · 3 Nodes')
  const login = chipMenu(page).getByRole('option', { name: /^login/ })
  await expect(login).toContainText('1 row · 2 Nodes')
  await login.click()
  // the reader's choice is no pick
  await expect(slot(page, 'ticket')).toContainText('login')
  await expect(slot(page, 'ticket').getByLabel('picked by the Studio')).toHaveCount(0)
  await expect.poll(() => drawnNodes(page)).toEqual(['bob', 'login'])
  await expect(summary(page)).toHaveText('1 Ticket · 1 Person')

  // a value slot offers the values the dataset holds, and takes another one typed
  await indexRow(page, 'query.crm.ticket.about-account').click()
  const status = slot(page, 'status')
  await status.click()
  const open = chipMenu(page).getByRole('option', { name: /^open/ })
  await expect(open).toContainText('2 Nodes')
  await open.click()
  await expect(status).toContainText('open')
  await expect(summary(page)).toHaveText('1 Ticket · 1 Company · 1 Person')
  await status.click()
  await chipMenu(page).getByPlaceholder('Another value').fill('closed')
  await chipMenu(page).getByRole('button', { name: 'Set' }).click()
  await expect(status).toContainText('closed')
  await expect(summary(page)).toHaveText('Nothing matches')
  await expect.poll(() => drawnNodes(page)).toEqual([])

  // freed, the optional slot narrows the tickets no more
  await status.click()
  await chipMenu(page).getByRole('option', { name: 'Any: free this slot' }).click()
  await expect(status).toContainText('any')
  await expect(summary(page)).toHaveText('1 Ticket · 1 Company · 1 Person')
  await expect.poll(() => drawnNodes(page)).toEqual(['acme', 'ann', 'printer'])
})

test('read as Ann, what the Ticket read Policy refuses her is left out and counted', async ({
  page,
}) => {
  await ask(page, 'crm.ticket.page')
  await slot(page, 'ticket').click()
  await chipMenu(page)
    .getByRole('option', { name: /^login/ })
    .click()
  await expect.poll(() => drawnNodes(page)).toEqual(['bob', 'login'])

  // Bob's ticket is not Ann's to read: the slice leaves it out, and says so
  await readAs(page, /^ann/)
  await expect(page.locator('[data-ask-as]')).toHaveAttribute('data-ask-as', 'ann')
  await expect(summary(page)).toHaveText('Nothing matches · 1 withheld from ann')
  await expect.poll(() => drawnNodes(page)).toEqual([])
  await expect(answerPage(page)).toContainText('1 Node is reached and withheld from ann.')
  // nor is it hers to pick: the ticket she may read is the one offered
  await slot(page, 'ticket').click()
  await expect(chipMenu(page).getByRole('option')).toHaveText([/^printer/])
  await page.keyboard.press('Escape')

  // read as the Domain, it is there again
  await readAs(page, /^the Domain/)
  await expect(page.locator('[data-ask-as]')).toHaveAttribute('data-ask-as', '')
  await expect(summary(page)).toHaveText('1 Ticket · 1 Person')
  await expect.poll(() => drawnNodes(page)).toEqual(['bob', 'login'])
})

test('a Class selected on the measure lists the Queries that start from it; one taking nothing has no slot', async ({
  page,
}) => {
  await openSupportDesk(page)
  await sceneBox(page, 'class.Ticket').click()
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
  const measure = measurePage(page)
  await expect(measure).toContainText('Class · measured')
  await expect(measure).toContainText('2 Nodes in this dataset')
  await expect(measure).toContainText('Queries that start from it')
  await expect(measure.getByRole('button', { name: 'Tickets about account' })).toBeVisible()
  await measure.getByRole('button', { name: 'Ticket page', exact: true }).click()
  await expect(level(page)).toHaveAttribute('data-ask', 'crm.ticket.page')
  await expect(barTitle(page)).toHaveText('Ticket page')

  // a Query that takes nothing is asked as it is
  await indexRow(page, 'query.crm.company.all').click()
  await expect(barTitle(page)).toHaveText('Companies')
  await expect(page.locator('[data-ask-slot]')).toHaveCount(0)
  await expect(answerPage(page)).toContainText('The Query takes nothing.')
  await expect(summary(page)).toHaveText('1 Company')
  await expect.poll(() => drawnNodes(page)).toEqual(['acme'])
})

test('read at ×20 the dataset is laid down again, faked, and the open Query is asked again', async ({
  page,
}) => {
  await ask(page, 'crm.company.all')
  await expect(factor(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(summary(page)).toHaveText('1 Company')

  await factor(page, 20).click()
  await expect(factor(page, 20)).toHaveAttribute('aria-pressed', 'true')
  // its identities are shared by every copy; every other Node and Edge is laid down 20 times
  await expect(bar(page)).toContainText('82 Nodes · 120 Edges')
  await expect(bar(page).getByText('faked', { exact: true })).toBeVisible()
  await expect(level(page)).toHaveAttribute('data-ask', 'crm.company.all')
  await expect(summary(page)).toHaveText('20 Companies')
  await expect(answerPage(page).locator('[data-ask-answer="20"]')).toBeVisible()

  await factor(page, 1).click()
  await expect(bar(page)).toContainText('6 Nodes · 6 Edges')
  await expect(bar(page).getByText('faked', { exact: true })).toHaveCount(0)
  await expect(summary(page)).toHaveText('1 Company')
})

test('a Node of the slice selected reads its page; Esc backs out of it, then out of the Query', async ({
  page,
}) => {
  await ask(page, 'crm.ticket.about-account')
  await sceneBox(page, 'core.node.printer').click()
  await expect(sceneBox(page, 'core.node.printer')).toHaveAttribute('data-selected', 'true')
  const node = page.locator('[data-data-panel]')
  await expect(node).toContainText('Node · Ticket')
  await expect(node).toContainText('Printer jams')

  await page.keyboard.press('Escape')
  await expect(sceneBox(page, 'core.node.printer')).not.toHaveAttribute('data-selected')
  await expect(answerPage(page)).toBeVisible()
  await expect(level(page)).toHaveAttribute('data-ask', 'crm.ticket.about-account')

  await page.keyboard.press('Escape')
  await expect(level(page)).toHaveAttribute('data-ask', 'measure')
  await expect(measurePage(page)).toBeVisible()
  await expect(barTitle(page)).toHaveText('Measured against its Schema')
})

test('Rules and Behavior read the same dataset under the same bar, at the same size', async ({
  page,
}) => {
  await openSupportDesk(page)
  await page.keyboard.press('3')
  await expect(level(page)).toHaveAttribute('data-lens', 'rules')
  await expect(datasetLabel(page)).toHaveText('Support desk')
  await expect(barTitle(page)).toHaveText('What anyone may read')
  await expect(bar(page)).toContainText('4 of 6 Nodes')

  await page.keyboard.press('2')
  await expect(level(page)).toHaveAttribute('data-lens', 'behavior')
  await expect(barTitle(page)).toHaveText('What a call does')
  await expect(bar(page)).toContainText('open a Scenario in the panel')

  // the size the dataset is read at is the reader's, through every lens
  await factor(page, 20).click()
  await expect(bar(page)).toContainText('82 Nodes · 120 Edges')
  await page.keyboard.press('1')
  await expect(level(page)).toHaveAttribute('data-ask', 'measure')
  await expect(factor(page, 20)).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page)).toContainText('82 Nodes · 120 Edges')
})

test.describe('a call asked through Behavior', () => {
  test.beforeEach(async ({ request }) => clearScenarios(request))
  test.afterEach(async ({ request }) => clearScenarios(request))

  test('a function picked is asked on a Node with its verdict, and kept as a Scenario step', async ({
    page,
    request,
  }) => {
    await openSupportDesk(page)
    await page.keyboard.press('2')
    await expect(level(page)).toHaveAttribute('data-lens', 'behavior')
    await indexRow(page, 'function.Invoice.settle').click()
    await expect(level(page)).toHaveAttribute('data-ask-call', 'Invoice.settle')
    await expect(barTitle(page)).toHaveText('Invoice.settle')

    // it is asked on the dataset's one Invoice, picked for the reader, by anyone
    const on = slot(page, 'on')
    await expect(on).toContainText('invoice-1')
    await expect(on.getByLabel('picked by the Studio')).toBeVisible()
    await expect(page.locator('[data-ask-as]')).toHaveAttribute('data-ask-as', '')
    const verdict = page.locator('[data-ask-verdict]')
    const reason = page.locator('[data-ask-verdict-section]')
    await expect(verdict).toHaveAttribute('data-ask-verdict', 'refused')
    await expect(reason).toContainText('Anyone may not call Invoice.settle on invoice-1.')
    await expect(reason).toContainText('It fails on ‘you are its customer’.')
    // what it would write is declared, never applied: the Payment it creates stands absent
    await expect(summary(page)).toHaveText('declared: creates, updates, links · not applied')
    await expect(sceneBox(page, 'absent.class.Payment')).toBeVisible()
    await expect.poll(() => drawnNodes(page)).toEqual(['invoice-1'])

    // called by Ann, it is still refused: she is not the account the invoice is billed to
    await readAs(page, /^ann/)
    await expect(page.locator('[data-ask-as]')).toHaveAttribute('data-ask-as', 'ann')
    await expect(reason).toContainText('ann may not call Invoice.settle on invoice-1.')
    await expect(verdict).toHaveAttribute('data-ask-verdict', 'refused')
    await expect.poll(() => drawnNodes(page)).toEqual(['ann', 'invoice-1'])
    // a function every caller may call is allowed her
    await indexRow(page, 'function.Invoice.remind').click()
    await expect(verdict).toHaveAttribute('data-ask-verdict', 'allowed')
    await expect(reason).toContainText('ann may call Invoice.remind on invoice-1.')
    await expect(summary(page)).toHaveText('declared to write nothing')

    // kept, the call is a step of the dataset's Scenario that expects the verdict it has
    await indexRow(page, 'function.Invoice.settle').click()
    await expect(verdict).toHaveAttribute('data-ask-verdict', 'refused')
    await page.locator('[data-ask-keep]').click()
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'Kept as a step of Calls on Support desk' }),
    ).toBeVisible()
    await expect
      .poll(async () => (await storedScenarios(request)).map((scenario) => scenario.steps))
      .toMatchObject([
        [
          {
            as: 'ann',
            does: 'call',
            fn: 'Invoice.settle',
            on: { node: 'invoice-1' },
            expect: 'refused',
          },
        ],
      ])

    // closed, the call gives the Scenarios back, and the step reads there as expected
    await bar(page).getByRole('button', { name: 'Close the call' }).click()
    await expect(level(page)).not.toHaveAttribute('data-ask-call')
    await indexRail(page).locator('[data-index-row^="scenario."]').click()
    const step = page.locator('[data-data-panel] [data-scenario-steps] [data-step]')
    await expect(step).toHaveCount(1)
    await expect(step).toHaveAttribute('data-standing', 'expected')
    await expect(step).toContainText('ann calls Invoice.settle on invoice-1')
  })
})
