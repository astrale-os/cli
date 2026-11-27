import { autoArrange, bareOffset, drag, layoutWrite, placeOf, settled } from './arrange'
import {
  expect,
  FIXTURE_ID,
  lensButton,
  openSchema,
  restsInCanvas,
  sceneBox,
  sceneCanvas,
  test,
} from './test'

/**
 * A card goes where it is dropped and stays there: the drop is written to the Domain's
 * `.domain-studio/layout.json`, per lens, so a reload finds it where it was left and the
 * other lenses keep their own arrangement. Auto-arrange forgets the lens's placement, and
 * its Undo puts every card back.
 */

test('a dropped card stays, a reload keeps it, and Auto-arrange can be undone', async ({
  page,
  request,
}) => {
  await openSchema(page)
  const card = sceneBox(page, 'class.Team')
  await expect(card).toBeVisible()
  // nothing placed yet: there is nothing to forget
  await expect(autoArrange(page)).toBeDisabled()
  const arranged = await placeOf(page, 'class.Team', 'class.Invoice')
  await settled(page, 'class.Team')
  const screenBefore = (await card.boundingBox())!

  await drag(page, 'class.Team', 100, 80)
  // the card follows the hand exactly
  const screenAfter = (await card.boundingBox())!
  expect(Math.round(screenAfter.x - screenBefore.x)).toBe(100)
  expect(Math.round(screenAfter.y - screenBefore.y)).toBe(80)
  const dropped = await placeOf(page, 'class.Team', 'class.Invoice')
  expect(dropped).not.toEqual(arranged)
  await expect(autoArrange(page)).toBeEnabled()

  // written to the Domain, under this lens only
  const written = async () =>
    (
      (await (
        await request.get(`/api/domain/${encodeURIComponent(FIXTURE_ID)}/layout`)
      ).json()) as { lenses?: Record<string, Record<string, unknown>> }
    ).lenses ?? {}
  await expect.poll(async () => Object.keys(await written())).toEqual(['structure'])
  const placed = JSON.stringify((await written()).structure)

  await page.reload()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => placeOf(page, 'class.Team', 'class.Invoice')).toEqual(dropped)

  // another lens has its own arrangement: nothing is placed in Behavior
  await lensButton(page, 'behavior').click()
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)
  await expect(autoArrange(page)).toBeDisabled()
  await expect(autoArrange(page)).toHaveAttribute('title', /nothing is placed in this lens/)
  await lensButton(page, 'structure').click()
  await expect(card).toBeVisible()
  expect(await placeOf(page, 'class.Team', 'class.Invoice')).toEqual(dropped)

  // Auto-arrange forgets the placement, on screen and in the Domain; its Undo restores both
  const forgotten = layoutWrite(page, 'reset')
  await autoArrange(page).click()
  const toast = page.getByText('Structure is arranged automatically again')
  await expect(toast).toBeVisible()
  await expect.poll(() => placeOf(page, 'class.Team', 'class.Invoice')).toEqual(arranged)
  expect((await forgotten).ok()).toBe(true)
  expect((await written()).structure).toBeUndefined()
  const restored = layoutWrite(page, 'set')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => placeOf(page, 'class.Team', 'class.Invoice')).toEqual(dropped)

  // and the restored placement is written back, and is the one a reload finds
  expect((await restored).ok()).toBe(true)
  expect(JSON.stringify((await written()).structure)).toBe(placed)
  await page.reload()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => placeOf(page, 'class.Team', 'class.Invoice')).toEqual(dropped)
})

/*
 * The canvas draws once the Domain's saved arrangement is read, so a slow layout read (a busy
 * disk, a busy server) delays the first drawing instead of drawing the automatic one first.
 */
test('a reload draws the saved arrangement first, never the automatic one', async ({ page }) => {
  await openSchema(page)
  const arranged = await placeOf(page, 'class.Team', 'class.Invoice')
  const placed = layoutWrite(page, 'set')
  await drag(page, 'class.Team', 100, 80)
  const dropped = await placeOf(page, 'class.Team', 'class.Invoice')
  expect(dropped).not.toEqual(arranged)
  expect((await placed).ok()).toBe(true)

  await page.route('**/api/domain/*/layout', async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 1500))
    await route.continue()
  })
  await page.reload()
  await expect(sceneBox(page, 'class.Team')).toBeVisible({ timeout: 60_000 })
  // the first drawing already has the card where it was left
  expect(await placeOf(page, 'class.Team', 'class.Invoice')).toEqual(dropped)
})

/*
 * The first drawing after a reload is the saved arrangement, so the frame fitted to it holds
 * every card where the reader left it: one dropped past the edge of the automatic layout too.
 */
test('after a reload, the fitted frame holds a card dropped past the automatic layout', async ({
  page,
}) => {
  await openSchema(page)
  const zoomOut = sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Zoom out"]')
  for (let step = 0; step < 3; step++) await zoomOut.click()
  await settled(page, 'class.Team')
  // As far right as the canvas allows: past the right edge of every card.
  const dx = await sceneCanvas(page).evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    const cards = [...canvas.querySelectorAll('.scene-box[data-box-id]')]
    const card = canvas.querySelector('.scene-box[data-box-id="class.Team"]')!
    const team = card.getBoundingClientRect()
    const edge = Math.max(...cards.map((each) => each.getBoundingClientRect().right))
    const dx = bounds.right - 16 - team.right
    return team.left + dx > edge + 40 ? dx : null
  })
  expect(dx).not.toBeNull()
  const placed = layoutWrite(page, 'set')
  await drag(page, 'class.Team', dx!, 0)
  expect((await placed).ok()).toBe(true)

  // even when the saved arrangement is slow to read
  await page.route('**/api/domain/*/layout', async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 1500))
    await route.continue()
  })
  await page.reload()
  await expect(sceneBox(page, 'class.Team')).toBeVisible({ timeout: 60_000 })
  await restsInCanvas(page, sceneBox(page, 'class.Team'))
})

test('a card dropped in Behavior leaves Structure where it was', async ({ page }) => {
  await openSchema(page)
  const arranged = await placeOf(page, 'class.Payment', 'class.Invoice')
  await lensButton(page, 'behavior').click()
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)
  const before = await placeOf(page, 'class.Payment', 'module.billing')
  const { dx, dy } = await bareOffset(page, 'class.Payment')
  await drag(page, 'class.Payment', dx, dy)
  await expect.poll(() => placeOf(page, 'class.Payment', 'module.billing')).not.toEqual(before)
  await expect(autoArrange(page)).toBeEnabled()

  await lensButton(page, 'structure').click()
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible()
  expect(await placeOf(page, 'class.Payment', 'class.Invoice')).toEqual(arranged)
  await expect(autoArrange(page)).toBeDisabled()
})
