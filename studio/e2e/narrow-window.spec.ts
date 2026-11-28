import {
  expect,
  indexRow,
  lensButton,
  levelButton,
  openSchema,
  sceneBox,
  sceneCanvas,
  test,
  type Locator,
  type Page,
} from './test'

/**
 * A narrow window keeps the Studio usable. The detail panel docks beside the canvas only while
 * the canvas keeps a usable width next to it; on a narrower window it floats over the canvas,
 * which keeps its whole width beneath, until it is closed. The bar keeps every crumb, the lens
 * switch and the Schema | Data switch on screen, and nothing scrolls sideways.
 */

/** The narrowest canvas a docked panel leaves beside it (`CANVAS_FLOOR` in `panel-shell.tsx`). */
const CANVAS_FLOOR = 360

const width = async (locator: Locator) => (await locator.boundingBox())?.width ?? 0

/** Nothing on the page, or in the bar, is wider than the window. */
async function noSidewaysScroll(page: Page) {
  const sizes = await page.evaluate(() => {
    const header = document.querySelector('header')!
    return {
      page: document.documentElement.scrollWidth,
      header: header.scrollWidth - header.clientWidth,
      window: window.innerWidth,
    }
  })
  expect(sizes.page).toBeLessThanOrEqual(sizes.window)
  expect(sizes.header).toBe(0)
}

/** A few letters of a name. */
const LETTERS = 48
/** A glyph with room to press it. */
const GLYPH = 28

