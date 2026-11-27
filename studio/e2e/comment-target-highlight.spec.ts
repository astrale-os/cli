import { expect, FIXTURE_ID, openSchema, sceneBox, sceneLink, test } from './test'

/**
 * Comment mode calls out what the next click would pin to.
 *
 * A card takes an outline; a RELATIONSHIP takes its own line thickened and painted instead,
 * because a box drawn round a line would cover its neighbours and you could no longer tell
 * which relationship the pin would land on. Outside the mode, pointing changes nothing:
 * targeting is a mode, not a rollover.
 */

test('comment mode paints its target until the comment is sent, and lets go on Esc', async ({
  page,
  request,
}) => {
  await openSchema(page)
  const link = sceneLink(page, 'class.MessageOn')
  const stroke = link.locator('.scene-link-stroke')
  await expect(stroke).toHaveCount(1)
  const paint = () =>
    stroke
      .evaluate((el) => {
        const style = getComputedStyle(el)
        return { stroke: style.stroke, width: parseFloat(style.strokeWidth) }
      })
      .catch(() => null)

  // The accent, read off a throwaway path painted with the token: a literal here would only
  // prove the stroke matches a colour this file made up.
  const primary = await page.evaluate(() => {
    const svg = document.querySelector('.scene-canvas svg')
    if (!svg) return null
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    probe.setAttribute('style', 'stroke: var(--color-primary)')
    svg.append(probe)
    const color = getComputedStyle(probe).stroke
    probe.remove()
    return color
  })
  expect(primary).toBeTruthy()

  const atRest = (await paint())!
  expect(atRest.stroke).not.toBe(primary)

  // a point ON the line, in page coordinates: the middle of the hit path
  const over = await link.locator('.scene-link-hit').evaluate((el) => {
    const path = el as SVGPathElement
    const at = path.getPointAtLength(path.getTotalLength() / 2)
    const matrix = path.getScreenCTM()!
    return {
      x: at.x * matrix.a + at.y * matrix.c + matrix.e,
      y: at.x * matrix.b + at.y * matrix.d + matrix.f,
    }
  })

  // hovering it OUTSIDE the mode lights it in its own tone, never as a target
  await page.mouse.move(over.x, over.y)
  await page.waitForTimeout(200)
  expect((await paint())!.stroke).not.toBe(primary)
  await expect(page.locator('[data-comment-target]')).toHaveCount(0)

  // ── in comment mode, the line under the pointer says where the pin would land ──
  await page.keyboard.press('c')
  await expect(page.getByText('Comment mode — choose a domain element')).toBeVisible()
  await page.mouse.move(over.x + 1, over.y)
  await expect(link).toHaveAttribute('data-comment-target', '')
  await expect.poll(async () => (await paint())?.stroke).toBe(primary)
  expect((await paint())!.width).toBeGreaterThan(atRest.width)

  // …and a card in the same mode is outlined rather than repainted
  const ticket = sceneBox(page, 'class.Ticket')
  const card = (await ticket.boundingBox())!
  const centre = { x: card.x + card.width / 2, y: card.y + card.height / 2 }
  await page.mouse.move(centre.x, centre.y)
  await expect(ticket).toHaveAttribute('data-comment-target', '')
  await expect.poll(() => ticket.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(primary)
  // the line it left goes back to the colour the canvas gave it
  await expect.poll(async () => (await paint())?.stroke).toBe(atRest.stroke)

  // Clicking hands the call-out to the composer: the note still visibly points to this card
  // even though targeting itself has ended.
  await page.mouse.click(centre.x, centre.y)
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await expect(ticket).toHaveAttribute('data-comment-draft-target', '')
  await expect.poll(() => ticket.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(primary)

  await composer.fill('Keep this target visible')
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/domain/${FIXTURE_ID}/comments`,
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const comment = (await (await posted).json()) as {
    id: string
    anchorRefs: Array<{ ref: string; kind: string }>
  }
  expect(comment.anchorRefs).toEqual([expect.objectContaining({ ref: 'class.Ticket' })])
  await expect(composer).toHaveCount(0)
  await expect(ticket).not.toHaveAttribute('data-comment-draft-target', '')

  // the card now carries its thread, and opening it says who spoke
  const pin = ticket.locator('button[title="View comments"]')
  await expect(pin).toHaveText('1')
  await pin.click()
  const thread = page
    .locator('[data-radix-popper-content-wrapper]')
    .filter({ hasText: 'Keep this target visible' })
  await expect(thread.getByText('You', { exact: true })).toBeVisible()
  await thread.getByRole('button', { name: 'Close' }).click()
  await expect(thread).toHaveCount(0)

  // Leaving the mode drops the call-out with it.
  await page.keyboard.press('c')
  await expect(page.getByText('Comment mode — choose a domain element')).toBeVisible()
  await page.mouse.move(over.x, over.y)
  await expect.poll(async () => (await paint())?.stroke).toBe(primary)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Comment mode — choose a domain element')).toHaveCount(0)
  await expect(page.locator('[data-comment-target]')).toHaveCount(0)
  await page.mouse.move(2, 2)
  await expect.poll(async () => (await paint())?.stroke).toBe(atRest.stroke)
  await expect.poll(async () => (await paint())?.width).toBe(atRest.width)

  const cleanup = await request.post(`/api/domain/${FIXTURE_ID}/comments`, {
    data: { action: 'delete', id: comment.id },
  })
  expect(cleanup.ok()).toBe(true)
})
