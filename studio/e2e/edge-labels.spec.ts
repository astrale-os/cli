import {
  expect,
  indexRow,
  lensButton,
  openSchema,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
  type Page,
} from './test'

/**
 * Relationship names are placed in one canvas-wide pass: each keeps clear of every other name
 * and of every card, so names leaving the same card never pile up. At the fitted zoom they are
 * too small to read and are not drawn; zoomed in, they are. A selected relationship always says
 * its name: framed far, where no other name is drawn, its own is, at a size that reads. Closer,
 * selecting it lights its name and adds its end counts, without reshuffling the others: the
 * placement order ignores the selection. A rule's walk says the name of each relationship it
 * steps through the same way.
 */

type Placed = {
  /** the name and the line it names: several "is a" lines share a text */
  key: string
  text: string
  at: string
  end: boolean
  selected: boolean
  box: { left: number; top: number; right: number; bottom: number }
}

/** Every name the canvas draws visibly, where it stands in the world and on screen. */
const placedLabels = (page: Page): Promise<Placed[]> =>
  page.locator('.scene-labels .scene-label').evaluateAll((labels) =>
    labels
      .filter((label) => Number(getComputedStyle(label).opacity) > 0)
      .map((label) => {
        const r = label.getBoundingClientRect()
        const el = label as HTMLElement
        return {
          key: `${el.textContent ?? ''}|${el.dataset.hoverId ?? el.dataset.selectId ?? ''}`,
          text: el.textContent ?? '',
          at: el.style.transform,
          end: el.dataset.end !== undefined,
          selected: el.dataset.selected !== undefined,
          box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        }
      }),
  )

/** Every pair of visible names whose boxes overlap, and every name over a card. */
async function collisions(page: Page): Promise<string[]> {
  const labels = await placedLabels(page)
  const cards = await sceneCanvas(page)
    .locator('.scene-box[data-box-kind]:not([data-box-kind="group"])')
    .evaluateAll((boxes) =>
      boxes.map((box) => {
        const r = box.getBoundingClientRect()
        return {
          id: (box as HTMLElement).dataset.boxId!,
          box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        }
      }),
    )
  const overlap = (a: Placed['box'], b: Placed['box']) =>
    a.left < b.right - 0.5 &&
    a.right > b.left + 0.5 &&
    a.top < b.bottom - 0.5 &&
    a.bottom > b.top + 0.5
  const found: string[] = []
  for (const [index, left] of labels.entries())
    for (const right of labels.slice(index + 1))
      if (overlap(left.box, right.box)) found.push(`${left.text} × ${right.text}`)
  for (const label of labels)
    for (const card of cards)
      if (overlap(label.box, card.box)) found.push(`${label.text} over ${card.id}`)
  return found
}

test('relationship names keep clear of each other and of the cards, and the selected one reads on top', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await openSchema(page)

  // fitted, the names would be unreadable: none is drawn
  await expect(sceneCanvas(page).locator('.scene-labels .scene-label')).toHaveCount(0)
  const zoomIn = sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Zoom in"]')
  const labels = sceneCanvas(page).locator('.scene-labels .scene-label')
  for (let step = 0; step < 4 && (await labels.count()) < 4; step++) {
    await zoomIn.click()
    await page.waitForTimeout(300)
  }
  await expect.poll(() => labels.count()).toBeGreaterThan(3)
  await expect(sceneCanvas(page).locator('.scene-label', { hasText: 'SubscribedTo' })).toBeVisible()
  await expect.poll(() => collisions(page)).toEqual([])
  const before = new Map((await placedLabels(page)).map((label) => [label.key, label.at]))

  await indexRow(page, 'class.SubscribedTo').click()
  await expect(sceneLink(page, 'class.SubscribedTo').first()).toHaveAttribute(
    'data-selected',
    'true',
  )
  const selected = sceneCanvas(page).locator('.scene-label[data-selected]', {
    hasText: 'SubscribedTo',
  })
  // Framed whole, its two ends lie far apart: far, no other name is drawn, but its own is.
  await expect(sceneCanvas(page)).toHaveAttribute('data-tier', 'far')
  await expect(selected).toBeVisible()
  await expect(selected).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneCanvas(page).locator('.scene-label:not([data-selected])')).toHaveCount(0)
  // drawn to read: at least as tall on screen as a name read at 9 px
  const height = await selected.evaluate((label) => label.getBoundingClientRect().height)
  expect(height).toBeGreaterThanOrEqual((16 * 9) / 10.5)
  // the other links step back
  await expect(sceneLink(page, 'class.BilledTo').first()).toHaveAttribute('data-emphasis', 'dim')
  // nothing paints over the selected name
  const onTop = await selected.evaluate((label) => {
    const r = label.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === label || label.contains(hit)
  })
  expect(onTop).toBe(true)
  await expect.poll(() => collisions(page)).toEqual([])

  // Closer, the selected name is lit, its ends saying how many beside it; the others keep their
  // places but are not drawn while their links are dimmed: a dimmed name would float over the
  // cards the focus leaves lit.
  for (
    let step = 0;
    step < 4 && (await sceneCanvas(page).getAttribute('data-tier')) === 'far';
    step++
  ) {
    await zoomIn.click()
    await page.waitForTimeout(300)
  }
  await expect(sceneCanvas(page)).not.toHaveAttribute('data-tier', 'far')
  await expect(selected).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneCanvas(page).locator('.scene-label[data-end][data-selected]')).toHaveCount(2)
  const dimmed = sceneCanvas(page).locator('.scene-label:not([data-selected])', {
    hasText: 'BilledTo',
  })
  await expect(dimmed).toHaveCount(0)

  // and selecting reshuffled nothing: every other name stands where it stood, and still clear
  const after = await placedLabels(page)
  for (const label of after.filter((one) => !one.selected && !one.end))
    expect(label.at, `${label.text} stays put`).toBe(before.get(label.key))
  await expect.poll(() => collisions(page)).toEqual([])
  expect(pageErrors).toEqual([])
})

test('a rule’s walk says the name of each relationship it steps through, far as near', async ({
  page,
}) => {
  await openSchema(page)
  await page.keyboard.press('3')
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneCanvas(page)).not.toHaveAttribute('data-laying-out', /.*/)
  // "you are its reporter": the read rule on Ticket walks RaisedBy
  const row = sceneBox(page, 'class.Ticket').locator('[data-rule-id="class.Ticket#read"]')
  await row.click()
  await expect(row).toHaveAttribute('data-lit', 'lit')
  const zoomOut = sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Zoom out"]')
  await expect(async () => {
    await zoomOut.click()
    await expect(sceneCanvas(page)).toHaveAttribute('data-tier', 'far', { timeout: 500 })
  }).toPass()
  const names = sceneCanvas(page).locator('.scene-labels .scene-label')
  await expect(names.filter({ hasText: 'RaisedBy' })).toBeVisible()
  // far, it is the only name drawn
  await expect(names.filter({ hasNotText: 'RaisedBy' })).toHaveCount(0)
})