/** On screen, inside the window, and at least `least` wide: a few letters, unless said otherwise. */
async function readable(page: Page, locator: Locator, least = LETTERS) {
  await expect(locator).toBeVisible()
  const box = (await locator.boundingBox())!
  const window = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(window.width)
  expect(box.width).toBeGreaterThanOrEqual(least)
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Waits for the camera to come to rest (two looks 150 ms apart agree), then requires `card`
 * wholly in the canvas the floating panel leaves uncovered: the panel never lies over the
 * selection it describes.
 */
async function restsBesidePanel(page: Page, card: Locator) {
  const panel = page.getByTestId('detail-panel')
  let last = ''
  await expect
    .poll(
      async () => {
        const [canvas, sheet, rect] = await Promise.all([
          sceneCanvas(page).boundingBox(),
          panel.boundingBox(),
          card.boundingBox(),
        ])
        const now = JSON.stringify([canvas, sheet, rect])
        const still = now === last
        last = now
        if (!still || !canvas || !sheet || !rect) return 'moving'
        const beside =
          rect.x >= canvas.x &&
          rect.x + rect.width <= sheet.x &&
          rect.y >= canvas.y &&
          rect.y + rect.height <= canvas.y + canvas.height
        return beside ? 'beside' : 'under or outside'
      },
      { intervals: [150] },
    )
    .toBe('beside')
}

test.describe('at 800 × 600', () => {
  test.use({ viewport: { width: 800, height: 600 } })

  test('the Inspector floats over the canvas, and the bar keeps its crumbs and lenses', async ({
    page,
  }) => {
    await openSchema(page)
    const canvas = sceneCanvas(page)
    const open = await width(canvas)
    expect(open).toBeGreaterThanOrEqual(CANVAS_FLOOR)

    await sceneBox(page, 'class.Invoice').click()
    const panel = page.getByTestId('detail-panel')
    await expect(panel.locator('[data-inspector-lens]')).toBeVisible()
    // too narrow to dock: the panel lies over the canvas, which keeps its width
    await expect(panel).toHaveAttribute('data-docked', 'false')
    expect(await width(canvas)).toBe(open)
    await noSidewaysScroll(page)

    // every crumb and every lens is on screen, and a lens still switches: the lens in use by
    // its name, the others by their glyph (their names stay their accessible names)
    for (const crumb of ['level-workspace', 'level-domain'])
      await readable(page, page.getByTestId(crumb))
    await readable(page, lensButton(page, 'structure'))
    for (const lens of ['behavior', 'rules', 'views'] as const) {
      await readable(page, lensButton(page, lens), GLYPH)
      await expect(lensButton(page, lens)).toHaveAccessibleName(new RegExp(lens, 'i'))
    }
    await lensButton(page, 'behavior').click()
    await expect(lensButton(page, 'behavior')).toHaveAttribute('aria-pressed', 'true')
    await expect(panel).toBeVisible()
    await noSidewaysScroll(page)

    // and it is dismissed like a docked one, the canvas as wide as before
    await page.getByRole('button', { name: 'Close panel' }).click()
    await expect(panel).toHaveCount(0)
    expect(await width(canvas)).toBe(open)
  })

  test('the Schema | Data switch keeps the level in use by name, the other by its glyph', async ({
    page,
  }) => {
    await openSchema(page)
    await readable(page, levelButton(page, 'schema'))
    await readable(page, levelButton(page, 'data'), GLYPH)
    await expect(levelButton(page, 'data')).toHaveAccessibleName(/data/i)
    await readable(page, page.getByTestId('level-domain'))
    await noSidewaysScroll(page)

    await levelButton(page, 'data').click()
    await expect(page.getByTestId('data-level')).toHaveAttribute('data-state', 'ready')
    await readable(page, levelButton(page, 'data'))
    await readable(page, levelButton(page, 'schema'), GLYPH)
    await expect(levelButton(page, 'schema')).toHaveAccessibleName(/schema/i)
    await readable(page, page.getByTestId('level-domain'))
    await readable(page, lensButton(page, 'structure'))
    await noSidewaysScroll(page)
  })

  test('the floating Inspector never lies over the selection it describes', async ({ page }) => {
    await openSchema(page)
    await sceneBox(page, 'class.Invoice').click()
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toHaveAttribute('data-docked', 'false')
    await restsBesidePanel(page, sceneBox(page, 'class.Invoice'))

    // a selection made while the panel floats is framed beside it
    await indexRow(page, 'class.Team').click()
    await expect(sceneBox(page, 'class.Team')).toHaveAttribute('data-selected', 'true')
    await restsBesidePanel(page, sceneBox(page, 'class.Team'))

    // and a panel widened over it moves the selection out from under it
    await page.getByRole('separator', { name: 'Resize detail panel' }).focus()
    await page.keyboard.press('End')
    await restsBesidePanel(page, sceneBox(page, 'class.Team'))
  })

  test('the Workspace level keeps its canvas toolbar clear of the panel opener', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByTestId('schema-level')).toBeVisible()
    await page.getByTestId('level-workspace').click()
    await expect(page.getByTestId('workspace-level')).toBeVisible()
    const opener = page.getByRole('button', { name: 'Workspace panel' })
    const panel = page.getByTestId('detail-panel')
    await expect(opener.or(panel)).toBeVisible()
    if (await opener.isVisible()) await opener.click()
    await expect(panel).toHaveAttribute('data-docked', 'false')
    await noSidewaysScroll(page)

    await page.getByRole('button', { name: 'Close panel' }).click()
    // the toolbar's corner control, the one the opener used to lie over
    const toolbar = sceneCanvas(page).locator(
      '[data-canvas-chrome] button[aria-label="Auto-arrange"]',
    )
    await expect(opener).toBeVisible()
    await expect(toolbar).toBeVisible()
    expect(overlap((await opener.boundingBox())!, (await toolbar.boundingBox())!)).toBe(false)
    await opener.click()
    await expect(page.getByTestId('detail-panel')).toBeVisible()
  })
})

test('a wide window docks the Inspector beside a canvas that keeps its floor', async ({ page }) => {
  await openSchema(page)
  await sceneBox(page, 'class.Invoice').click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toHaveAttribute('data-docked', 'true')
  expect(await width(sceneCanvas(page))).toBeGreaterThanOrEqual(CANVAS_FLOOR)
  // widened as far as it goes, the panel still leaves the canvas its floor
  await page.getByRole('separator', { name: 'Resize detail panel' }).focus()
  await page.keyboard.press('End')
  await expect.poll(() => width(sceneCanvas(page))).toBe(CANVAS_FLOOR)
})
