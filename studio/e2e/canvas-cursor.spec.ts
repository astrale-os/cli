import { expect, test } from './test'

/**
 * The canvas is ONE draggable surface, so it wears ONE cursor. React Flow ships a cursor per
 * capability instead — `default` on a plain node, `pointer` on a selectable one and across an
 * edge's wide invisible hit target, `crosshair` on the hidden handles — and every <button> a
 * node paints inside itself (module chevron, view pill, comment pin) lays one more on top. At
 * the 0.08 minimum zoom those targets measure 1–13px, so each reads as a flash rather than as
 * an affordance. The contract therefore has NO exceptions: every element the canvas owns says
 * `grab`, mid-drag every one of them says `grabbing`, and in Comment mode the whole window says
 * `pointer`. The policy is checked against every element the fixture really renders.
 *
 * Everything below runs in the browser, so each probe stands alone: no shared helpers, because
 * `page.evaluate` ships the function and nothing it closes over.
 */

type Offender = { cursor: string; tag: string; cls: string }

/** Every element the canvas owns, and the cursor it reports. */
function probeElements(expected: string): { checked: number; offenders: Offender[] } {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('no canvas on the page')
  const all = [flow, ...flow.querySelectorAll('*')]
  const offenders: Offender[] = []
  for (const el of all) {
    const cursor = getComputedStyle(el).cursor
    if (cursor === expected) continue
    offenders.push({
      cursor,
      tag: el.tagName.toLowerCase(),
      cls: String((el as HTMLElement).className ?? '').slice(0, 80),
    })
  }
  return { checked: all.length, offenders: offenders.slice(0, 12) }
}

/** A point where the bare pane is the topmost element — somewhere a pan can start from. */
function emptyPanePoint(): { x: number; y: number } {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('no canvas on the page')
  const box = flow.getBoundingClientRect()
  for (let y = Math.ceil(box.top) + 2; y < box.bottom - 2; y += 6) {
    for (let x = Math.ceil(box.left) + 2; x < box.right - 2; x += 6) {
      const el = document.elementFromPoint(x, y)
      if (el?.classList.contains('react-flow__pane')) return { x, y }
    }
  }
  throw new Error('no bare pane to grab')
}

test('the canvas wears one cursor: an open hand, closed mid-pan, a pointer in comment mode', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 })
  // the view pill is one of the buttons that used to flash — the probe needs it on screen
  await expect(page.getByRole('button', { name: 'overview', exact: true })).toBeVisible()

  const schema = await page.evaluate(probeElements, 'grab')
  expect(schema.offenders).toEqual([])
  expect(schema.checked).toBeGreaterThan(20)

  // a pan the mouse really performs closes the hand over everything, controls included
  const from = await page.evaluate(emptyPanePoint)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 6 })
  expect((await page.evaluate(probeElements, 'grabbing')).offenders).toEqual([])
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await page.mouse.up()

  // comment mode turns every element into a click target; a hand left on the canvas
  // would say the opposite of what the mode does
  await page.keyboard.press('c')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(1)
  expect((await page.evaluate(probeElements, 'pointer')).offenders).toEqual([])
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('pointer')
  await page.keyboard.press('Escape')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Core', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 })
  expect((await page.evaluate(probeElements, 'grab')).offenders).toEqual([])
})
