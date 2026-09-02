import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * A Class's detail panel reads as two flat lists and one line of ancestry.
 *
 * Properties and methods each come as ONE list: the Class's own members first, then
 * what it inherits, every inherited entry named `Base.member` — no "Inherited" section
 * below the fold. A method is one line closed (its signature) and opens on click into
 * its contract: the Policy, the input as field rows, the return. The header says
 * `extends` once and then the whole chain, each ancestor a chip that opens it.
 *
 * And a row's targeting ring draws whole: the list card clips, and the ring used to
 * lose its top on the first row and its bottom on the last.
 */

async function openInvoice(page: Page): Promise<Locator> {
  await page.addInitScript(() => localStorage.setItem('studio.panelSide', 'left'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse the panel' }).click()
  const node = page.getByText('Invoice', { exact: true }).first()
  await expect(node).toBeVisible()
  await node.click()
  await expect(page.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
  return page.getByRole('button', { name: 'Close panel' }).locator('..')
}

const refsOf = (rows: Locator) =>
  rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-anchor-ref')))

test('own members first, inherited ones after them under the Class that declares them', async ({
  page,
}) => {
  const panel = await openInvoice(page)

  // the canonical schema orders each Class's members by name; the panel keeps that
  // within a Class and puts the Class's own before its base's
  const properties = panel
    .locator('[data-member-list]')
    .first()
    .locator(':scope > [data-anchor-ref]')
  expect(await refsOf(properties)).toEqual([
    'class.Invoice.property.paid',
    'class.Invoice.property.total',
    'class.Document.property.issuedOn',
    'class.Document.property.reference',
  ])
  await expect(properties.nth(2)).toContainText('Document.issuedOn')

  const methods = panel.locator('[data-method-row]')
  expect(await refsOf(methods)).toEqual([
    'class.Invoice.method.remind',
    'class.Invoice.method.search',
    'class.Invoice.method.settle',
    'class.Document.method.archive',
  ])
  await expect(methods.nth(3)).toContainText('Document.archive')
  // the base's members no longer live in a section of their own
  await expect(panel.getByText('Inherited', { exact: true })).toHaveCount(0)
})

test('a method is one line closed and the whole contract open', async ({ page }) => {
  const panel = await openInvoice(page)
  const settle = panel.locator('[data-anchor-ref="class.Invoice.method.settle"]')

  await expect(panel.getByText('A demand for payment issued to a customer.')).toHaveCSS(
    'font-style',
    'italic',
  )

  // closed: the name, at the height of a property row, and nothing more — not the
  // inputs, not the return, not the Policy
  await expect(settle.getByRole('button', { name: /settle/ })).toHaveText('settle')
  await expect(settle).not.toContainText('amount')
  await expect(settle).not.toContainText('Yes / no')
  await expect(panel.locator('[data-method-detail]')).toHaveCount(0)
  const closed = (await settle.boundingBox())!
  expect(closed.height).toBeLessThan(36)

  await settle.getByRole('button', { name: /settle/ }).click()
  const detail = settle.locator('[data-method-detail]')
  await expect(detail).toBeVisible()
  expect(
    await detail.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft)),
  ).toBe(10)
  const open = (await settle.boundingBox())!
  expect(open.height).toBeGreaterThan(closed.height * 3)

  // what it does, first
  await expect(detail.locator('[data-method-doc]')).toHaveText(
    'Record a payment against this invoice.',
  )
  await expect(detail.locator('[data-method-doc]')).toHaveCSS('font-style', 'italic')

  // the Policy: who may call, and the check the Kernel evaluates
  await expect(detail).toContainText('Authorized')
  const check = detail.locator('[data-policy-check]')
  await expect(check).toContainText('mayManageInvoice')
  await expect(check).toContainText('on this Invoice')

  // the input, as field lines: name at the left, the friendly type at the right
  const input = detail.locator('[data-method-input]')
  await expect(input).toContainText('amount')
  await expect(input).toContainText('Number')
  await expect(input).toContainText('note?')
  await expect(input).toContainText('Text')

  // the return; the receiver no longer costs a row in the expanded detail
  await expect(detail.locator('[data-method-returns]')).toContainText('Yes / no')
  await expect(detail).not.toContainText('Runs on')
  await expect(detail).not.toContainText('a Invoice')

  // and it folds back to the one line
  await settle.getByRole('button', { name: /settle/ }).click()
  await expect(panel.locator('[data-method-detail]')).toHaveCount(0)
})

test('a structured return and a stream open into rows too', async ({ page }) => {
  const panel = await openInvoice(page)
  const remind = panel.locator('[data-anchor-ref="class.Invoice.method.remind"]')
  await expect(remind).not.toContainText('Object')
  await remind.getByRole('button', { name: /remind/ }).click()
  const returns = remind.locator('[data-method-returns]')
  await expect(returns).toContainText('Object')
  await expect(returns).toContainText('sentAt')
  await expect(returns).toContainText('channel')
  // authorized without a pinned Policy says so, instead of showing nothing
  await expect(remind).toContainText('no Policy pinned')

  const search = panel.locator('[data-anchor-ref="class.Invoice.method.search"]')
  await expect(search).not.toContainText('Stream')
  await expect(search.getByRole('button', { name: /search/ })).toContainText('static')
  await search.getByRole('button', { name: /search/ }).click()
  await expect(search.locator('[data-method-returns]')).toContainText('Stream of Object')
  await expect(search).toContainText('Anonymous')
  await expect(search.locator('[data-method-detail]')).not.toContainText('Runs on')
  await expect(search).not.toContainText('the Invoice type')
})

test('the header shows the bases as chips, no word in front, and each opens its Class', async ({
  page,
}) => {
  const panel = await openInvoice(page)
  const ancestry = panel.locator('[data-class-ancestry]')
  await expect(ancestry).toHaveText(/^Document$/)
  await expect(panel.getByText('extends', { exact: true })).toHaveCount(0)
  // the relation is spelled out on hover instead
  const chip = ancestry.getByRole('button', { name: 'Document', exact: true })
  await expect(chip).toHaveAttribute('title', 'Invoice extends Document')

  await chip.click()
  await expect(page.getByRole('heading', { name: 'Document', exact: true })).toBeVisible()
  // an abstract root extends nothing: the line is simply absent
  await expect(panel.locator('[data-class-ancestry]')).toHaveCount(0)
})

test('the targeting ring draws whole on the first and the last row of a list', async ({ page }) => {
  const panel = await openInvoice(page)
  const rows = panel.locator('[data-member-list]').first().locator(':scope > [data-anchor-ref]')

  await page.keyboard.press('c')
  await expect(page.getByText('Comment mode — click anything to comment')).toBeVisible()

  // where the ring lands versus where its list stops clipping
  const ringWithinClip = (row: Locator) =>
    row.evaluate((el) => {
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
      let clip = el.parentElement
      while (clip && !/hidden|clip|auto|scroll/.test(getComputedStyle(clip).overflow)) {
        clip = clip.parentElement
      }
      if (!clip) return { style: style.outlineStyle, width, ring, inner: null }
      const c = clip.getBoundingClientRect()
      const cs = getComputedStyle(clip)
      const inner = {
        top: c.top + parseFloat(cs.borderTopWidth),
        bottom: c.bottom - parseFloat(cs.borderBottomWidth),
        left: c.left + parseFloat(cs.borderLeftWidth),
        right: c.right - parseFloat(cs.borderRightWidth),
      }
      return { style: style.outlineStyle, width, ring, inner }
    })

  for (const row of [rows.first(), rows.last()]) {
    const box = (await row.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(row).toHaveAttribute('data-comment-target', '')
    const { style, width, ring, inner } = await ringWithinClip(row)
    expect(style).toBe('solid')
    expect(width).toBeGreaterThan(0)
    expect(inner).not.toBeNull()
    // every side of the ring lies inside the card that clips it
    expect(ring.top).toBeGreaterThanOrEqual(inner!.top - 0.01)
    expect(ring.bottom).toBeLessThanOrEqual(inner!.bottom + 0.01)
    expect(ring.left).toBeGreaterThanOrEqual(inner!.left - 0.01)
    expect(ring.right).toBeLessThanOrEqual(inner!.right + 0.01)
  }

  await page.keyboard.press('Escape')
})
