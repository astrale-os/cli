/**
 * A frame is what the canvas shows at one moment: a Scene, its Arrangement and their
 * Placement, always together, so nothing is ever drawn against another frame's layout.
 * Between two frames, shared boxes keep their identity; the new frame is shifted so the
 * box the reader was looking at — one they can see — stays where it was. A frame carries its pins, in its own
 * coordinates, so whatever the reader places in it is recorded where it is seen.
 */

import type { Arrangement } from '../scene/arrange'
import type { Scene } from '../scene/types'
import type { Placement } from './layout'
import type { Pins } from './pins'

import { rulePlaces } from '../scene/rules'
import { overlaps, type Point, type Rect, union } from './geometry'
import { rowRect } from './metrics'

export interface Frame {
  scene: Scene
  arrangement: Arrangement
  placement: Placement
  /** every drawn box's and open module's corner, as placing any of them records it */
  pins: Pins
  /** the reader's pins it was laid with, as given: unchanged pins lay the same frame */
  laidWith: Pins
}

/** The same frame, moved by (dx, dy): its placement and its pins together. */
export function shiftFrame(frame: Frame, dx: number, dy: number): Frame {
  if (dx === 0 && dy === 0) return frame
  return {
    ...frame,
    placement: shiftPlacement(frame.placement, dx, dy),
    pins: new Map([...frame.pins].map(([id, pin]) => [id, { x: pin.x + dx, y: pin.y + dy }])),
  }
}

/** The same placement, moved by (dx, dy). */
export function shiftPlacement(placement: Placement, dx: number, dy: number): Placement {
  if (dx === 0 && dy === 0) return placement
  const move = (rect: Rect): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy })
  const moveAll = (rects: ReadonlyMap<string, Rect>) =>
    new Map([...rects].map(([id, rect]) => [id, move(rect)]))
  return {
    ...placement,
    boxes: moveAll(placement.boxes),
    regions: moveAll(placement.regions),
    ...(placement.areas ? { areas: moveAll(placement.areas) } : {}),
    routes: new Map(
      [...placement.routes].map(([id, points]) => [
        id,
        points.map((point): Point => ({ x: point.x + dx, y: point.y + dy })),
      ]),
    ),
    bounds: move(placement.bounds),
  }
}

/**
 * The rect drawn for a scene id: its box or row, its region, its area, or — for a link — what
 * it joins.
 */
export function rectOf(frame: Frame, id: string): Rect | undefined {
  const { arrangement, placement } = frame
  const region = placement.regions.get(id) ?? placement.areas?.get(id)
  if (region) return region
  const place = arrangement.linkPlace.get(id)
  if (place) {
    const ids = [place.box, place.from, place.to].filter((box) => box !== undefined)
    return union(ids.flatMap((box) => placement.boxes.get(box) ?? []))
  }
  const box = arrangement.boxOf.get(id) ?? id
  const rect = placement.boxes.get(box)
  // A node drawn as a row of its group's box: that row.
  if (rect) return (box !== id && rowRect(placement.models.get(box), rect, id)) || rect
  // A rule: its row on the card that draws it, else the link that carries it.
  const rule = rulePlaces(frame.scene).get(id)?.[0]
  if (rule) {
    if (rule.on === 'link') return rectOf(frame, rule.owner)
    const card = arrangement.boxOf.get(rule.owner)
    const at = card ? placement.boxes.get(card) : undefined
    const model = card ? placement.models.get(card) : undefined
    const row = model?.rules.find((each) => each.rule.id === rule.row)
    if (at && model && row)
      return { x: at.x, y: at.y + model.rulesTop + row.y, width: at.width, height: row.height }
    return at
  }
  // An expanded group drawn without a frame: its members' boxes.
  const members = frame.scene.nodes.filter((node) => node.group === id)
  return union(
    members.flatMap((node) => placement.boxes.get(arrangement.boxOf.get(node.id) ?? '') ?? []),
  )
}

/** Whether a box of `placement` shows in the world rect `seen`, even in part. */
export function inView(placement: Placement, seen: Rect): (box: string) => boolean {
  return (box) => {
    const rect = placement.boxes.get(box)
    return rect !== undefined && overlaps(rect, seen)
  }
}

/** The box whose centre is nearest a world point, among the ids given (all boxes by default). */
export function nearestBox(
  placement: Placement,
  point: Point,
  among?: (id: string) => boolean,
): string | undefined {
  let best: { id: string; distance: number } | undefined
  for (const [id, rect] of placement.boxes) {
    if (among && !among(id)) continue
    const distance = Math.hypot(
      rect.x + rect.width / 2 - point.x,
      rect.y + rect.height / 2 - point.y,
    )
    if (!best || distance < best.distance) best = { id, distance }
  }
  return best?.id
}

/**
 * The shift that keeps `anchor` where the previous frame drew it: by its top-left corner,
 * so a card that grows on zooming in grows downward and its name does not move.
 */
export function anchorShift(
  previous: Placement,
  next: Placement,
  anchor: string,
): Point | undefined {
  const before = previous.boxes.get(anchor) ?? previous.regions.get(anchor)
  const after = next.boxes.get(anchor) ?? next.regions.get(anchor)
  if (!before || !after) return undefined
  return { x: before.x - after.x, y: before.y - after.y }
}

/** The scene id a box stands for: what selecting the box selects. A junction is its own id. */
export function selectionOf(arrangement: Arrangement, box: string): string {
  const found = arrangement.boxes.find((candidate) => candidate.id === box)
  if (!found) return box
  return found.kind === 'node' ? found.node.id : found.kind === 'group' ? found.group.id : found.id
}
