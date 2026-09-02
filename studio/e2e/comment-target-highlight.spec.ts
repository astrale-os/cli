import { dockWorkspacePanel, expect, test } from './test'

/**
 * Comment / Ask mode calls out what the next click would pin to.
 *
 * A node takes an outline; a RELATIONSHIP takes its own line thickened instead, because a
 * box drawn round a line would cover its neighbours and you could no longer tell which
 * relationship the pin would land on. The line half of that was written as a plain rule and
 * never fired: the canvas writes `stroke` onto every edge path as an INLINE style (its
 * module colour, inherited, selected), and an inline declaration outranks a normal one — so
 * the line under the pointer stayed exactly the grey it already was.
 */

const EDGE = '.react-flow__edge[data-id*="edge-MessageOn__"]'
const NODE = '.react-flow__node[data-id="workspace:fixture:class.Ticket"]'

test('comment mode paints the relationship under the pointer, and lets go on Esc', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse the panel' }).click()

  const path = page.locator(`${EDGE} .react-flow__edge-path`)
  await expect(path).toHaveCount(1)
  const paint = () =>
    path
      .evaluate((el) => {
        const style = getComputedStyle(el)
        return { stroke: style.stroke, width: style.strokeWidth }
      })
      .catch(() => null)

  // The accent, read off a throwaway path painted with the token — a literal here would only
  // prove the stroke matches a colour this file made up.
  const primary = await page.evaluate(() => {
    const svg = document.querySelector('.react-flow__edges')
    if (!svg) return null
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    probe.setAttribute('style', 'stroke: var(--color-primary)')
    svg.append(probe)
    const stroke = getComputedStyle(probe).stroke
    probe.remove()
    return stroke
  })
  expect(primary).toBeTruthy()

  const atRest = await paint()
  expect(atRest!.stroke).not.toBe(primary)

  // Hovering it OUTSIDE the mode changes nothing: targeting is a mode, not a rollover.
  const line = (await page.locator(`${EDGE} .react-flow__edge-interaction`).boundingBox())!
  const over = { x: line.x + line.width / 2, y: line.y + line.height / 2 }
  await page.mouse.move(over.x, over.y)
  expect(await paint()).toEqual(atRest)

  // ── in comment mode, the line under the pointer says where the pin would land ──
  await page.keyboard.press('c')
  await expect(page.getByText('Comment mode — choose a domain element')).toBeVisible()
  await page.mouse.move(over.x + 1, over.y)
  await expect.poll(paint).toEqual({ stroke: primary, width: '4px' })

  // …and a node in the same mode is outlined rather than repainted — a box round a line
  // would cover the relationships beside it.
  const node = page.locator(NODE)
  const nodeBox = (await node.boundingBox())!
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
  await expect.poll(() => node.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(primary)
  // the line it left goes back to the colour the canvas gave it
  expect(await paint()).toEqual(atRest)

  // Leaving the mode drops the call-out with it.
  await page.mouse.move(over.x, over.y)
  await expect.poll(paint).toEqual({ stroke: primary, width: '4px' })
  await page.keyboard.press('Escape')
  await expect(page.getByText('Comment mode — choose a domain element')).toHaveCount(0)
  await expect.poll(paint).toEqual(atRest)
})
