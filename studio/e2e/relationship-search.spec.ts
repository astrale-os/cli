import {
  expect,
  inspector,
  openSchema,
  restsInCanvas,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
  type Locator,
  type Page,
} from './test'

/**
 * Searching for a RELATIONSHIP and getting an answer on the canvas: a relationship parked
 * off-screen, found by name in the palette, brought into view, and read in the Inspector.
 */

const RELATIONSHIP = 'SubscribedTo'

/** Is the whole card inside the canvas? A card half under the Inspector is one the reader cannot read. */
async function insideCanvas(page: Page, locator: Locator): Promise<boolean> {
  const canvas = await sceneCanvas(page).boundingBox()
  const box = await locator.boundingBox().catch(() => null)
  if (!canvas || !box) return false
  return (
    box.x >= canvas.x &&
    box.y >= canvas.y &&
    box.x + box.width <= canvas.x + canvas.width &&
    box.y + box.height <= canvas.y + canvas.height
  )
}

/** Where the middle of the relationship's line stands on screen. */
const lineMiddle = (page: Page) =>
  sceneLink(page, `class.${RELATIONSHIP}`)
    .locator('.scene-link-hit')
    .evaluate((el) => {
      const path = el as SVGPathElement
      const at = path.getPointAtLength(path.getTotalLength() / 2)
      const m = path.getScreenCTM()!
      return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f }
    })

/** Park the relationship off-screen, then find it through ⌘K. */
async function searchParked(page: Page): Promise<void> {
  await openSchema(page)
  await expect(sceneLink(page, `class.${RELATIONSHIP}`)).toHaveCount(1)
  // Zoom hard into a Class at the other end of the Schema until an end has left the canvas.
  // Asserted rather than assumed: a jump to something already in view proves nothing.
  const company = sceneBox(page, 'class.Company')
  const anchor = (await sceneBox(page, 'class.Product').boundingBox())!
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2)
  for (let step = 0; step < 24 && (await insideCanvas(page, company)); step += 1) {
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(50)
  }
  expect(await insideCanvas(page, company)).toBe(false)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByPlaceholder('Search the schema…')).toBeVisible()
  await page.keyboard.type(RELATIONSHIP)
  // listed as a relationship, with the two Classes it runs between
  await expect(
    page.getByRole('option', {
      name: `${RELATIONSHIP} (crm.studio-demo.astrale.ai · Company → Subscription)`,
    }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByPlaceholder('Search the schema…')).toHaveCount(0)
}

test('⌘K finds a relationship, brings its line into view and lights its two ends', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await searchParked(page)

  // the line reads as picked, its ends lit, the Inspector on the relationship, not an end
  await expect(sceneLink(page, `class.${RELATIONSHIP}`)).toHaveAttribute('data-selected', 'true')
  await expect(sceneBox(page, 'class.Company')).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneBox(page, 'class.Subscription')).toHaveAttribute('data-emphasis', 'lit')
  await expect(
    inspector(page).getByRole('heading', { name: RELATIONSHIP, exact: true }),
  ).toBeVisible()
  // and the canvas went to it: once the camera rests, the middle of the line stands inside it
  await restsInCanvas(page, async () => ({ ...(await lineMiddle(page)), width: 0, height: 0 }))

  expect(pageErrors).toEqual([])
})

/*
 * A relationship is its two ends: framed at the legible zoom when they fit at it, else at the
 * zoom they fit, both whole inside the canvas — the Inspector open beside it or not.
 */
test('⌘K brings a relationship into view whole: both its ends inside the canvas', async ({
  page,
}) => {
  await searchParked(page)
  await restsInCanvas(page, sceneBox(page, 'class.Company'))
  await restsInCanvas(page, sceneBox(page, 'class.Subscription'))
})
