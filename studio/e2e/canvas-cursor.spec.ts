import { expect, lensButton, openSchema, sceneBox, test } from './test'

/**
 * The canvas is ONE draggable surface, so it wears ONE cursor: every element the world draws —
 * cards, their headers and tallies, links and their hit paths, junctions, frames, labels — says
 * `grab`; mid-pan every one says `grabbing`; in Comment mode every one says `pointer`, because
 * every one is then a click target. The zoom and fit controls are not the world: they are
 * buttons, and say so.
 *
 * Each probe runs in the browser and stands alone: `page.evaluate` ships the function and
 * nothing it closes over.
 */

type Offender = { cursor: string; tag: string; cls: string }

/** Every element of the canvas's world, and the cursor it reports. */
function probeWorld(expected: string): { checked: number; offenders: Offender[] } {
  const canvas = document.querySelector('.scene-canvas')
  const world = canvas?.querySelector('.scene-world')
  if (!canvas || !world) throw new Error('no scene canvas on the page')
  const all = [canvas, ...world.querySelectorAll('*')]
  const offenders: Offender[] = []
  for (const el of all) {
    const cursor = getComputedStyle(el).cursor
    if (cursor === expected) continue
    offenders.push({
      cursor,
      tag: el.tagName.toLowerCase(),
      cls: String((el as HTMLElement).getAttribute('class') ?? '').slice(0, 80),
    })
  }
  return { checked: all.length, offenders: offenders.slice(0, 12) }
}

/** A point of the canvas no card, link or control covers: somewhere a pan starts from. */
function barePoint(): { x: number; y: number } {
  const canvas = document.querySelector('.scene-canvas')
  if (!canvas) throw new Error('no scene canvas on the page')
  const box = canvas.getBoundingClientRect()
  const taken =
    '.scene-box, .scene-link, .scene-ribbon, .scene-junction, [data-canvas-chrome], button'
  for (let y = Math.ceil(box.top) + 8; y < box.bottom - 8; y += 6) {
    for (let x = Math.ceil(box.left) + 8; x < box.right - 8; x += 6) {
      const el = document.elementFromPoint(x, y)
      if (el && canvas.contains(el) && !el.closest(taken)) return { x, y }
    }
  }
  throw new Error('no bare canvas to grab')
}

test('the canvas wears one cursor: an open hand, closed mid-pan, a pointer in comment mode', async ({
  page,
}) => {
  await openSchema(page)
  const schema = await page.evaluate(probeWorld, 'grab')
  expect(schema.offenders).toEqual([])
  expect(schema.checked).toBeGreaterThan(50)

  // a pan the mouse really performs closes the hand over everything
  const from = await page.evaluate(barePoint)
  const before = (await sceneBox(page, 'class.Invoice').boundingBox())!
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 6 })
  await expect(page.locator('.scene-canvas[data-panning]')).toHaveCount(1)
  expect((await page.evaluate(probeWorld, 'grabbing')).offenders).toEqual([])
  await page.mouse.up()
  await expect(page.locator('.scene-canvas[data-panning]')).toHaveCount(0)
  // and it was a pan: the world moved under the hand
  const after = (await sceneBox(page, 'class.Invoice').boundingBox())!
  expect(Math.round(after.x - before.x)).toBe(60)
  expect(Math.round(after.y - before.y)).toBe(30)

  // the controls are buttons, not the world
  const fit = page.locator('[data-canvas-chrome] button[aria-label="Fit"]')
  expect(await fit.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')

  // comment mode turns every element into a click target
  await page.keyboard.press('c')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(1)
  expect((await page.evaluate(probeWorld, 'pointer')).offenders).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(0)

  // another lens draws other parts — bands, ribbons, tallies — under the same hand
  await lensButton(page, 'behavior').click()
  await expect(page.locator('.scene-band')).toHaveCount(3)
  expect((await page.evaluate(probeWorld, 'grab')).offenders).toEqual([])
})
