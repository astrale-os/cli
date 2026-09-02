import { expect, test } from './test'

/**
 * The canvas is ONE draggable surface, so it wears ONE cursor. React Flow ships a cursor per
 * capability instead — `default` on a plain node, `pointer` on a selectable one and across an
 * edge's wide invisible hit target, `crosshair` on the hidden handles — and every <button> a
 * node paints inside itself (module chevron, view pill, comment pin) lays one more on top. At
 * the 0.08 minimum zoom those targets measure 1–13px, so each reads as a flash rather than as
 * an affordance. The contract therefore has NO exceptions: every element the canvas owns says
 * `grab`, mid-drag every one of them says `grabbing`, and in Comment mode the whole window says
 * `pointer`. The policy is checked three ways — against the elements the fixture really renders,
 * against the selectors React Flow ships whether or not the fixture happens to use them, and
 * along a pixel-by-pixel sweep of what the pointer would actually land on.
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

/**
 * The same policy, checked against the classes React Flow hands out — plus the two shapes a node
 * control actually takes. The fixture cannot be relied on to render one of everything (a
 * relationship edge, a connectable handle, a selection rectangle), so the exceptions that used to
 * bite are planted on purpose rather than waited for.
 */
function probeCapabilities(): { cls: string; cursor: string }[] {
  const pane = document.querySelector('.react-flow .react-flow__pane')
  if (!pane) throw new Error('no pane on the page')
  const plant = (cls: string, tag = 'div') => {
    const el = document.createElement(tag)
    el.className = cls
    pane.append(el)
    const cursor = getComputedStyle(el).cursor
    el.remove()
    return { cls: `${tag}.${cls.split(' ').join('.')}`, cursor }
  }
  return [
    plant('react-flow__node selectable'),
    plant('react-flow__node draggable'),
    plant('react-flow__edge selectable'),
    plant('react-flow__handle connectionindicator'),
    plant('react-flow__nodesselection-rect'),
    plant('react-flow__controls-button'),
    plant('cursor-pointer'),
    plant('cursor-pointer', 'button'),
    plant('cursor-text', 'button'),
  ]
}

/**
 * A real trajectory rather than a grid of samples: 1px steps, so a control that measures 1px at
 * the minimum zoom cannot slip between two probes. Hits that land outside the canvas belong to a
 * neighbouring surface — the sidebar's resize grip overlaps the canvas box by a few pixels — and
 * a boundary between two surfaces is a cursor change the user is meant to see.
 */
function sweep(rows: number): { steps: number; cursors: string[]; offenders: Offender[] } {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('no canvas on the page')
  const box = flow.getBoundingClientRect()
  const cursors = new Set<string>()
  const offenders: Offender[] = []
  let steps = 0
  for (let r = 1; r <= rows; r++) {
    const y = box.top + (box.height * r) / (rows + 1)
    for (let x = Math.ceil(box.left); x < box.right; x++) {
      const el = document.elementFromPoint(x, y)
      if (!el || !flow.contains(el)) continue
      steps++
      const cursor = getComputedStyle(el).cursor
      cursors.add(cursor)
      if (cursor !== 'grab' && offenders.length < 12)
        offenders.push({
          cursor,
          tag: el.tagName.toLowerCase(),
          cls: String((el as HTMLElement).className ?? '').slice(0, 80),
        })
    }
  }
  return { steps, cursors: [...cursors], offenders }
}

/** Every cursor the canvas shows while React Flow marks `selector` as mid-drag. */
function probeWhileDragging(selector: string): string[] {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('no canvas on the page')
  const dragged = flow.querySelector(selector)
  if (!dragged) throw new Error(`nothing matches ${selector}`)
  dragged.classList.add('dragging')
  const all = [flow, ...flow.querySelectorAll('*')]
  const seen = new Set(all.map((el) => getComputedStyle(el).cursor))
  dragged.classList.remove('dragging')
  return [...seen]
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

test('the canvas wears one cursor across its whole surface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  // the view pill is one of the buttons that used to flash — the probes need it on screen
  await expect(page.getByRole('button', { name: 'overview', exact: true })).toBeVisible()

  const schema = await page.evaluate(probeElements, 'grab')
  expect(schema.offenders).toEqual([])
  expect(schema.checked).toBeGreaterThan(20)

  const capabilities = await page.evaluate(probeCapabilities)
  expect(capabilities.filter((probe) => probe.cursor !== 'grab')).toEqual([])
  expect(capabilities).toHaveLength(9)

  const swept = await page.evaluate(sweep, 12)
  expect(swept.offenders).toEqual([])
  expect(swept.cursors).toEqual(['grab'])
  expect(swept.steps).toBeGreaterThan(2000)

  await page.getByRole('button', { name: 'Core', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  expect((await page.evaluate(probeElements, 'grab')).offenders).toEqual([])
  expect((await page.evaluate(sweep, 12)).cursors).toEqual(['grab'])
})

test('mid-drag the closed hand holds across the whole canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  // Panning the pane and moving a node are the same gesture as far as the pointer is concerned:
  // either one closes the hand over everything, the toolbar and minimap floating above included.
  expect(await page.evaluate(probeWhileDragging, '.react-flow__pane')).toEqual(['grabbing'])
  expect(await page.evaluate(probeWhileDragging, '.react-flow__node')).toEqual(['grabbing'])

  // …and the same holds for a pan the mouse really performs, which is what puts that class there.
  const from = await page.evaluate(emptyPanePoint)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 6 })
  expect((await page.evaluate(probeElements, 'grabbing')).offenders).toEqual([])
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await page.mouse.up()
  expect((await page.evaluate(probeElements, 'grab')).offenders).toEqual([])
})

test('comment mode swaps the canvas to the cursor the rest of the window wears', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  // Comment mode turns every element into a click target; a hand left on the canvas would say
  // the opposite of what the mode does the moment the pointer crossed into it.
  await page.keyboard.press('c')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(1)
  expect((await page.evaluate(probeElements, 'pointer')).offenders).toEqual([])
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('pointer')

  await page.keyboard.press('Escape')
  await expect(page.locator('body[data-target-mode]')).toHaveCount(0)
  expect((await page.evaluate(probeElements, 'grab')).offenders).toEqual([])
})
