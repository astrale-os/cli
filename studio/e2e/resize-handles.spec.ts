/**
 * Every edge in the Studio that resizes something behaves the same way: the domains
 * rail, the docked work panel, and the floating dock. Same grip, the whole edge lit on
 * hover, still lit while a drag outruns the pointer, the resize cursor held over
 * everything on the way, and a double click back to the default size.
 */
import { dockWorkspacePanel, expect, test, type Locator, type Page } from './test'

const state = (handle: Locator) => handle.getAttribute('data-resize-state')

/** Hover, then drag well past the grip, and check the edge on the way. */
async function checkGrip(page: Page, handle: Locator, drag: { dx: number; dy: number }) {
  // The dock grows into place on a height transition: a grip measured mid-way is
  // somewhere the pointer no longer finds it. Aim only once the edge has stopped.
  let last = ''
  await expect
    .poll(async () => {
      const now = JSON.stringify(await handle.boundingBox())
      const settled = now === last
      last = now
      return settled
    })
    .toBe(true)
  const box = (await handle.boundingBox())!
  // an 8px grip across the edge, live along its whole length
  expect(Math.round(Math.min(box.width, box.height))).toBe(8)

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await expect.poll(() => state(handle)).toBe('hover')

  await page.mouse.down()
  await expect.poll(() => state(handle)).toBe('active')
  // far past anything the edge can follow: it stays lit, and the cursor stays a resize one
  await page.mouse.move(x + drag.dx, y + drag.dy, { steps: 6 })
  await expect.poll(() => state(handle)).toBe('active')
  const cursor = await handle.evaluate((element) => getComputedStyle(element).cursor)
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe(cursor)

  await page.mouse.up()
  await page.mouse.move(5, 5)
  await expect.poll(() => state(handle)).toBe('idle')
  expect(await page.evaluate(() => document.documentElement.dataset.resizing)).toBeUndefined()
}

test('the rail and the docked panel resize the same way, and reset on double click', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'right')
  await page.goto('/')

  const rail = page.getByTestId('modules-sidebar')
  const railHandle = page.getByRole('separator', { name: 'Resize the domains rail' })
  const railWidth = async () => Math.round((await rail.boundingBox())!.width)
  const railDefault = await railWidth()
  await checkGrip(page, railHandle, { dx: 900, dy: 0 })
  expect(await railWidth()).toBe(560)
  await railHandle.dblclick()
  await expect.poll(railWidth).toBe(railDefault)

  const panelHandle = page.getByRole('separator', { name: 'Resize the panel' })
  const panel = page.locator('aside').filter({ has: panelHandle })
  const panelWidth = async () => Math.round((await panel.boundingBox())!.width)
  const panelDefault = await panelWidth()
  await checkGrip(page, panelHandle, { dx: 900, dy: 0 })
  expect(await panelWidth()).toBe(260)
  await panelHandle.dblclick()
  await expect.poll(panelWidth).toBe(panelDefault)

  // and the keyboard: one arrow press is one step
  await panelHandle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(panelWidth).toBe(panelDefault + 20)
})

test('the dock lights the whole edge it moves, corners lighting both of theirs', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'bottom')
  await page.goto('/')
  await page.locator('[data-agent-composer]').click()
  const dock = page.getByTestId('agent-dock')
  const top = dock.locator('[data-dock-resize="top"]')
  const left = dock.locator('[data-dock-resize="left"]')
  const corner = dock.locator('[data-dock-resize="top-left"]')
  await expect(top).toBeVisible()

  // the top grip runs the dock's whole straight edge, not a pill in its middle
  const edge = (await top.boundingBox())!
  const whole = (await dock.boundingBox())!
  expect(edge.width).toBeGreaterThan(whole.width - 40)

  await checkGrip(page, top, { dx: 0, dy: -2000 })
  await checkGrip(page, left, { dx: -2000, dy: 0 })

  // a corner moves two edges, and says so on both
  const box = (await corner.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + 30, { steps: 3 })
  const outline = dock.locator('span.rounded-2xl.border-2')
  await expect(outline).toHaveClass(/border-t-primary(?!\/)/)
  await expect(outline).toHaveClass(/border-l-primary(?!\/)/)
  await expect(outline).not.toHaveClass(/border-r-primary/)
  await page.mouse.up()
})
