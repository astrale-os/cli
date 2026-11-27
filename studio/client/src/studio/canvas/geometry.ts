/** The canvas's world-unit primitives, shared by layout, routes and everything they place. */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest rect holding every rect given; none for none. */
export function union(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Whether two rects overlap once each is grown by `gap` on every side; touching is not. */
export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap

/**
 * Whether the segment from `a` to `b` passes through the rect's inside (Liang–Barsky): a
 * segment along an edge, or ending on it, does not.
 */
export function segmentCrosses(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let enter = 0
  let leave = 1
  const sides: [number, number][] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ]
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q <= 0) return false
      continue
    }
    const t = q / p
    if (p < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter >= leave) return false
  }
  return true
}

/** Whether a polyline passes through the rect's inside anywhere along it. */
export const polylineCrosses = (points: readonly Point[], rect: Rect) =>
  points.some((point, index) => index > 0 && segmentCrosses(points[index - 1]!, point, rect))
