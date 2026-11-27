/**
 * The reader's layout, kept over the automatic one. A pin is where the reader put a box: its
 * top-left in world units, keyed by box id — a card by its node, a junction by its id, a
 * module by its group. A module's pin is the corner of its box while it is collapsed and of
 * its members while it is open, so the members follow wherever the module was moved.
 *
 * - A pinned box stands where it was put.
 * - A box never placed keeps its automatic place beside its placed neighbours, in the
 *   nearest free room: nothing placed moves to make room for it. A module whose members
 *   were never placed opens where its box stood.
 * - Boxes that would overlap — cards grown near, members back from a module collapsed
 *   meanwhile — stack downward; their pins stay as they were.
 * - A line whose two ends moved together keeps its laid-out route; any other is routed again
 *   between where its ends now stand.
 *
 * Pure and deterministic: the same placement and pins always settle the same way.
 */

import type { Arrangement } from '../scene/arrange'

import { bandHeadings } from './columns'
import { overlaps, type Point, polylineCrosses, type Rect, union } from './geometry'
import { boundsOf, type Placement, REGION_PAD, REGION_TOP, routeEnds, spokeOf } from './layout'
import { type Line, routeLines } from './reroute'

export type Pins = ReadonlyMap<string, Point>

export interface Pinned {
  placement: Placement
  /**
   * Every drawn box's corner and every open module's, before stacking: what placing any of
   * them records, so nothing else moves when one does.
   */
  pins: Map<string, Point>
}

export interface PinOptions {
  /** Stack overlapping boxes downward. Off while the reader drags, so nothing jumps aside. */
  stack?: boolean
}

/** The least room kept around a box placed beside placed ones. */
const ROOM = 28
/** The least room kept around a box the reader let go of. */
const DROP_ROOM = 12
/** How far apart the spots tried for a box are. */
const STEP = 24
/** How many rings of spots are tried around a box before it goes below everything. */
const RINGS = 48
/** The gap left above a box stacked under another. */
const STACK_GAP = 20
/** Shifts closer than this are the same shift. */
const SAME = 0.5

const ORIGIN: Point = { x: 0, y: 0 }
const plus = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME
const cornerAt = (rect: Rect, corner: Point): Rect => ({ ...rect, x: corner.x, y: corner.y })
const shifted = (rect: Rect, by: Point): Rect => ({ ...rect, x: rect.x + by.x, y: rect.y + by.y })
const centre = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
const mean = (points: readonly Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})
const cornerOf = (points: readonly Point[]): Point | undefined =>
  points.length === 0
    ? undefined
    : {
        x: Math.min(...points.map((point) => point.x)),
        y: Math.min(...points.map((point) => point.y)),
      }
const inner = (rect: Rect, inset: number): Rect => ({
  x: rect.x + inset,
  y: rect.y + inset,
  width: rect.width - inset * 2,
  height: rect.height - inset * 2,
})

/** A module's frame around its members' boxes, padded as layout pads it. */
export function regionFrame(members: readonly Rect[]): Rect | undefined {
  const box = union(members)
  if (!box) return undefined
  return {
    x: box.x - REGION_PAD,
    y: box.y - REGION_TOP,
    width: box.width + REGION_PAD * 2,
    height: box.height + REGION_TOP + REGION_PAD,
  }
}

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
    const moved = shifted(rect, by)
    if (!obstacles.some((obstacle) => overlaps(moved, obstacle, gap))) return by
  }
  const bottom = Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height))
  return { x: 0, y: bottom + gap - rect.y }
}

/** Each item's downward shift once overlapping items stack, the higher one staying put. */
function stackDown(items: readonly { id: string; rect: Rect }[]): Map<string, number> {
  const sorted = items
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.index - b.index)
  const standing: Rect[] = []
  const shifts = new Map<string, number>()
  for (const item of sorted) {
    let rect = item.rect
    for (
      let blocked = standing.find((other) => overlaps(rect, other));
      blocked;
      blocked = standing.find((other) => overlaps(rect, other))
    )
      rect = { ...rect, y: blocked.y + blocked.height + STACK_GAP }
    standing.push(rect)
    shifts.set(item.id, rect.y - item.rect.y)
  }
  return shifts
}

