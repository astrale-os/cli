import {
  expect,
  indexRow,
  inspector,
  lensButton,
  openSchema,
  sceneBox,
  sceneCanvas,
  test,
  type Page,
} from './test'

/**
 * Behavior answers "what can happen": the outside world it reaches, the functions that run,
 * and the graph they change, as three bands. At rest every Class a function changes carries
 * its verb tallies, and one ribbon runs from each module to each thing its functions reach.
 * Selecting a function opens its module: its mutations, and what each changes, light up.
 *
 * The fixture declares the source this lens reads: `actions/invoice.ts` (two handlers),
 * `mutations/invoice.ts` (their effects) and `integrations/ledger.ts` (one operation).
 */

/** One drawn line, by the mark it draws (`uses:…`, `call:…`, `change:…`). */
const linkMark = (page: Page, mark: string) =>
  sceneCanvas(page).locator(`g.scene-link[data-link-mark="${mark}"]`)

/** What each ribbon on screen says, by its accessible title. */
const ribbonTitles = (page: Page) =>
  sceneCanvas(page)
    .locator('g.scene-ribbon:not([data-hidden]) > title')
    .evaluateAll((titles) => titles.map((title) => title.textContent ?? ''))

test('switching lens keeps the selection; Behavior draws its bands, tallies and ribbons', async ({
  page,
}) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')

  await lensButton(page, 'behavior').click()
  await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')
  // the same Invoice, selected on the new scene and read in the Inspector
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page)).toHaveAttribute('data-inspector-lens', 'behavior')
  await expect(inspector(page).getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()

  const bands = sceneCanvas(page).locator('.scene-band')
  await expect(bands).toHaveCount(3)
  await expect(bands.nth(0)).toHaveText(/outside world/i)
  await expect(bands.nth(1)).toHaveText(/functions/i)
  await expect(bands.nth(2)).toHaveText(/^graph$/i)

  // the keyboard reaches the same lenses, and the selection rides along both ways
  await page.keyboard.press('1')
  await expect(lensButton(page, 'structure')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('2')
  await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')

  // unselect, so the scene shows its resting state
  await page.keyboard.press('Escape')
  await expect(sceneBox(page, 'class.Invoice')).not.toHaveAttribute('data-selected', 'true')

  // each changed Class says by what, counted
  await expect(
    sceneBox(page, 'class.Invoice').locator('.scene-box-tally[title="updated by 2"]'),
  ).toBeVisible()
  await expect(
    sceneBox(page, 'class.Payment').locator('.scene-box-tally[title="created by 1"]'),
  ).toBeVisible()
  await expect(sceneBox(page, 'integration.ledger')).toBeVisible()
  // the Classes nothing changes are counted, not drawn
  await expect(sceneBox(page, 'class.Team')).toHaveCount(0)
  await expect(page.getByTestId('scene-folded')).toContainText('Unchanged Classes')

  // at rest: one ribbon per module and target, nothing drawn twice; the Edge a mutation writes
  // between a Payment it creates and an Invoice it does not is the Invoice's to draw
  await expect
    .poll(() => ribbonTitles(page))
    .toEqual(
      expect.arrayContaining([
        'billing → Invoice · updates 1 · links 1',
        'billing → Payment · creates 1',
        'billing → ledger · may repeat 1',
        'schema → Invoice · updates 1',
      ]),
    )
  const pairs = (await ribbonTitles(page)).map((title) => title.split(' · ')[0])
  expect(new Set(pairs).size).toBe(pairs.length)
})

test('selecting a function opens what it runs: its mutation and what that changes', async ({
  page,
}) => {
  await openSchema(page)
  await lensButton(page, 'behavior').click()
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)
  // the function's row in its module, by the width each of its texts takes
  const row = sceneCanvas(page).locator('.scene-box-row[data-select-id="function.Invoice.settle"]')
  const widths = () =>
    row
      .locator('.scene-box-row-label, .scene-box-row-detail')
      .evaluateAll((texts) => texts.map((text) => text.scrollWidth))
  const atRest = await widths()
  expect(atRest.length).toBeGreaterThan(0)

  await indexRow(page, 'function.Invoice.settle').click()
  await expect(indexRow(page, 'function.Invoice.settle')).toHaveAttribute('aria-selected', 'true')
  // selected, the row reads as it was measured: a highlight never widens its text
  await expect(row).toHaveAttribute('data-selected', 'true')
  expect(await widths()).toEqual(atRest)

  // the mutation it runs is drawn, and it, its Classes and the integration it calls are lit
  const mutation = sceneBox(page, 'mutation.crm.invoice.settle')
  await expect(mutation).toBeVisible()
  for (const id of [
    'mutation.crm.invoice.settle',
    'class.Invoice',
    'class.Payment',
    'integration.ledger',
  ])
    await expect(sceneBox(page, id)).toHaveAttribute('data-emphasis', 'lit')
  // the resting ribbons give way to each line they bundled, lit
  for (const mark of [
    'uses:function.Invoice.settle:mutation.crm.invoice.settle',
    'call:function.Invoice.settle:ledger',
    'change:mutation.crm.invoice.settle:create:class.Payment',
    'change:mutation.crm.invoice.settle:update:class.Invoice',
  ])
    await expect(linkMark(page, mark)).toHaveAttribute('data-emphasis', 'lit')
  await expect.poll(() => ribbonTitles(page)).not.toContain('billing → Payment · creates 1')

  // the Inspector reads the function: what it changes, as sentences, and what it reaches
  const changes = inspector(page).locator('[data-inspector-function-changes]')
  await expect(changes).toContainText('crm.invoice.settle')
  await expect(changes).toContainText('updates an Invoice')
  await expect(changes).toContainText('creates a Payment')
  await expect(changes).toContainText('links an Invoice to a Payment')
  await expect(inspector(page).locator('[data-inspector-reaches]')).toContainText('ledger')
  await expect(inspector(page)).toContainText('actions/invoice.ts:6')

  // a function is not Structure: that lens says so instead of drawing it
  await page.keyboard.press('1')
  await expect(inspector(page)).toContainText('A function adds nothing to what exists')
})

test('a Function with no receiver reads like a method: the Class it works on, its contract, what it changes', async ({
  page,
}) => {
  await openSchema(page)
  await page.keyboard.press('2')
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)

  // bound by the Node its input accepts: it works on an Invoice, and changes one
  await indexRow(page, 'function.reconcileInvoice').click()
  const read = inspector(page)
  await expect(read.getByRole('heading', { name: 'reconcileInvoice', exact: true })).toBeVisible()
  await expect(read).toContainText('Works on')
  await expect(read.locator('[data-inspector-link="class.Invoice"]').first()).toBeVisible()
  await expect(read.locator('[data-method-returns]')).toContainText('Yes / no')
  const changes = read.locator('[data-inspector-function-changes]')
  await expect(changes).toContainText('crm.invoice.reconcile')
  await expect(changes).toContainText('updates an Invoice')
  await expect(read).toContainText('any signed-in caller')
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-emphasis', 'lit')

  // one that names no Class hangs off nothing: no Class to work on, nothing lit but its module
  await indexRow(page, 'function.exportLedger').click()
  await expect(read.getByRole('heading', { name: 'exportLedger', exact: true })).toBeVisible()
  await expect(read).not.toContainText('Works on')
  await expect(read.locator('[data-method-returns]')).toContainText('Stream of text')
  await expect(read).toContainText('every caller')
  await expect(sceneBox(page, 'class.Invoice')).not.toHaveAttribute('data-emphasis', 'lit')
})
