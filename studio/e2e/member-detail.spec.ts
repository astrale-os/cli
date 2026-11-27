import { expect, inspector, lensButton, openSchema, sceneBox, test, type Locator } from './test'

/**
 * The Inspector reads the selection through the lens on screen. Structure tells what a Class
 * is: its ancestry, its relationships as sentences, its properties — its own first, then what
 * it inherits, named by the base — and no methods, which are what it does. Behavior tells
 * what changes it, and what it does: its methods, each one a way into its function.
 */

const refsOf = (rows: Locator) =>
  rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-anchor-ref')))

test('Structure reads what a Class is, and leaves what it does to Behavior', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  const panel = inspector(page)
  await expect(panel).toHaveAttribute('data-inspector-lens', 'structure')
  await expect(panel.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
  await expect(panel).toContainText('A demand for payment issued to a customer.')

  // its relationships, a row each drawn in marks — the verb, the count, the other Class — that
  // says its sentence on hover and names the relationship under it
  const relationships = panel.locator('[data-inspector-relationships]')
  const customer = relationships.locator(
    '[data-inspector-relationship][title="An Invoice has exactly one customer Company"]',
  )
  await expect(customer.locator('[data-count-mark="1"]')).toBeVisible()
  await expect(customer.locator('[data-class-chip="class.Company"]')).toBeVisible()
  await expect(
    relationships.locator(
      '[data-inspector-relationship][title="An Invoice has any number of Payments"]',
    ),
  ).toBeVisible()
  await expect(relationships.locator('[data-inspector-link="class.SettledBy"]')).toBeVisible()

  // its own properties first; the inherited ones fold under their base, then read as such
  const properties = panel.locator('[data-inspector-property]')
  expect(await refsOf(properties)).toEqual([
    'class.Invoice.property.paid',
    'class.Invoice.property.total',
  ])
  await panel.getByRole('button', { name: /2 inherited from Document/ }).click()
  expect(await refsOf(properties)).toEqual([
    'class.Invoice.property.paid',
    'class.Invoice.property.total',
    'class.Document.property.issuedOn',
    'class.Document.property.reference',
  ])

  // no methods here: the Inspector points at the lens that reads them
  await expect(panel.locator('[data-inspector-methods]')).toHaveCount(0)
  await expect(panel.locator('[data-method-row]')).toHaveCount(0)
  const toBehavior = panel.locator('[data-lens-switch="behavior"]')
  await expect(toBehavior).toContainText('2 functions write an Invoice')
  await toBehavior.click()
  await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).toHaveAttribute('data-inspector-lens', 'behavior')
  await expect(panel.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
})

test('Behavior reads what changes a Class and what it does', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  await lensButton(page, 'behavior').click()
  const panel = inspector(page)
  await expect(panel).toHaveAttribute('data-inspector-lens', 'behavior')

  // what changes it: each verb, the function that does it and the mutation it runs
  const changes = panel.locator('[data-inspector-changes]')
  const update = changes.locator('[data-inspector-change="update"]')
  await expect(update.locator('[data-inspector-link="function.Invoice.settle"]')).toBeVisible()
  await expect(update.locator('[data-inspector-link="function.reconcileInvoice"]')).toBeVisible()
  await expect(
    update.locator('[data-inspector-link="mutation.crm.invoice.reconcile"]'),
  ).toBeVisible()
  const link = changes.locator('[data-inspector-change="link"]')
  await expect(link.locator('[data-inspector-link="class.SettledBy"]')).toBeVisible()
  // the Structure facts are one switch away, not repeated
  await expect(panel.locator('[data-inspector-relationships]')).toHaveCount(0)
  await expect(panel.locator('[data-inspector-property]')).toHaveCount(0)

  // its methods, by name: a concrete method of its base is not one of them
  const methods = panel.locator('[data-method-row]')
  expect(await refsOf(methods)).toEqual([
    'class.Invoice.method.remind',
    'class.Invoice.method.search',
    'class.Invoice.method.settle',
  ])
  await expect(panel.locator('[data-anchor-ref="class.Document.method.archive"]')).toHaveCount(0)
  await expect(methods.nth(1)).toContainText('static')
  await expect(methods.nth(2)).toContainText('action · contract')

  // a method opens its function: what it does, takes, returns and changes
  await methods.nth(2).locator('[data-inspector-link="function.Invoice.settle"]').click()
  await expect(panel.getByRole('heading', { name: 'Invoice.settle', exact: true })).toBeVisible()
  await expect(panel).toContainText('Record a payment against this invoice.')
  await expect(panel).toContainText('amount')
  await expect(panel).toContainText('Yes / no')
  await expect(panel.locator('[data-inspector-function-changes]')).toContainText(
    'creates a Payment',
  )
  await expect(panel.locator('[data-inspector-reaches]')).toContainText('ledger.record')
})

test('the ancestry names each base, and each opens its Class', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  const panel = inspector(page)
  const ancestry = panel.locator('[data-class-ancestry]')
  await expect(ancestry).toContainText('Extends')
  await ancestry.locator('[data-inspector-link="class.Document"]').click()
  await expect(panel.getByRole('heading', { name: 'Document', exact: true })).toBeVisible()
  await expect(sceneBox(page, 'class.Document')).toHaveAttribute('data-selected', 'true')
  // an abstract root extends nothing: the line is simply absent
  await expect(panel.locator('[data-class-ancestry]')).toHaveCount(0)
})

/** Where an element's targeting ring lands, and the inner box of what clips it (itself, by default). */
const ringAndClip = (target: Locator, clipped: boolean) =>
  target.evaluate((el, clipped) => {
    const style = getComputedStyle(el)
    const offset = parseFloat(style.outlineOffset)
    const width = parseFloat(style.outlineWidth)
    const box = el.getBoundingClientRect()
    const ring = {
      top: box.top - offset - width,
      bottom: box.bottom + offset + width,
      left: box.left - offset - width,
      right: box.right + offset + width,
    }
    let clip: Element | null = el
    if (clipped) {
      clip = el.parentElement
      while (clip && !/hidden|clip|auto|scroll/.test(getComputedStyle(clip).overflow))
        clip = clip.parentElement
    }
    const c = clip!.getBoundingClientRect()
    const cs = getComputedStyle(clip!)
    const border = (side: string) =>
      clipped ? parseFloat(cs.getPropertyValue(`border-${side}-width`)) : 0
    const inner = {
      top: c.top + border('top'),
      bottom: c.bottom - border('bottom'),
      left: c.left + border('left'),
      right: c.right - border('right'),
    }
    return { style: style.outlineStyle, width, ring, inner }
  }, clipped)

test('the targeting ring draws whole on the first and last property rows', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  const rows = inspector(page).locator('[data-inspector-property]')
  await expect(rows).toHaveCount(2)

  await page.keyboard.press('c')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(1)
  for (const row of [rows.first(), rows.last()]) {
    const box = (await row.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(row).toHaveAttribute('data-comment-target', '')
    const { style, width, ring, inner } = await ringAndClip(row, true)
    expect(style).toBe('solid')
    expect(width).toBeGreaterThan(0)
    expect(ring.top).toBeGreaterThanOrEqual(inner.top - 0.01)
    expect(ring.bottom).toBeLessThanOrEqual(inner.bottom + 0.01)
    expect(ring.left).toBeGreaterThanOrEqual(inner.left - 0.01)
    expect(ring.right).toBeLessThanOrEqual(inner.right + 0.01)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(0)
})
