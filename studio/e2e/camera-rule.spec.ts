import { expect, lensButton, openSchema, sceneBox, sceneCanvas, test, type Page } from './test'

/**
 * The camera follows one rule (`canvas/camera.ts`): entering a lens shows it whole, or frames the
 * selection carried into it when the lens draws it; a selection the Studio framed, ended, takes
 * the camera back to where it stood, unless the reader moved it by hand meanwhile. Whatever the
 * path through select, Esc and another lens, the lens entered lies whole in the pane.
 */

/** The camera as the world is drawn: its transform, once two looks 150 ms apart agree. */
async function resting(page: Page): Promise<string> {
  const world = sceneCanvas(page).locator('.scene-world')
  let last = ''
  let rest = ''
  await expect
    .poll(
      async () => {
        const now = await world.evaluate((element) => (element as HTMLElement).style.transform)
        const still = now === last
        last = now
        if (still) rest = now
        return still
      },
      { intervals: [150] },
    )
    .toBe(true)
  return rest
}

/** Every card and band of the lens on screen lies inside the pane, once the camera rests. */
async function wholeInPane(page: Page): Promise<void> {
  await resting(page)
  const outside = await sceneCanvas(page).evaluate((pane) => {
    const bounds = pane.getBoundingClientRect()
    return [...pane.querySelectorAll<HTMLElement>('.scene-box[data-box-id], .scene-band')]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0) return false
        return (
          rect.left < bounds.left - 1 ||
          rect.top < bounds.top - 1 ||
          rect.right > bounds.right + 1 ||
          rect.bottom > bounds.bottom + 1
        )
      })
      .map((element) => element.dataset.boxId ?? element.textContent ?? '')
  })
  expect(outside).toEqual([])
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1600, height: 1000 },
]) {
  test(`select, Esc and another lens leave every lens whole in the pane, at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size)
    await openSchema(page)
    await lensButton(page, 'behavior').click()
    await wholeInPane(page)
    const atRest = await resting(page)

    // A selection framed, then ended: the camera goes back to where it stood.
    await sceneBox(page, 'class.Invoice').click()
    await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')
    await resting(page)
    await page.keyboard.press('Escape')
    await expect(sceneBox(page, 'class.Invoice')).not.toHaveAttribute('data-selected', 'true')
    expect(await resting(page)).toBe(atRest)

    // Entered with a selection the lens draws, the lens frames it; ended, the lens shows whole.
    await sceneBox(page, 'class.Invoice').click()
    await lensButton(page, 'structure').click()
    await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-selected', 'true')
    await resting(page)
    await page.keyboard.press('Escape')
    await wholeInPane(page)

    // Zoomed by hand while selected, the camera is the reader's: Esc leaves it where it is…
    await sceneBox(page, 'class.Invoice').click()
    await resting(page)
    const pane = (await sceneCanvas(page).boundingBox())!
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    await page.mouse.wheel(0, -600)
    const byHand = await resting(page)
    await page.keyboard.press('Escape')
    await expect(sceneBox(page, 'class.Invoice')).not.toHaveAttribute('data-selected', 'true')
    expect(await resting(page)).toBe(byHand)

    // …and whatever it shows, the next lens entered shows whole.
    await lensButton(page, 'rules').click()
    await wholeInPane(page)
    await lensButton(page, 'behavior').click()
    await wholeInPane(page)
  })
}
