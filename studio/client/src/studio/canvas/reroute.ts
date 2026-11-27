/**
 * Routes for lines whose ends no longer stand where layout put them, because the reader
 * moved one of them.
 *
 * - A line leaves and enters by the sides its two ends face each other with: left and right
 *   while there is room across between them, else top and bottom; ends that overlap are
 *   joined round their right.
 * - It runs straight where the two sides face each other level, else turns twice, its
 *   middle run moved clear of other boxes where the room between the ends allows.
 * - Lines that share a side of a box meet it apart, in the order of where they come from.
 *   Every line meets a junction at its centre.
 *
 * Pure and deterministic: the same lines between the same boxes always route the same way.
 */

import { isJunction } from '../scene/arrange'
import { type Point, type Rect, segmentCrosses } from './geometry'

/** A line to route, from its `from` box to its `to` box. */
export interface Line {
  id: string
  from: string
  to: string
}

type Side = 'left' | 'right' | 'top' | 'bottom'

/** The least straight run off a side before a line turns. */
const RUN = 24
/** Room kept from a side's corners. */
const PORT_MARGIN = 10
/** The widest gap between lines meeting one side. */
const PORT_GAP = 12
/** How finely a line's middle run is moved to clear a box. */
const NUDGE = 8
/** How far clear of a box a moved run must pass. */
const CLEARANCE = 4

const centre = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
const across = (side: Side) => side === 'left' || side === 'right'

/** The sides a line leaves `a` and enters `b` by. */
function sidesOf(a: Rect, b: Rect): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
  const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
  if (gapX >= RUN || (gapX > 0 && gapX >= gapY))
    return centre(b).x >= centre(a).x ? ['right', 'left'] : ['left', 'right']
  if (gapY > 0) return centre(b).y >= centre(a).y ? ['bottom', 'top'] : ['top', 'bottom']
  return ['right', 'right']
}

/** The stretch of a side lines may meet, as positions along it. */
function stretch(rect: Rect, side: Side, junction: boolean): [number, number] {
  const [low, length] = across(side) ? [rect.y, rect.height] : [rect.x, rect.width]
  if (junction) return [low + length / 2, low + length / 2]
  const margin = Math.min(PORT_MARGIN, length / 2)
  return [low + margin, low + length - margin]
}

function portAt(rect: Rect, side: Side, along: number): Point {
  if (side === 'left') return { x: rect.x, y: along }
  if (side === 'right') return { x: rect.x + rect.width, y: along }
  if (side === 'top') return { x: along, y: rect.y }
  return { x: along, y: rect.y + rect.height }
}

const flip = (point: Point): Point => ({ x: point.y, y: point.x })
const flipRect = (rect: Rect): Rect => ({
  x: rect.y,
  y: rect.x,
  width: rect.height,
  height: rect.width,
})
const flipSide = (side: Side): Side =>
  side === 'top' ? 'left' : side === 'bottom' ? 'right' : side === 'left' ? 'top' : 'bottom'

const clear = (points: readonly Point[], obstacles: readonly Rect[]) =>
  obstacles.every((rect) =>
    points.every((point, index) => index === 0 || !segmentCrosses(points[index - 1]!, point, rect)),
  )

/** A route between two ports on left or right sides; top and bottom ones are routed flipped. */
function acrossRoute(
  from: Point,
  fromSide: Side,
  to: Point,
  toSide: Side,
  obstacles: readonly Rect[],
): Point[] {
  if (fromSide === toSide) {
    const x = fromSide === 'right' ? Math.max(from.x, to.x) + RUN : Math.min(from.x, to.x) - RUN
    return [from, { x, y: from.y }, { x, y: to.y }, to]
  }
  if (Math.abs(from.y - to.y) < 0.5) return [from, { x: to.x, y: from.y }]
  const middle = (from.x + to.x) / 2
  const reach = Math.abs(to.x - from.x) / 2 - RUN / 2
  const turn = (x: number) => [from, { x, y: from.y }, { x, y: to.y }, to]
  if (clear(turn(middle), obstacles)) return turn(middle)
  for (let step = 1; step * NUDGE <= reach; step += 1) {
    for (const x of [middle + step * NUDGE, middle - step * NUDGE])
      if (clear(turn(x), obstacles)) return turn(x)
  }
  return turn(middle)
}

