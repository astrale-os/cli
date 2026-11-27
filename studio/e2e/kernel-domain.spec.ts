import { expect, indexRow, inspector, openSchema, sceneBox, sceneCanvas, test } from './test'

/**
 * The Kernel is no Domain of the Workspace: its Classes come onto a Schema's canvas where that
 * Schema builds on them, quiet, and read in the Inspector like any other — read-only, with what
 * they can do in Behavior. The fixture's Person extends the Kernel's Identity; no relationship's
 * end accepts Identity, so it is drawn only when Inheritance asks for the parents.
 */

const IDENTITY = 'class.kernel.astrale.ai:class.Identity'

test('a Kernel Class the Schema builds on is drawn quiet, linked by "is a", and read in the Inspector', async ({
  page,
}) => {
  await openSchema(page)
  const identity = sceneBox(page, IDENTITY)
  // a parent no end accepts stays off the canvas until asked for
  await expect(identity).toHaveCount(0)
  const inheritance = sceneCanvas(page).locator(
    '[data-canvas-chrome] button[aria-label="Inheritance"]',
  )
  await expect(inheritance).toHaveAttribute('aria-pressed', 'false')
  await inheritance.click()
  await expect(inheritance).toHaveAttribute('aria-pressed', 'true')

  await expect(identity).toBeVisible()
  await expect(identity).toHaveAttribute('data-muted', 'true')
  await expect(
    sceneCanvas(page).locator(
      `g.scene-link[data-link-mark="trunk:extends:class.Person|${IDENTITY}"]`,
    ),
  ).toHaveCount(1)
  // laid out, not stacked on the Class that extends it
  const [own, parent] = [
    (await sceneBox(page, 'class.Person').boundingBox())!,
    (await identity.boundingBox())!,
  ]
  expect([Math.round(own.x), Math.round(own.y)]).not.toEqual([
    Math.round(parent.x),
    Math.round(parent.y),
  ])
  // the Index lists it under the Kernel
  await expect(indexRow(page, 'domain.kernel.astrale.ai')).toBeVisible()

  await indexRow(page, IDENTITY).click()
  const read = inspector(page)
  await expect(read.getByRole('heading', { name: 'Identity', exact: true })).toBeVisible()
  await expect(read).toContainText(/Class\s*·\s*Kernel/i)
  for (const property of ['sub', 'iss']) await expect(read).toContainText(property)
  // what it can do is Behavior's to say, even off that lens's canvas
  await page.keyboard.press('2')
  await expect(read.locator('[data-inspector-methods]')).toContainText('whoami')

  await page.keyboard.press('1')
  await inheritance.click()
  await expect(identity).toHaveCount(0)
})

/*
 * DESIGN §4 R4 puts every Class of another Domain in a frame for its Domain. A Domain with one
 * Class drawn gets no frame of one member: the card itself names the Domain, at every zoom.
 */
test('a lone Class of another Domain still says which Domain it is', async ({ page }) => {
  await openSchema(page)
  await sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Inheritance"]').click()
  const identity = sceneBox(page, IDENTITY)
  await expect(identity).toBeVisible()
  const framed = sceneCanvas(page).locator('[data-region-id="domain.kernel.astrale.ai"]')
  if ((await framed.count()) > 0) return
  await expect(identity).toContainText(/kernel/i)
  // from afar, where a card is its name, too
  const zoomOut = sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Zoom out"]')
  await expect(async () => {
    await zoomOut.click()
    await expect(sceneCanvas(page)).toHaveAttribute('data-tier', 'far', { timeout: 500 })
  }).toPass()
  await expect(identity).toContainText(/kernel/i)
})
