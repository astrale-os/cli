import {
  expect,
  FIXTURE_ID,
  inspector,
  openSchema,
  sceneBox,
  sceneCanvas,
  test,
  type Page,
} from './test'

/**
 * The frame that holds another Domain's Classes is furniture you move: grab it by its name and
 * drag it, and its Classes travel with it, keeping their places inside it. Cards it lands on make
 * room. Where it is dropped is where it stays, across a reload included. Moving it selects
 * nothing.
 */

const FRAME = 'domain.payments.studio-demo.astrale.ai'
const MEMBERS = [
  'class.payments.studio-demo.astrale.ai:class.PaymentProcessor',
  'class.payments.studio-demo.astrale.ai:class.Payout',
]

/** Where each card stands in the world. */
const worldOf = (page: Page, id: string) =>
  sceneBox(page, id).evaluate((el) => {
    const transform = new DOMMatrixReadOnly((el as HTMLElement).style.transform)
    return { x: Math.round(transform.m41), y: Math.round(transform.m42) }
  })

test('a frame of another Domain drags as one by its name, and stays where it is dropped', async ({
  page,
  request,
}) => {
  await openSchema(page)
  const frame = sceneCanvas(page).locator(`[data-region-id="${FRAME}"]`)
  await expect(frame).toBeVisible()
  const before = await Promise.all(MEMBERS.map((id) => worldOf(page, id)))

  const label = (await frame.locator('.scene-region-label').boundingBox())!
  const grab = { x: label.x + 5, y: label.y + label.height / 2 }
  // towards the middle of the canvas, so the drop stays on it
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x - 80, grab.y + 40, { steps: 8 })
  await page.mouse.up()

  // every member moved by the same amount, so the frame kept its inside
  const after = await Promise.all(MEMBERS.map((id) => worldOf(page, id)))
  const shift = { x: after[0]!.x - before[0]!.x, y: after[0]!.y - before[0]!.y }
  expect(Math.abs(shift.x) + Math.abs(shift.y)).toBeGreaterThan(40)
  for (const [index, moved] of after.entries()) {
    expect(Math.abs(moved.x - before[index]!.x - shift.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(moved.y - before[index]!.y - shift.y)).toBeLessThanOrEqual(1)
  }
  // what it was dropped near made room: no card of the Schema sits inside the frame
  await expect
    .poll(() =>
      frame.evaluate((region, members) => {
        const r = region.getBoundingClientRect()
        return [...document.querySelectorAll<HTMLElement>('.scene-box[data-box-id]')]
          .filter((box) => !members.includes(box.dataset.boxId!))
          .filter((box) => {
            const b = box.getBoundingClientRect()
            return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
          })
          .map((box) => box.dataset.boxId)
      }, MEMBERS),
    )
    .toEqual([])
  await expect(inspector(page)).toHaveCount(0)

  // the drop is written to the Domain, and a reload draws the frame where it was left
  await expect
    .poll(async () => {
      const layout = (await (
        await request.get(`/api/domain/${encodeURIComponent(FIXTURE_ID)}/layout`)
      ).json()) as { lenses?: Record<string, Record<string, unknown>> }
      return JSON.stringify(layout.lenses?.structure ?? {})
    })
    .toContain('PaymentProcessor')
  await page.reload()
  await expect(sceneBox(page, MEMBERS[0]!)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => Promise.all(MEMBERS.map((id) => worldOf(page, id)))).toEqual(after)
})
