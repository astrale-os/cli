import { expect, test } from '@playwright/test'

/**
 * An imported domain's frame is furniture you move, exactly like the frame of a domain the
 * workspace really holds: grab it anywhere and drag it, and where you drop it is where it
 * stays — across a reload included, since its origin is the whole record.
 *
 * Grabbed on a MEMBER card on purpose. React Flow gives every node `pointer-events: all`
 * as soon as the canvas has an `onNodeClick`, so the cards a frame holds used to swallow
 * the press and leave a dead zone in the middle of the block a reader is trying to move.
 */
test('an imported domain frame drags from anywhere, member cards included', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  const canvas = page.getByTestId('workspace-schema-canvas')
  const frame = page.locator('.react-flow__node-extDomain').filter({
    hasText: 'payments',
  })
  await expect(frame).toBeVisible()
  const frameTransform = () => frame.evaluate((el) => (el as HTMLElement).style.transform)

  // Wait for the fit to bring the whole frame inside the pane instead of assuming it: a
  // point computed from a box that is half off-screen is not a point the mouse can press,
  // and a drag there is a silent no-op rather than a failure that says why.
  await expect
    .poll(async () => {
      const inner = await frame.boundingBox()
      const pane = await canvas.boundingBox()
      if (!inner || !pane) return false
      return (
        inner.x >= pane.x &&
        inner.y >= pane.y &&
        inner.x + inner.width <= pane.x + pane.width &&
        inner.y + inner.height <= pane.y + pane.height
      )
    })
    .toBe(true)

  const parked = await frameTransform()
  const member = page.locator('.react-flow__node-extMember').filter({ hasText: 'PaymentProcessor' })
  const memberBox = (await member.boundingBox())!
  const grab = { x: memberBox.x + memberBox.width / 2, y: memberBox.y + memberBox.height / 2 }
  // dragged towards the middle of the canvas, so the drop point stays on the pane
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x - 80, grab.y + 40, { steps: 8 })
  await page.mouse.up()

  const moved = await frameTransform()
  expect(moved).not.toBe(parked)

  await page.reload()
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(frame).toBeVisible()
  await expect.poll(frameTransform).not.toBe(parked)
})
