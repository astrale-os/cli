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

/** How far apart the spots tried for a rect are. */
const STEP = 24
/** How many rings of spots are tried around a rect before it goes below everything. */
const RINGS = 48

let rings: Point[] | undefined
/** The shifts tried around a spot: nearest first, and equally near, clockwise from the right. */
function ringShifts(): Point[] {
  if (rings) return rings
  const angle = (point: Point) => {
    const value = Math.atan2(point.y, point.x)
    return value < 0 ? value + 2 * Math.PI : value
  }
  const all: Point[] = []
  for (let dy = -RINGS; dy <= RINGS; dy += 1)
    for (let dx = -RINGS; dx <= RINGS; dx += 1) all.push({ x: dx * STEP, y: dy * STEP })
  all.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || angle(a) - angle(b))
  rings = all
  return all
}

/** The shift that brings `rect` to the nearest room `gap` clear of every obstacle. */
export function nearestRoom(rect: Rect, obstacles: readonly Rect[], gap: number): Point {
  for (const by of ringShifts()) {
    const moved = { ...rect, x: rect.x + by.x, y: rect.y + by.y }
    if (!obstacles.some((obstacle) => overlaps(moved, obstacle, gap))) return by
  }
  const bottom = Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height))
  return { x: 0, y: bottom + gap - rect.y }
}