/** Each box's linked boxes: the other ends of its trunks and fans. */
function linksOf(arrangement: Arrangement): Map<string, string[]> {
  const linked = new Map<string, string[]>()
  const add = (from: string, to: string) => {
    if (from === to) return
    const list = linked.get(from)
    if (!list) linked.set(from, [to])
    else if (!list.includes(to)) list.push(to)
  }
  for (const [, from, to] of [
    ...routeEnds(arrangement),
    ...arrangement.ribbons.map((ribbon) => [ribbon.id, ribbon.from, ribbon.to] as const),
  ]) {
    add(from, to)
    add(to, from)
  }
  return linked
}

interface Drawn {
  /** drawn box ids, in arrangement order */
  boxes: string[]
  /** open modules and their drawn members */
  regions: { id: string; members: string[] }[]
  /** drawn boxes no module holds */
  loose: string[]
}

function drawnOf(placement: Placement, arrangement: Arrangement): Drawn {
  const boxes = arrangement.boxes.map((box) => box.id).filter((id) => placement.boxes.has(id))
  const regions = arrangement.regions
    .map((region) => ({
      id: region.id,
      members: region.members.filter((id) => placement.boxes.has(id)),
    }))
    .filter((region) => region.members.length > 0)
  const held = new Set(regions.flatMap((region) => region.members))
  return { boxes, regions, loose: boxes.filter((id) => !held.has(id)) }
}

/** The pins that record a placement as it stands: every box's corner, every module's. */
function pinsOf(drawn: Drawn, corners: ReadonlyMap<string, Point>): Map<string, Point> {
  const pins = new Map<string, Point>()
  for (const id of drawn.boxes) pins.set(id, corners.get(id)!)
  for (const region of drawn.regions)
    pins.set(region.id, cornerOf(region.members.map((id) => corners.get(id)!))!)
  return pins
}

