import { dockWorkspacePanel, expect, test, type Page } from './test'

/**
 * Edge labels share one portal layer. Each used to be placed on its own, clear of the cards but
 * blind to every other label, so relationships leaving the same card stacked their names into an
 * unreadable pile, and a selected relationship's name could sit UNDER a neighbour's. Labels are
 * now placed in one canvas-wide pass, and a selected edge lifts its labels above the rest.
 */

const RELATIONSHIP = 'SubscribedTo'

/** Every pair of visible edge labels whose boxes overlap, named by their text. */
async function overlappingLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('.schema-edge-label')]
      .filter((label) => getComputedStyle(label).visibility === 'visible')
      .map((label) => ({ text: label.textContent ?? '', box: label.getBoundingClientRect() }))
    const pairs: string[] = []
    for (const [index, left] of labels.entries()) {
      for (const right of labels.slice(index + 1)) {
        if (
          left.box.left < right.box.right &&
          left.box.right > right.box.left &&
          left.box.top < right.box.bottom &&
          left.box.bottom > right.box.top
        ) {
          pairs.push(`${left.text} × ${right.text}`)
        }
      }
    }
    return pairs
  })
}

test('edge labels keep clear of each other, and the selected one reads on top', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse the panel' }).click()

  const labels = page.locator('.schema-edge-label:not(.schema-edge-cardinality)')
  await expect.poll(() => labels.count()).toBeGreaterThan(3)
  await expect.poll(() => overlappingLabels(page)).toEqual([])

  const edge = page.locator(`.react-flow__edge[data-id*="edge-${RELATIONSHIP}__"]`)
  const edgeId = await edge.getAttribute('data-id')
  await edge.locator('.react-flow__edge-interaction').click({ force: true })
  await expect(edge).toHaveClass(/is-selected/)

  const selectedLabel = page.locator(`.schema-edge-label[data-edge-id="${edgeId}"]`).first()
  await expect(selectedLabel).toHaveClass(/is-selected/)
  const stacking = await page.evaluate((id) => {
    const zIndex = (label: Element) => Number(getComputedStyle(label).zIndex) || 0
    const all = [...document.querySelectorAll('.schema-edge-label')]
    const own = all.filter((label) => label.getAttribute('data-edge-id') === id)
    const others = all.filter((label) => label.getAttribute('data-edge-id') !== id)
    return {
      selected: Math.min(...own.map(zIndex)),
      others: Math.max(0, ...others.map(zIndex)),
    }
  }, edgeId)
  expect(stacking.selected).toBeGreaterThan(stacking.others)

  // Selecting must not reshuffle the canvas: the layout order ignores selection.
  await expect.poll(() => overlappingLabels(page)).toEqual([])

  expect(pageErrors).toEqual([])
})