function route(
  from: Point,
  fromSide: Side,
  to: Point,
  toSide: Side,
  obstacles: readonly Rect[],
): Point[] {
  if (across(fromSide)) return acrossRoute(from, fromSide, to, toSide, obstacles)
  return acrossRoute(
    flip(from),
    flipSide(fromSide),
    flip(to),
    flipSide(toSide),
    obstacles.map(flipRect),
  ).map(flip)
}

interface End {
  line: string
  box: string
  side: Side
  /** where the line's other end stands, along this side */
  toward: number
}

export function routeLines(
  lines: readonly Line[],
  boxes: ReadonlyMap<string, Rect>,
): Map<string, Point[]> {
  const sides = new Map<string, [Side, Side]>()
  const ends = new Map<string, End[]>()
  const meet = (line: string, box: string, side: Side, other: Rect) => {
    const key = `${box}|${side}`
    const end = { line, box, side, toward: across(side) ? centre(other).y : centre(other).x }
    ends.set(key, [...(ends.get(key) ?? []), end])
  }
  for (const line of lines) {
    const a = boxes.get(line.from)
    const b = boxes.get(line.to)
    if (!a || !b || line.from === line.to) continue
    const pair = sidesOf(a, b)
    sides.set(line.id, pair)
    meet(line.id, line.from, pair[0], b)
    meet(line.id, line.to, pair[1], a)
  }

  // Where each line meets each of its sides: spread apart, in the order of where they lead.
  const along = new Map<string, number>()
  const alone = new Set<string>()
  for (const [key, group] of ends) {
    const end = group[0]!
    const rect = boxes.get(end.box)!
    const [low, high] = stretch(rect, end.side, isJunction(end.box))
    group.sort((a, b) => a.toward - b.toward || (a.line < b.line ? -1 : a.line > b.line ? 1 : 0))
    const gap = group.length > 1 ? Math.min(PORT_GAP, (high - low) / (group.length - 1)) : 0
    group.forEach((member, index) =>
      along.set(`${member.line}|${key}`, (low + high) / 2 + (index - (group.length - 1) / 2) * gap),
    )
    if (group.length === 1) alone.add(`${end.line}|${key}`)
  }

  const grown = [...boxes].map(([id, rect]): [string, Rect] => [
    id,
    {
      x: rect.x - CLEARANCE,
      y: rect.y - CLEARANCE,
      width: rect.width + CLEARANCE * 2,
      height: rect.height + CLEARANCE * 2,
    },
  ])
  const routes = new Map<string, Point[]>()
  for (const line of lines) {
    const pair = sides.get(line.id)
    if (!pair) continue
    const [fromSide, toSide] = pair
    const a = boxes.get(line.from)!
    const b = boxes.get(line.to)!
    const fromKey = `${line.id}|${line.from}|${fromSide}`
    const toKey = `${line.id}|${line.to}|${toSide}`
    let fromAt = along.get(fromKey)!
    let toAt = along.get(toKey)!
    // Two sides that face each other level, each met by this line alone: one straight run.
    if (fromSide !== toSide && alone.has(fromKey) && alone.has(toKey)) {
      const [fromLow, fromHigh] = stretch(a, fromSide, isJunction(line.from))
      const [toLow, toHigh] = stretch(b, toSide, isJunction(line.to))
      const low = Math.max(fromLow, toLow)
      const high = Math.min(fromHigh, toHigh)
      if (low <= high) fromAt = toAt = (low + high) / 2
    }
    const obstacles = grown.flatMap(([id, rect]) =>
      id === line.from || id === line.to ? [] : [rect],
    )
    routes.set(
      line.id,
      route(portAt(a, fromSide, fromAt), fromSide, portAt(b, toSide, toAt), toSide, obstacles),
    )
  }
  return routes
}