/** The automatic placement with the reader's pins applied, and the pins that record it. */
export function pinPlacement(
  auto: Placement,
  arrangement: Arrangement,
  pins: Pins,
  options: PinOptions = {},
): Pinned {
  const drawn = drawnOf(auto, arrangement)
  const laid = (id: string) => auto.boxes.get(id)!
  const touched =
    drawn.boxes.some((id) => pins.has(id)) || drawn.regions.some((region) => pins.has(region.id))
  if (!touched) {
    const corners = new Map(drawn.boxes.map((id) => [id, { x: laid(id).x, y: laid(id).y }]))
    return { placement: auto, pins: pinsOf(drawn, corners) }
  }

  // Where the pins put each box. Members of an open module move with the module's pin.
  const placed = new Map<string, Point>()
  for (const region of drawn.regions) {
    const members = region.members.filter((id) => pins.has(id))
    const from = cornerOf(members.map((id) => pins.get(id)!))
    if (!from) continue
    const by = minus(pins.get(region.id) ?? from, from)
    for (const id of members) placed.set(id, plus(pins.get(id)!, by))
  }
  for (const id of drawn.loose) {
    const pin = pins.get(id)
    if (pin) placed.set(id, pin)
  }

  const rectOf = (id: string) => cornerAt(laid(id), placed.get(id)!)
  const shiftOf = (id: string) => minus(placed.get(id)!, laid(id))
  const order = new Map(drawn.boxes.map((id, index) => [id, index]))
  /**
   * A module's frame as it is drawn around `members` standing at `shift` from their laid-out
   * places: its laid-out frame moved with them when they all moved together, else a frame
   * around them. What makes room for a module makes room for this frame.
   */
  const frameOf = (region: string, members: readonly string[], shift: (id: string) => Point) => {
    const frame = auto.regions.get(region)
    const all = drawn.regions.find((candidate) => candidate.id === region)?.members ?? []
    const by = members.length > 0 ? shift(members[0]!) : ORIGIN
    return frame && members.length === all.length && members.every((id) => same(shift(id), by))
      ? shifted(frame, by)
      : regionFrame(members.map((id) => shifted(laid(id), shift(id))))!
  }

  // Boxes never placed, a block at a time in arrangement order: a module's unplaced members
  // together, every other box alone.
  const blocks: { ids: string[]; region?: string; whole: boolean }[] = []
  for (const region of drawn.regions) {
    const ids = region.members.filter((id) => !placed.has(id))
    if (ids.length > 0)
      blocks.push({ ids, region: region.id, whole: ids.length === region.members.length })
  }
  for (const id of drawn.loose) if (!placed.has(id)) blocks.push({ ids: [id], whole: false })
  blocks.sort((a, b) => order.get(a.ids[0]!)! - order.get(b.ids[0]!)!)

  const linked = linksOf(arrangement)
  const obstaclesFor = (home?: string): Rect[] => {
    const rects = drawn.loose.filter((id) => placed.has(id)).map(rectOf)
    for (const region of drawn.regions) {
      const members = region.members.filter((id) => placed.has(id)).map(rectOf)
      if (members.length === 0) continue
      if (region.id === home) rects.push(...members)
      else
        rects.push(
          frameOf(
            region.id,
            region.members.filter((id) => placed.has(id)),
            shiftOf,
          ),
        )
    }
    return rects
  }
  for (const block of blocks) {
    const own = new Set(block.ids)
    const rects = block.ids.map(laid)
    const modulePin = block.whole && block.region ? pins.get(block.region) : undefined
    let by = ORIGIN
    if (modulePin) by = minus(modulePin, cornerOf(rects)!)
    else {
      const region = block.region
        ? drawn.regions.find((candidate) => candidate.id === block.region)
        : undefined
      const siblings = region?.members.filter((id) => placed.has(id)) ?? []
      const neighbours =
        siblings.length > 0
          ? siblings
          : [...new Set(block.ids.flatMap((id) => linked.get(id) ?? []))].filter(
              (id) => !own.has(id) && placed.has(id),
            )
      if (neighbours.length > 0) by = mean(neighbours.map(shiftOf))
      else {
        const from = centre(union(rects)!)
        let nearest: { id: string; distance: number } | undefined
        for (const id of placed.keys()) {
          const at = centre(laid(id))
          const distance = Math.hypot(at.x - from.x, at.y - from.y)
          if (!nearest || distance < nearest.distance) nearest = { id, distance }
        }
        if (nearest) by = shiftOf(nearest.id)
      }
    }
    const moved = rects.map((rect) => shifted(rect, by))
    // A module opens where its box stood, and what it covers stacks below it; any other
    // block comes in at the nearest room clear of what is placed.
    const shape = block.whole ? frameOf(block.region!, block.ids, () => by) : union(moved)!
    const room = modulePin
      ? ORIGIN
      : nearestRoom(shape, obstaclesFor(block.whole ? undefined : block.region), ROOM)
    block.ids.forEach((id, index) => placed.set(id, plus(moved[index]!, room)))
  }

  const recorded = pinsOf(drawn, placed)
  if (options.stack !== false) {
    // Members stack within their module first, then modules and loose boxes among each other.
    for (const region of drawn.regions) {
      const shifts = stackDown(region.members.map((id) => ({ id, rect: rectOf(id) })))
      for (const [id, dy] of shifts)
        if (dy !== 0) placed.set(id, plus(placed.get(id)!, { x: 0, y: dy }))
    }
    const shifts = stackDown([
      ...drawn.loose.map((id) => ({ id, rect: rectOf(id) })),
      ...drawn.regions.map((region) => ({
        id: region.id,
        rect: frameOf(region.id, region.members, shiftOf),
      })),
    ])
    for (const [id, dy] of shifts) {
      if (dy === 0) continue
      const region = drawn.regions.find((candidate) => candidate.id === id)
      for (const member of region ? region.members : [id])
        placed.set(member, plus(placed.get(member)!, { x: 0, y: dy }))
    }
  }

  const boxes = new Map(drawn.boxes.map((id) => [id, rectOf(id)]))
  const regions = new Map<string, Rect>()
  for (const region of drawn.regions)
    regions.set(region.id, frameOf(region.id, region.members, shiftOf))

  const routes = new Map<string, Point[]>()
  const again: Line[] = []
  const fans = new Map(arrangement.fans.map((fan) => [fan.id, fan]))
  for (const [id, from, to] of routeEnds(arrangement)) {
    const route = auto.routes.get(id)
    if (!route || !boxes.has(from) || !boxes.has(to)) continue
    const by = shiftOf(from)
    if (same(by, shiftOf(to))) {
      const kept = route.map((point) => plus(point, by))
      // Only a box that moved apart from both ends can now stand across the route.
      const crossed =
        from !== to &&
        drawn.boxes.some(
          (other) =>
            other !== from &&
            other !== to &&
            !same(shiftOf(other), by) &&
            polylineCrosses(kept, inner(boxes.get(other)!, 2)),
        )
      if (!crossed) {
        routes.set(id, kept)
        continue
      }
    }
    const fan = fans.get(id)
    const spoke = fan ? spokeOf(fan.junction, fan.box, boxes) : undefined
    if (fan && spoke) routes.set(id, fan.inward ? spoke.reverse() : spoke)
    else again.push({ id, from, to })
  }
  for (const [id, route] of routeLines(again, boxes)) routes.set(id, route)

  return {
    placement: {
      ...auto,
      boxes,
      regions,
      routes,
      bounds: boundsOf(
        [
          ...boxes.values(),
          ...regions.values(),
          ...bandHeadings(arrangement, boxes).map((heading) => heading.rect),
        ],
        routes.values(),
      ),
    },
    pins: recorded,
  }
}

