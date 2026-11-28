import {
  drawnLinks,
  expect,
  fixtureBundle,
  lensButton,
  levelButton,
  openSchema,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
  type Page,
} from './test'

/**
 * Opening a Domain lands on its Schema, read through Structure: every Class a card, every
 * relationship a drawn link — none folded away, none waiting to be revealed. A relationship
 * that accepts several Classes at one end meets them at a junction; a Class of another Domain
 * sits in that Domain's frame. The fixture's bundle is the reference, so a relationship added
 * to the fixture is a relationship this spec expects on the canvas.
 */

const PAYMENTS = 'payments.studio-demo.astrale.ai'
const foreign = (name: string) => `class.${PAYMENTS}:class.${name}`

/** The screen box of a drawn element, read in the browser. */
const rect = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect()
    return { left, top, right, bottom }
  })

test('a Domain opens on its Schema in Structure, every relationship drawn', async ({
  page,
  request,
}) => {
  await openSchema(page)
  await expect(lensButton(page, 'structure')).toHaveAttribute('aria-pressed', 'true')
  await expect(levelButton(page, 'schema')).toHaveAttribute('aria-pressed', 'true')

  const { ir } = await fixtureBundle(request)
  const relationships = Object.entries(ir.classes)
    .filter(([, cls]) => cls.type === 'edge' && !cls.abstract)
    .map(([name]) => `class.${name}`)
  const classes = Object.entries(ir.classes)
    .filter(([, cls]) => cls.type === 'node')
    .map(([name]) => `class.${name}`)
  // the fixture is a real reference: if it shrinks, this spec stops protecting much
  expect(relationships.length).toBeGreaterThanOrEqual(16)

  for (const id of classes) await expect(sceneBox(page, id)).toBeVisible()
  const links = await drawnLinks(page)
  for (const id of relationships) expect(links, `${id} is drawn`).toContain(id)
  // nothing waits behind a closed trunk or a hidden mark
  await expect(page.locator('g.scene-link[data-hidden]')).toHaveCount(0)
  for (const id of relationships)
    await expect(sceneLink(page, id)).not.toHaveAttribute('data-hidden')

  // what Structure does not state is counted, never silently dropped
  const folded = page.getByTestId('scene-folded')
  await expect(folded).toContainText('Functions and methods')
  await expect(folded).toContainText('read in the Behavior lens')
})

test('a union end meets its Classes at a junction, each reached by its own fan', async ({
  page,
  request,
}) => {
  const { ir } = await fixtureBundle(request)
  // Mentions: a Message mentions a Person or a Company
  expect(ir.classes.Mentions?.endpoints?.map((end) => end.types.length)).toEqual([1, 2])

  await openSchema(page)
  const junction = page.locator(
    'button.scene-junction[data-junction-id="junction:class.Company,class.Person"]',
  )
  await expect(junction).toBeVisible()
  await expect(junction).toHaveAttribute('aria-label', /One of Company, Person/)
  await expect(
    page.locator('path.scene-fan[data-junction-id="junction:class.Company,class.Person"]'),
  ).toHaveCount(2)
  // the relationship's own line runs from Message to that junction
  await expect(sceneLink(page, 'class.Mentions')).toHaveAttribute(
    'data-link-mark',
    'trunk:relationship:class.Message|junction:class.Company,class.Person',
  )
})

test('Classes of another Domain sit in its frame, and fold into one card when it is hidden', async ({
  page,
}) => {
  await openSchema(page)
  const frame = page.locator(`[data-region-id="domain.${PAYMENTS}"]`)
  await expect(frame).toHaveAttribute('data-framed', 'true')
  await expect(frame.locator('.scene-region-label')).toHaveText('payments')
  const outer = await rect(page, `[data-region-id="domain.${PAYMENTS}"]`)
  for (const name of ['Payout', 'PaymentProcessor']) {
    const card = sceneBox(page, foreign(name))
    await expect(card).toBeVisible()
    // read-only: a Class this Domain does not own is drawn muted
    await expect(card).toHaveAttribute('data-muted', 'true')
    const inner = await rect(page, `.scene-box[data-box-id="${foreign(name)}"]`)
    expect(inner.left).toBeGreaterThanOrEqual(outer.left)
    expect(inner.right).toBeLessThanOrEqual(outer.right)
    expect(inner.top).toBeGreaterThanOrEqual(outer.top)
    expect(inner.bottom).toBeLessThanOrEqual(outer.bottom)
  }
  for (const id of ['class.ProcessedBy', 'class.PaidOutBy'])
    await expect(sceneLink(page, id)).toBeVisible()

  // hidden, the other Domain is one card, and the links that reach it still draw
  await page.getByTestId('domains-control').click()
  const way = (drawn: string) =>
    page.locator(`[data-domain-choice="${PAYMENTS}"][data-drawn="${drawn}"]`)
  await expect(way('reached')).toHaveAttribute('aria-checked', 'true')
  await way('hidden').click()
  await expect(way('hidden')).toHaveAttribute('aria-checked', 'true')
  await expect(sceneBox(page, `domain.${PAYMENTS}`)).toBeVisible()
  await expect(sceneBox(page, foreign('Payout'))).toHaveCount(0)
  await expect(frame).toHaveCount(0)
  for (const id of ['class.ProcessedBy', 'class.PaidOutBy'])
    await expect(sceneLink(page, id)).toBeVisible()

  await way('reached').click()
  await expect(sceneBox(page, foreign('Payout'))).toBeVisible()
})

test('the folded count opens the lens that reads what it folds', async ({ page }) => {
  await openSchema(page)
  await page.getByTestId('scene-folded').click()
  await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)
})
