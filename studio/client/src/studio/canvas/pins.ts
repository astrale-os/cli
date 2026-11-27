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
 * - On a canvas of several Domains, each area is placed as one canvas is, and an area's pin is
 *   the corner of its boxes: dragging its frame moves them all. An area none of whose boxes
 *   was placed comes in at the nearest room clear of placed areas; areas that would overlap
 *   stack downward.
 *
 * Pure and deterministic: the same placement and pins always settle the same way.
 */

import type { Area, Arrangement } from '../scene/arrange'

import { AREA_GAP, areaFrame, areaOfBoxes, EMPTY_AREA, withinArea } from './areas'
import { bandHeadings } from './columns'
import { nearestRoom, overlaps, type Point, polylineCrosses, type Rect, union } from './geometry'
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
/** The gap left above a box stacked under another. */
const STACK_GAP = 20
/** The least room kept around an area placed beside placed ones, stacked, or making room. */
const AREA_ROOM = AREA_GAP / 2
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

/** Each item's downward shift once overlapping items stack, the higher one staying put. */
function stackDown(
  items: readonly { id: string; rect: Rect }[],
  gap = STACK_GAP,
): Map<string, number> {
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
      rect = { ...rect, y: blocked.y + blocked.height + gap }
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
  if (arrangement.areas && arrangement.areas.length > 0 && auto.areas)
    return pinAreas(auto, arrangement, arrangement.areas, pins, options)
  const placed = placeBoxes(auto, arrangement, pins, options)
  if (!placed.touched) return { placement: auto, pins: placed.pins }
  const routes = settleRoutes(auto, arrangement, placed.boxes)
  return {
    placement: {
      ...auto,
      boxes: placed.boxes,
      regions: placed.regions,
      routes,
      bounds: boundsOf(
        [
          ...placed.boxes.values(),
          ...placed.regions.values(),
          ...bandHeadings(arrangement, placed.boxes).map((heading) => heading.rect),
        ],
        routes.values(),
      ),
    },
    pins: placed.pins,
  }
}

/** Where each drawn box and open module stands once pins apply, and the pins that record it. */
interface Placed {
  boxes: Map<string, Rect>
  regions: Map<string, Rect>
  pins: Map<string, Point>
  /** some pin applies: the boxes may not stand where they were laid out */
  touched: boolean
}

