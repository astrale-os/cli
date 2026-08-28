import { expect, test } from '@playwright/test'

/**
 * The canvas is one draggable surface, so it wears one cursor. React Flow ships a cursor per
 * element instead — `default` on a node that is neither draggable nor selectable, `pointer` on a
 * selectable one and across an edge's wide invisible hit target, `crosshair` on the hidden handles
 * — and sweeping the mouse over the graph then flickers hand → arrow → pointer for no visible
 * reason. These probes sample the whole surface: the hand is expected everywhere, and only a real
 * click target (`<button>`), a resize grip, or the panel chrome may say something else.
 */
function probeCursors(): {
  sampled: number
  offenders: { cursor: string; tag: string; cls: string }[]
} {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('no canvas on the page')
  const box = flow.getBoundingClientRect()
  const offenders: { cursor: string; tag: string; cls: string }[] = []
  let sampled = 0
  for (let y = box.top + 4; y < box.bottom - 4; y += 8) {
    for (let x = box.left + 4; x < box.right - 4; x += 8) {
      const el = document.elementFromPoint(x, y)
      if (!el) continue
      sampled++
      const cursor = getComputedStyle(el).cursor
      if (cursor === 'grab') continue
      // a control may keep its own cursor — anything else on the surface is a flicker
      if (cursor === 'pointer' && el.closest('button')) continue
      if (cursor.endsWith('-resize') && el.closest('.react-flow__resize-control')) continue
      // toolbar card and controls rail float ABOVE the canvas rather than being part of it
      if (el.closest('.react-flow__panel') && !el.closest('.react-flow__minimap')) continue
      offenders.push({
        cursor,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 80),
      })
    }
  }
  return { sampled, offenders }
}

/** Every cursor the pane shows while React Flow marks it as mid-pan. */
function probeCursorsWhilePanning(): string[] {
  const pane = document.querySelector('.react-flow__pane')
  const flow = document.querySelector('.react-flow')
  if (!pane || !flow) throw new Error('no canvas on the page')
  pane.classList.add('dragging')
  const box = flow.getBoundingClientRect()
  const seen = new Set<string>()
  for (let y = box.top + 4; y < box.bottom - 4; y += 8) {
    for (let x = box.left + 4; x < box.right - 4; x += 8) {
      const el = document.elementFromPoint(x, y)
      if (el && pane.contains(el)) seen.add(getComputedStyle(el).cursor)
    }
  }
  pane.classList.remove('dragging')
  return [...seen]
}

test('the canvas wears one cursor across its whole surface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  const schema = await page.evaluate(probeCursors)
  expect(schema.offenders).toEqual([])
  expect(schema.sampled).toBeGreaterThan(500)

  // Mid-drag the closed hand has to hold across everything sliding under the pointer — a node
  // re-asserting its own `grab` would flicker for as long as the pan lasts.
  expect(await page.evaluate(probeCursorsWhilePanning)).toEqual(['grabbing'])

  await page.getByRole('button', { name: 'Core', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  expect((await page.evaluate(probeCursors)).offenders).toEqual([])
})
