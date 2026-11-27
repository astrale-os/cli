/**
 * Arrow keys walk the canvas: from the selected box to the nearest one in the pressed
 * direction, preferring boxes straight ahead over boxes off to the side.
 */

import type { Rect } from './geometry'

export type Direction = 'left' | 'right' | 'up' | 'down'

const AXIS: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

/**
 * The id of the box to step to, or undefined when nothing lies that way. Only boxes within
 * 60° of the direction count; among them, distance ahead weighs less than distance aside.
 */
export function walk(
  from: Rect,
  candidates: ReadonlyMap<string, Rect>,
  direction: Direction,
  exclude?: string,
): string | undefined {
  const origin = centre(from)
  const axis = AXIS[direction]
  let best: { id: string; score: number } | undefined
  for (const [id, rect] of candidates) {
    if (id === exclude) continue
    const point = centre(rect)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    const ahead = dx * axis.x + dy * axis.y
    const aside = Math.abs(dx * axis.y - dy * axis.x)
    if (ahead <= 1 || aside > ahead * Math.tan(Math.PI / 3)) continue
    const score = ahead + aside * 2
    if (!best || score < best.score || (score === best.score && id < best.id)) best = { id, score }
  }
  return best?.id
}