/** How many boxes making room for one drop are moved, at most, before the rest stack. */
const SETTLE_LIMIT = 64

/**
 * The pins once boxes the reader let go of come to rest: exactly where they were dropped.
 * What they land on makes room: a card or a whole module moves to the nearest room clear of
 * them and of everything else, a fellow member of their module to the nearest room among its
 * members; what a module grown around a moved member now covers makes room in turn. Every
 * drawn box's corner and every open module's is recorded, so the drop stands as it is shown.
 *
 * `placement` is the placement the boxes were dragged over and `pins` the corners they were
 * let go at, with every other box where it stood.
 */
export function settleDrop(
  placement: Placement,
  arrangement: Arrangement,
  pins: Pins,
  ids: readonly string[],
): Map<string, Point> {
  const moving = new Set(ids)
  let current = new Map(pins)
  /** what made room, by unit: it stands now */
  const settled = new Set<string>()
  for (let round = 0; round <= SETTLE_LIMIT; round += 1) {
    const laid = pinPlacement(placement, arrangement, current, { stack: false })
    current = laid.pins
    const drawn = drawnOf(laid.placement, arrangement)
    const boxRect = (id: string) => laid.placement.boxes.get(id)!
    // A unit makes room as one: a loose box, a module, or — inside a module holding a moved
    // box but not wholly moved — one member among its fellows.
    interface Unit {
      id: string
      members: string[]
      rect: Rect
      /** the module it makes room within, else the canvas */
      within?: string
      stands: boolean
    }
    const units: Unit[] = []
    for (const id of drawn.loose)
      units.push({
        id,
        members: [id],
        rect: boxRect(id),
        stands: moving.has(id) || settled.has(id),
      })
    for (const region of drawn.regions) {
      const held = region.members.filter((id) => moving.has(id))
      const frame = laid.placement.regions.get(region.id)!
      units.push({
        id: region.id,
        members: region.members,
        rect: frame,
        stands: held.length > 0 || settled.has(region.id),
      })
      if (held.length === 0 || held.length === region.members.length) continue
      for (const id of region.members)
        units.push({
          id,
          members: [id],
          rect: boxRect(id),
          within: region.id,
          stands: moving.has(id) || settled.has(id),
        })
    }
    const covered = units.find(
      (unit) =>
        !unit.stands &&
        units.some(
          (other) =>
            other.stands && other.within === unit.within && overlaps(unit.rect, other.rect),
        ),
    )
    if (!covered || round === SETTLE_LIMIT) return current
    const obstacles = units
      .filter((other) => other !== covered && other.within === covered.within)
      .map((other) => other.rect)
    const by = nearestRoom(covered.rect, obstacles, DROP_ROOM)
    settled.add(covered.id)
    const next = new Map(current)
    for (const id of covered.members) next.set(id, plus(next.get(id)!, by))
    // An open module is recorded by its members' corner as they now stand.
    for (const region of drawn.regions)
      next.set(region.id, cornerOf(region.members.map((id) => next.get(id)!))!)
    current = next
  }
  return current
}
