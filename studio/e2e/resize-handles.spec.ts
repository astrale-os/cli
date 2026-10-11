/**
 * Every edge in the Studio that resizes something behaves the same way: the domains
 * rail, the docked work panel and the detail panel. Same grip, lit on hover, still lit
 * while a drag outruns the pointer, the resize cursor held over everything on the way,
 * a double click back to the default size, and the width kept where the reader left it.
 * The floating dock's own edges are bottom-dock.spec.ts's.
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

test('the detail panel resizes and keeps its width across navigation and reload', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand crm.studio-demo.astrale.ai', exact: true }).click()
  const tree = page.getByTestId('workspace-domain-tree')
  const openPolicy = () =>
    tree.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  await openPolicy()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  const width = () => panel.evaluate((element) => element.getBoundingClientRect().width)
  const start = await width()
  const handle = page.getByRole('separator', { name: 'Resize detail panel' })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(width).toBe(start + 100)

  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(width).toBe(start + 120)
  await expect
    .poll(async () => (await (await request.get('/api/workspace/state')).json()).detailWidth)
    .toBe(start + 120)
  await page.getByRole('button', { name: 'Close panel' }).click()
  await tree.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect.poll(width).toBe(start + 120)

  await page.reload()
  await openPolicy()
  await expect.poll(width).toBe(start + 120)
  await handle.focus()
  await page.keyboard.press('Home')
  await expect.poll(width).toBe(320)
})
