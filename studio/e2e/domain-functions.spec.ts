import { FIXTURE_ID, expect, type Page, test } from './test'

/**
 * A standalone Function is a first-class schema member, read the way a view is.
 *
 * It has a node on the canvas, wired to each Class it works on; a Functions overview in
 * the right panel, grouped by those Classes; a place on the Class that is worked on; and
 * a way back from Process, where the callable is listed but not explained.
 */

const FUNCTION_NODE = '.react-flow__node-functionNode'

async function openSchema(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
}

test('every function is drawn on the canvas, tied to the classes it works on', async ({ page }) => {
  await openSchema(page)

  const nodes = page.locator(FUNCTION_NODE)
  await expect(nodes).toHaveCount(3)
  await expect(page.locator(`${FUNCTION_NODE}[data-id$="function.reconcileInvoice"]`)).toBeVisible()
  // the binding comes from the Node path its input accepts — a Function names no receiver
  const edge = page.locator(
    `.react-flow__edge[data-id="workspace:${FIXTURE_ID}:function-reconcileInvoice__class.Invoice"]`,
  )
  await expect(edge).toHaveCount(1)
  // one that accepts no Class still gets a node, it just hangs off nothing
  await expect(page.locator(`.react-flow__edge[data-id*="function-exportLedger__"]`)).toHaveCount(0)
})

test('clicking a function on the canvas opens its contract', async ({ page }) => {
  await openSchema(page)
  await page.locator(`${FUNCTION_NODE}[data-id$="function.reconcileInvoice"]`).click()

  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByRole('heading', { name: 'reconcileInvoice' })).toBeVisible()
  await expect(panel).toContainText('Works on')
  await expect(panel.getByRole('button', { name: 'Invoice', exact: true })).toBeVisible()
  await expect(panel).toContainText('Authenticated')
  await expect(panel.locator('[data-method-returns]')).toContainText('Yes / no')

  // the Class chip opens the Class it names
  await panel.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
})

test('the Functions overview groups them by the classes they work on', async ({ page }) => {
  await openSchema(page)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('combobox', { name: 'Command palette' }).fill('Functions')
  await page.getByRole('option', { name: /Functions crm\.studio-demo/ }).click()

  const panel = page.getByTestId('functions-panel')
  await expect(panel.getByRole('heading', { name: 'Functions' })).toBeVisible()
  await expect(panel.locator('[data-anchor-ref="function.reconcileInvoice"]')).toBeVisible()
  await expect(panel.locator('[data-anchor-ref="function.escalateTicket"]')).toBeVisible()
  // the one binding no Class of this domain sits apart instead of inventing a group
  await expect(panel.getByText('Standalone', { exact: true })).toBeVisible()

  await panel.locator('[data-anchor-ref="function.exportLedger"]').getByRole('button').click()
  await expect(page.getByRole('heading', { name: 'exportLedger' })).toBeVisible()
})

test('a class lists the functions declared outside it that work on it', async ({ page }) => {
  await openSchema(page)
  await page.getByText('Invoice', { exact: true }).first().click()

  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByText('Functions', { exact: true })).toBeVisible()
  await expect(panel.locator('[data-anchor-ref="function.reconcileInvoice"]')).toBeVisible()
  // a Function that works on another Class stays out of this list
  await expect(panel.locator('[data-anchor-ref="function.escalateTicket"]')).toHaveCount(0)
})

test('Process leads back to the schema for a function, as it does for a class', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Process', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process' })).toBeVisible()

  // The row itself stays inert so its Policy and auth chips keep their own clicks; the
  // jump is the control beside them.
  await page.getByRole('button', { name: 'Open escalateTicket in the schema' }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'escalateTicket' })).toBeVisible()
})
