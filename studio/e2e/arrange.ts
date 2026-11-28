/**
 * Arranging a Scene canvas by hand, as a reader does: drag a card by its header onto bare canvas,
 * read where cards stand from one another, and watch the layout writes the page sends.
 */
import { expect, sceneBox, sceneCanvas, type Page } from './test'

/**
 * A card's place in the world, from another card's. Not on screen: the camera refits on reload
 * and on a lens switch, and the world itself may be rebased by a uniform shift — only where
 * cards stand from one another is what the reader arranged. Read once both cards are placed: a
 * card drawn before the layout answers has no place yet.
 */
export const placeOf = async (page: Page, id: string, from: string) => {
  const placed = await page.waitForFunction(
    ([id, from]) => {
      const at = (box: string) => {
        const el = document.querySelector<HTMLElement>(
          `.scene-world .scene-box[data-box-id="${box}"]`,
        )
        const match = el && /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform)
        return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined
      }
      const [card, reference] = [at(id!), at(from!)]
      return card && reference
        ? { x: Math.round(card.x - reference.x), y: Math.round(card.y - reference.y) }
        : undefined
    },
    [id, from],
  )
  return (await placed.jsonValue()) as { x: number; y: number }
}

/** Wait until a card stops moving on screen: the camera eases into place after a lens switch. */
export async function settled(page: Page, id: string) {
  let last = ''
  await expect
    .poll(
      async () => {
        const box = await sceneBox(page, id).boundingBox()
        const now = JSON.stringify(box && [box.x, box.y, box.width, box.height].map(Math.round))
        const still = now === last
        last = now
        return still
      },
      { intervals: [100] },
    )
    .toBe(true)
}

/** Drag a card by its header, by a screen offset, the way a hand does. */
export async function drag(page: Page, id: string, dx: number, dy: number) {
  await settled(page, id)
  const box = (await sceneBox(page, id).locator('.scene-box-header').boundingBox())!
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

/**
 * An offset that drops the card on bare canvas: inside the canvas, clear of the chrome and of
 * every other card. A drop onto another card stacks it, by design, so the test picks its spot
 * rather than trusting where the lens happens to lay things out: straight down, up or across
 * first, else in any direction, nearest first — a map fitted to its pane may leave bare canvas
 * only diagonally from the card.
 */
export async function bareOffset(page: Page, id: string): Promise<{ dx: number; dy: number }> {
  return sceneCanvas(page).evaluate((canvas, id) => {
    const bounds = canvas.getBoundingClientRect()
    const card = canvas.querySelector(`.scene-box[data-box-id="${id}"]`)!.getBoundingClientRect()
    const others = [...canvas.querySelectorAll('.scene-box[data-box-id], [data-canvas-chrome]')]
      .filter((element) => (element as HTMLElement).dataset.boxId !== id)
      .map((element) => element.getBoundingClientRect())
    const margin = 24
    const straight = [160, 240, 320].flatMap((distance) => [
      [0, distance],
      [0, -distance],
      [-distance, 0],
      [distance, 0],
      [-distance, distance],
    ])
    const around = [160, 200, 240, 280, 320, 360, 400].flatMap((distance) =>
      Array.from({ length: 16 }, (_, step) => {
        const angle = (step * Math.PI) / 8
        return [Math.round(distance * Math.cos(angle)), Math.round(distance * Math.sin(angle))]
      }),
    )
    for (const [dx, dy] of [...straight, ...around] as [number, number][]) {
      const moved = {
        left: card.left + dx - margin,
        right: card.right + dx + margin,
        top: card.top + dy - margin,
        bottom: card.bottom + dy + margin,
      }
      const inside =
        moved.left >= bounds.left &&
        moved.right <= bounds.right &&
        moved.top >= bounds.top &&
        moved.bottom <= bounds.bottom - 96 // the agent bar floats over the canvas's foot
      const clear = others.every(
        (rect) =>
          rect.right <= moved.left ||
          rect.left >= moved.right ||
          rect.bottom <= moved.top ||
          rect.top >= moved.bottom,
      )
      if (inside && clear) return { dx, dy }
    }
    throw new Error(`no bare canvas to drop ${id} on`)
  }, id)
}

/** The answer to the next layout write the page sends of this kind (`set`, `reset`). */
export const layoutWrite = (page: Page, action: 'set' | 'reset') =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/layout') &&
      response.request().postDataJSON()?.action === action,
  )

export const autoArrange = (page: Page) =>
  sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Auto-arrange"]')
