import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Searching for a RELATIONSHIP and getting an answer on the canvas.
 *
 * Classes were always findable; relationships were listed by the palette but picking one
 * left the reader nowhere — the canvas never moved to the line, every card faded against a
 * focus pinned on a node that does not exist (a relationship is drawn as a line), and the
 * two classes it runs between were not called out at all. This drives the whole path:
 * a relationship parked off-screen, found by name, brought in, and read.
 */

const RELATIONSHIP = 'SubscribedTo'
/** The two classes `SubscribedTo` runs between, in the fixture's `crm` domain. */
const ENDPOINTS = ['workspace:fixture:class.Company', 'workspace:fixture:class.Subscription']
/** A class deliberately far from either end — zooming into it is what parks the relationship. */
const ELSEWHERE = 'workspace:fixture:class.Product'

function node(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

/** Is the whole node inside the canvas pane? A card half under the detail panel is a card
 *  the reader cannot read, so this is the question a jump has to answer with `true`. */
async function insidePane(page: Page, locator: Locator): Promise<boolean> {
  const pane = await page.getByTestId('workspace-schema-canvas').boundingBox()
  const box = await locator.boundingBox().catch(() => null)
  if (!pane || !box) return false
  return (
    box.x >= pane.x &&
    box.y >= pane.y &&
    box.x + box.width <= pane.x + pane.width &&
    box.y + box.height <= pane.y + pane.height
  )
}

test('⌘K finds a relationship, brings it into view and paints it over its two ends', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  // Dock the work panel to a side and collapse it, so the canvas owns the window: where the
  // panel lives is another spec's subject, and a floating dock over the pane is not this one's.
  await page.addInitScript(() => localStorage.setItem('studio.panelSide', 'left'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse the panel' }).click()

  const relationship = page.locator(`.react-flow__edge[data-id*="edge-${RELATIONSHIP}__"]`)
  await expect(relationship).toHaveCount(1)
  const company = node(page, ENDPOINTS[0]!)
  const subscription = node(page, ENDPOINTS[1]!)
  await expect(company).toBeVisible()

  // Park it: zoom hard into a class at the other end of the schema until one end of the
  // relationship has left the pane. Asserted rather than assumed — a jump to something
  // already in front of the reader proves nothing about jumping.
  const anchor = await node(page, ELSEWHERE).boundingBox()
  await page.mouse.move(anchor!.x + anchor!.width / 2, anchor!.y + anchor!.height / 2)
  for (let step = 0; step < 24 && (await insidePane(page, company)); step += 1) {
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(50)
  }
  expect(await insidePane(page, company)).toBe(false)

  // ── the search itself ──
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByPlaceholder('Search the schema…')).toBeVisible()
  await page.keyboard.type(RELATIONSHIP)
  // listed as a relationship, with the two classes it runs between
  await expect(
    page.getByRole('option', { name: `${RELATIONSHIP} (Company → Subscription)` }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByPlaceholder('Search the schema…')).toHaveCount(0)

  // …and the canvas answers with the WHOLE relationship: both ends in the pane, backing the
  // zoom off if that is what it takes to hold a line this long.
  await expect.poll(() => insidePane(page, company)).toBe(true)
  await expect.poll(() => insidePane(page, subscription)).toBe(true)

  // The line reads as picked: the accent colour, at the selected width. Read off a throwaway
  // path painted with the token rather than written down here — a literal would only prove the
  // stroke matches a colour this file made up.
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
  await expect
    .poll(() =>
      relationship
        .locator('.react-flow__edge-path')
        .evaluate((path) => {
          const style = getComputedStyle(path)
          return { stroke: style.stroke, width: style.strokeWidth }
        })
        .catch(() => null),
    )
    .toEqual({ stroke: primary, width: '3px' })
  await expect(relationship).toHaveClass(/is-selected/)

  // …its two ends are called out…
  await expect(company).toHaveClass(/is-edge-endpoint/)
  await expect(subscription).toHaveClass(/is-edge-endpoint/)

  // …and NOTHING is faded. Focus dims what a selected node is not wired to; a relationship
  // has no node to hang that off, and pinning it on the edge's own name used to grey out the
  // entire canvas — the two cards the reader came to see along with everything else.
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(0)
  await expect(page.locator('.react-flow__edge.is-dimmed')).toHaveCount(0)

  // The panel opens on the relationship, not on one of its ends.
  await expect(page.getByRole('heading', { name: RELATIONSHIP, exact: true })).toBeVisible()

  expect(pageErrors).toEqual([])
})