function placeBoxes(
  auto: Placement,
  arrangement: Arrangement,
  pins: Pins,
  options: PinOptions,
): Placed {
  const drawn = drawnOf(auto, arrangement)
  const laid = (id: string) => auto.boxes.get(id)!
  const touched =
    drawn.boxes.some((id) => pins.has(id)) || drawn.regions.some((region) => pins.has(region.id))
  if (!touched) {
    const corners = new Map(drawn.boxes.map((id) => [id, { x: laid(id).x, y: laid(id).y }]))
    const regions = new Map<string, Rect>()
    for (const region of drawn.regions) {
      const rect = auto.regions.get(region.id) ?? regionFrame(region.members.map(laid))
      if (rect) regions.set(region.id, rect)
    }
    return {
      boxes: new Map(drawn.boxes.map((id) => [id, laid(id)])),
      regions,
      pins: pinsOf(drawn, corners),
      touched: false,
    }
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
  return { boxes, regions, pins: recorded, touched: true }
}

/**
 * Every line's route between its ends as they stand at `boxes`: its laid-out route, moved,
 * when both ends moved together and no box moved apart from them stands across it; a fan's
 * spoke where one reaches; else routed again.
 */
function settleRoutes(
  auto: Placement,
  arrangement: Arrangement,
  boxes: ReadonlyMap<string, Rect>,
): Map<string, Point[]> {
  const shiftOf = (id: string) => minus(boxes.get(id)!, auto.boxes.get(id)!)
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
        [...boxes.keys()].some(
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
  return routes
}

/**
 * A canvas of several Domains with the reader's pins applied: each area's boxes placed as one
 * canvas places them, the areas none of whose boxes was placed brought in at their pin or the
 * nearest room clear of placed ones, the junctions between areas beside what they join, and
 * frames that would overlap stacked downward.
 */
function pinAreas(
  auto: Placement,
  arrangement: Arrangement,
  areas: readonly Area[],
  pins: Pins,
  options: PinOptions,
): Pinned {
  const parts = areas.map((area) => {
    const placed = placeBoxes(auto, withinArea(arrangement, area), pins, options)
    const corner = cornerOf([...placed.boxes.values()])
    const pin = pins.get(area.id)
    // An area none of whose boxes was placed stands at its pin, when it has one.
    const at = !placed.touched && pin && corner ? minus(pin, corner) : undefined
    return { area, placed, by: at ?? ORIGIN, fixed: placed.touched || at !== undefined }
  })
  const frameOf = (part: (typeof parts)[number]) =>
    shifted(
      areaFrame([...part.placed.boxes.values(), ...part.placed.regions.values()]) ??
        auto.areas?.get(part.area.id) ?? { x: 0, y: 0, ...EMPTY_AREA },
      part.by,
    )
  const standing = parts.filter((part) => part.fixed).map(frameOf)
  for (const part of parts) {
    if (part.fixed) continue
    part.by = plus(part.by, nearestRoom(frameOf(part), standing, AREA_ROOM))
    standing.push(frameOf(part))
  }

  const boxes = new Map<string, Rect>()
  const recorded = new Map<string, Point>()
  for (const part of parts) {
    for (const [id, rect] of part.placed.boxes) boxes.set(id, shifted(rect, part.by))
    for (const [id, pin] of part.placed.pins) recorded.set(id, plus(pin, part.by))
    const corner = cornerOf([...part.placed.boxes.keys()].map((id) => recorded.get(id)!))
    if (corner) recorded.set(part.area.id, corner)
  }

  // A junction between areas stands at its pin, else beside the boxes it joins, clear of
  // every frame.
  const inArea = areaOfBoxes(arrangement)
  const between = arrangement.boxes
    .map((box) => box.id)
    .filter((id) => !inArea.has(id) && auto.boxes.has(id))
  const linked = linksOf(arrangement)
  const taken = [...standing]
  for (const id of between) {
    const pin = pins.get(id)
    if (!pin) continue
    boxes.set(id, cornerAt(auto.boxes.get(id)!, pin))
    taken.push(boxes.get(id)!)
  }
  for (const id of between) {
    if (boxes.has(id)) continue
    const laid = auto.boxes.get(id)!
    const neighbours = (linked.get(id) ?? []).filter(
      (other) => inArea.has(other) && boxes.has(other),
    )
    const by =
      neighbours.length > 0
        ? mean(neighbours.map((other) => minus(boxes.get(other)!, auto.boxes.get(other)!)))
        : ORIGIN
    const moved = shifted(laid, by)
    boxes.set(id, shifted(moved, nearestRoom(moved, taken, ROOM)))
    taken.push(boxes.get(id)!)
  }
  for (const id of between) recorded.set(id, { x: boxes.get(id)!.x, y: boxes.get(id)!.y })

  const frames = new Map(parts.map((part) => [part.area.id, frameOf(part)]))
  const regions = new Map<string, Rect>()
  for (const part of parts)
    for (const [id, rect] of part.placed.regions) regions.set(id, shifted(rect, part.by))
  if (options.stack !== false) {
    const shifts = stackDown(
      [
        ...parts.map((part) => ({ id: part.area.id, rect: frames.get(part.area.id)! })),
        ...between.map((id) => ({ id, rect: boxes.get(id)! })),
      ],
      AREA_ROOM,
    )
    for (const [id, dy] of shifts) {
      if (dy === 0) continue
      const down = (rect: Rect) => shifted(rect, { x: 0, y: dy })
      const part = parts.find((candidate) => candidate.area.id === id)
      if (!part) {
        boxes.set(id, down(boxes.get(id)!))
        continue
      }
      frames.set(id, down(frames.get(id)!))
      for (const box of part.placed.boxes.keys()) boxes.set(box, down(boxes.get(box)!))
      for (const region of part.placed.regions.keys())
        regions.set(region, down(regions.get(region)!))
    }
  }

  const unmoved =
    [...boxes].every(([id, rect]) => same(rect, auto.boxes.get(id)!)) &&
    [...frames].every(([id, rect]) => {
      const laid = auto.areas?.get(id)
      return laid !== undefined && same(rect, laid) && rect.height === laid.height
    }) &&
    [...regions].every(([id, rect]) => {
      const laid = auto.regions.get(id)
      return laid !== undefined && same(rect, laid) && rect.height === laid.height
    })
  if (unmoved) return { placement: auto, pins: recorded }
  const routes = settleRoutes(auto, arrangement, boxes)
  return {
    placement: {
      ...auto,
      boxes,
      regions,
      routes,
      areas: frames,
      bounds: boundsOf(
        [...boxes.values(), ...regions.values(), ...frames.values()],
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
 * members; what a module grown around a moved member now covers makes room in turn. On a
 * canvas of several Domains, what an area grown around a moved box now covers makes room the
 * same way, a whole area at a time. Every drawn box's corner, every open module's and every
 * area's is recorded, so the drop stands as it is shown.
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
    // box but not wholly moved — one member among its fellows. On a canvas of several Domains
    // an area is a unit too, and inside an area holding a moved box but not wholly moved, its
    // loose boxes and modules make room among each other.
    interface Unit {
      id: string
      members: string[]
      rect: Rect
      /** the area or module it makes room within, else the canvas */
      within?: string
      stands: boolean
      /** the least room it keeps from what it makes room for */
      gap: number
    }
    const units: Unit[] = []
    const scope = (
      loose: readonly string[],
      regions: Drawn['regions'],
      within: string | undefined,
    ) => {
      for (const id of loose)
        units.push({
          id,
          members: [id],
          rect: boxRect(id),
          within,
          stands: moving.has(id) || settled.has(id),
          gap: DROP_ROOM,
        })
      for (const region of regions) {
        const held = region.members.filter((id) => moving.has(id))
        const frame = laid.placement.regions.get(region.id)!
        units.push({
          id: region.id,
          members: region.members,
          rect: frame,
          within,
          stands: held.length > 0 || settled.has(region.id),
          gap: DROP_ROOM,
        })
        if (held.length === 0 || held.length === region.members.length) continue
        for (const id of region.members)
          units.push({
            id,
            members: [id],
            rect: boxRect(id),
            within: region.id,
            stands: moving.has(id) || settled.has(id),
            gap: DROP_ROOM,
          })
      }
    }
    const frames = laid.placement.areas
    const areas = frames ? (arrangement.areas ?? []) : []
    const inArea = areaOfBoxes(arrangement)
    if (areas.length === 0) scope(drawn.loose, drawn.regions, undefined)
    else {
      scope(
        drawn.loose.filter((id) => !inArea.has(id)),
        [],
        undefined,
      )
      for (const area of areas) {
        const members = area.members.filter((id) => laid.placement.boxes.has(id))
        const rect = frames!.get(area.id)
        if (!rect || members.length === 0) continue
        const held = members.filter((id) => moving.has(id))
        units.push({
          id: area.id,
          members,
          rect,
          stands: held.length > 0 || settled.has(area.id),
          gap: AREA_ROOM,
        })
        if (held.length === 0 || held.length === members.length) continue
        scope(
          drawn.loose.filter((id) => inArea.get(id) === area.id),
          drawn.regions.filter((region) => inArea.get(region.members[0]!) === area.id),
          area.id,
        )
      }
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
    const by = nearestRoom(covered.rect, obstacles, covered.gap)
    settled.add(covered.id)
    const next = new Map(current)
    for (const id of covered.members) next.set(id, plus(next.get(id)!, by))
    // An open module, and an area, is recorded by its boxes' corner as they now stand.
    for (const region of drawn.regions)
      next.set(region.id, cornerOf(region.members.map((id) => next.get(id)!))!)
    for (const area of areas) {
      const corner = cornerOf(area.members.flatMap((id) => next.get(id) ?? []))
      if (corner) next.set(area.id, corner)
    }
    current = next
  }
  return current
}
