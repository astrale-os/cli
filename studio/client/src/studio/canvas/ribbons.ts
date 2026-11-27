/**
 * The lines of a Scene of ribbons, from where its boxes stand — drawn, never laid out, so
 * they follow a dragged box live.
 *
 * - A ribbon leaves the side of each box that faces the other, among the box's ribbons on
 *   that side in the order of their other ends, top to bottom, so ribbons leaving one box
 *   never cross there. It is as thick as the node pairs it carries, within bounds, and
 *   narrows where a side holds more than its height: a box's ribbons never overflow it.
 * - A ribbon is a smooth band, level where it leaves and enters, one stripe per tone,
 *   each as wide as its share of the links.
 * - A link drawn alone is a curve: from its node's row when a group draws that node as a
 *   row, else from its box's side, the ends that meet one side spread along it in the order
 *   of where they come from. Two ends in one column meet by an arc beside it.
 */

import type { Arrangement, Ribbon } from '../scene/arrange'
import type { Neighbourhood } from '../scene/focus'
import type { SceneLink, SceneTone } from '../scene/types'
import type { Frame } from './frame'
import type { Point, Rect } from './geometry'
import type { BoxModel } from './metrics'

import { isJunction } from '../scene/arrange'
import { rowRect } from './metrics'

export const RIBBON = { least: 3, most: 16, base: 2.5, perCarrier: 1.5, gap: 2 } as const

/** A ribbon's width, from the node pairs it carries. */
export const ribbonWidth = (carriers: number) =>
  Math.min(RIBBON.most, Math.max(RIBBON.least, RIBBON.base + RIBBON.perCarrier * carriers))

type Side = 'left' | 'right'

const centreOf = (rect: Rect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
})
const facing = (rect: Rect, other: Rect): Side =>
  centreOf(other).x >= centreOf(rect).x ? 'right' : 'left'
const sideX = (rect: Rect, side: Side) => (side === 'right' ? rect.x + rect.width : rect.x)
const round = (value: number) => Math.round(value * 10) / 10

/** The room on a box's side that its lines may meet, top and bottom. */
function sideRoom(rect: Rect, junction: boolean): { top: number; bottom: number } {
  if (junction) return { top: rect.y + rect.height / 2, bottom: rect.y + rect.height / 2 }
  const inset = Math.min(10, rect.height / 4)
  return { top: rect.y + inset, bottom: rect.y + rect.height - inset }
}

/** A cubic curve level at both ends, from `a` to `b`, as path data. */
function levelCurve(a: Point, b: Point, move = true): string {
  const reach = (b.x - a.x) / 2
  return `${move ? `M${round(a.x)},${round(a.y)} ` : ''}C${round(a.x + reach)},${round(a.y)} ${round(b.x - reach)},${round(b.y)} ${round(b.x)},${round(b.y)}`
}

/** The curve level at both ends, sampled into a route. */
export function sampleLevelCurve(a: Point, b: Point, samples = 24): Point[] {
  const reach = (b.x - a.x) / 2
  const p1 = { x: a.x + reach, y: a.y }
  const p2 = { x: b.x - reach, y: b.y }
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples
    const u = 1 - t
    return {
      x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
    }
  })
}

/** An arc beside one column, from `a` to `b`, both on its `side`, sampled into a route. */
function sampleArc(a: Point, b: Point, side: Side, samples = 24): Point[] {
  const bulge = (30 + Math.abs(b.y - a.y) * 0.15) * (side === 'right' ? 1 : -1)
  const x = side === 'right' ? Math.max(a.x, b.x) : Math.min(a.x, b.x)
  const p1 = { x: x + bulge, y: a.y }
  const p2 = { x: x + bulge, y: b.y }
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples
    const u = 1 - t
    return {
      x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
    }
  })
}

export interface RibbonShape {
  id: string
  /** one filled band per stripe, in stripe order */
  stripes: { tone: SceneTone; count: number; d: string }[]
  /** its middle line, for its hit area */
  spine: string
  /** its widest, for its hit area */
  width: number
  /** where it is drawn, for what avoids it */
  from: Point
  to: Point
}

/** Every ribbon's shape, from where its two boxes stand. */
export function ribbonShapes(
  arrangement: Arrangement,
  boxes: ReadonlyMap<string, Rect>,
): RibbonShape[] {
  const ends = new Map<string, { ribbon: Ribbon; side: Side; other: Rect }[]>()
  const endsAt = (box: string, side: Side) => `${box}|${side}`
  for (const ribbon of arrangement.ribbons) {
    const from = boxes.get(ribbon.from)
    const to = boxes.get(ribbon.to)
    if (!from || !to) continue
    for (const [box, rect, other] of [
      [ribbon.from, from, to],
      [ribbon.to, to, from],
    ] as const) {
      const side = facing(rect, other)
      const key = endsAt(box, side)
      ends.set(key, [...(ends.get(key) ?? []), { ribbon, side, other }])
    }
  }
  // Where each ribbon meets each box: its middle and its width there.
  const meets = new Map<string, { x: number; y: number; width: number }>()
  for (const [key, list] of ends) {
    const box = key.slice(0, key.lastIndexOf('|'))
    const rect = boxes.get(box)!
    list.sort(
      (a, b) => centreOf(a.other).y - centreOf(b.other).y || (a.ribbon.id < b.ribbon.id ? -1 : 1),
    )
    const widths = list.map((end) => ribbonWidth(end.ribbon.carriers))
    const total = widths.reduce((sum, width) => sum + width, 0) + RIBBON.gap * (list.length - 1)
    const room = sideRoom(rect, isJunction(box))
    const scale = isJunction(box) ? 1 : Math.min(1, (room.bottom - room.top) / Math.max(1, total))
    let y = (room.top + room.bottom) / 2 - (total * scale) / 2
    list.forEach((end, index) => {
      const width = widths[index]! * scale
      meets.set(`${end.ribbon.id}|${box}`, {
        x: isJunction(box) ? rect.x + rect.width / 2 : sideX(rect, end.side),
        y: y + width / 2,
        width,
      })
      y += width + RIBBON.gap * scale
    })
  }
  const shapes: RibbonShape[] = []
  for (const ribbon of arrangement.ribbons) {
    const a = meets.get(`${ribbon.id}|${ribbon.from}`)
    const b = meets.get(`${ribbon.id}|${ribbon.to}`)
    if (!a || !b) continue
    const total = ribbon.stripes.reduce((sum, stripe) => sum + stripe.count, 0) || 1
    let share = 0
    const stripes = ribbon.stripes.map((stripe) => {
      const top = share / total
      share += stripe.count
      const bottom = share / total
      const at = (end: typeof a, fraction: number) => ({
        x: end.x,
        y: end.y - end.width / 2 + fraction * end.width,
      })
      const d = `${levelCurve(at(a, top), at(b, top))} L${round(b.x)},${round(at(b, bottom).y)} ${levelCurve(at(b, bottom), at(a, bottom), false)} Z`
      return { tone: stripe.tone, count: stripe.count, d }
    })
    shapes.push({
      id: ribbon.id,
      stripes,
      spine: levelCurve(a, b),
      width: Math.max(a.width, b.width),
      from: { x: a.x, y: a.y },
      to: { x: b.x, y: b.y },
    })
  }
  return shapes
}

interface End {
  link: string
  side: 'from' | 'to'
  /** the box it is drawn at */
  box: string
  /** the row it leaves, when its node is one */
  row?: Rect
}

/**
 * Each link's curve, from its `from` end to its `to` end, sampled into a route: the links
 * given, among the boxes they are placed at. A link whose end is not drawn has none.
 */
export function linkCurves(
  arrangement: Arrangement,
  boxes: ReadonlyMap<string, Rect>,
  models: ReadonlyMap<string, BoxModel>,
  links: readonly SceneLink[],
): Map<string, Point[]> {
  const columnOf = new Map<string, number | undefined>()
  for (const box of arrangement.boxes)
    columnOf.set(
      box.id,
      box.kind === 'node' ? box.node.column : box.kind === 'group' ? box.column : undefined,
    )
  const endsOf = new Map<string, [End, End]>()
  for (const link of links) {
    const place = arrangement.linkPlace.get(link.id)
    if (!place?.from || !place.to || place.box) continue
    const ends = (['from', 'to'] as const).map((side): End => {
      const box = place[side]!
      const node = link[side].nodes.length === 1 ? link[side].nodes[0]! : undefined
      const row = node ? rowRect(models.get(box), boxes.get(box), node) : undefined
      return { link: link.id, side, box, ...(row ? { row } : {}) }
    }) as [End, End]
    if (!boxes.has(ends[0].box) || !boxes.has(ends[1].box)) continue
    endsOf.set(link.id, ends)
  }
  const sameColumn = (a: End, b: End) => {
    if (a.box === b.box) return true
    const left = columnOf.get(a.box)
    const right = columnOf.get(b.box)
    if (left !== undefined && left === right) return true
    const ra = boxes.get(a.box)!
    const rb = boxes.get(b.box)!
    return ra.x < rb.x + rb.width && rb.x < ra.x + ra.width
  }
  const sideOf = (end: End, other: End): Side =>
    sameColumn(end, other) ? 'right' : facing(boxes.get(end.box)!, boxes.get(other.box)!)
  const otherY = (other: End) =>
    other.row ? centreOf(other.row).y : centreOf(boxes.get(other.box)!).y

  // Ends that meet a box's side, not at a row: spread along it, in the order they come from.
  const slots = new Map<string, { end: End; other: End }[]>()
  for (const [a, b] of endsOf.values()) {
    for (const [end, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (end.row) continue
      const key = `${end.box}|${sideOf(end, other)}`
      slots.set(key, [...(slots.get(key) ?? []), { end, other }])
    }
  }
  const at = new Map<string, Point>()
  for (const [key, list] of slots) {
    const box = key.slice(0, key.lastIndexOf('|'))
    const side = key.slice(key.lastIndexOf('|') + 1) as Side
    const rect = boxes.get(box)!
    list.sort((a, b) => otherY(a.other) - otherY(b.other) || (a.end.link < b.end.link ? -1 : 1))
    const room = sideRoom(rect, isJunction(box))
    const step = list.length > 1 ? Math.min(10, (room.bottom - room.top) / (list.length - 1)) : 0
    const first = (room.top + room.bottom) / 2 - (step * (list.length - 1)) / 2
    list.forEach(({ end }, index) =>
      at.set(`${end.link}|${end.side}`, {
        x: isJunction(box) ? rect.x + rect.width / 2 : sideX(rect, side),
        y: first + step * index,
      }),
    )
  }
  const curves = new Map<string, Point[]>()
  for (const [id, [a, b]] of endsOf) {
    const point = (end: End, other: End): Point => {
      if (end.row) {
        const side = sideOf(end, other)
        return { x: sideX(end.row, side), y: end.row.y + end.row.height / 2 }
      }
      return at.get(`${end.link}|${end.side}`)!
    }
    const from = point(a, b)
    const to = point(b, a)
    curves.set(id, sameColumn(a, b) ? sampleArc(from, to, 'right') : sampleLevelCurve(from, to))
  }
  return curves
}

/**
 * The links a Scene of ribbons draws alone, with their curves: at rest what no ribbon carries;
 * lit or `peeked` (under the pointer), every line. A focus draws its own lines and no other:
 * what the previous focus lit is gone with it.
 */
export function drawnAlone(
  frame: Frame,
  lit: Neighbourhood | null,
  peeked: ReadonlySet<string>,
): { curves: Map<string, Point[]>; leavesRow: Set<string> } {
  const { scene, arrangement, placement } = frame
  const wanted = new Set<string>()
  for (const link of scene.links) {
    const place = arrangement.linkPlace.get(link.id)
    if (place && !place.box && !place.ribbon && !link.latent) wanted.add(link.id)
  }
  for (const id of lit?.links ?? []) wanted.add(id)
  for (const id of peeked) wanted.add(id)
  const chosen = scene.links.filter((link) => wanted.has(link.id))
  const curves = linkCurves(arrangement, placement.boxes, placement.models, chosen)
  const leavesRow = new Set(
    chosen.flatMap((link) => {
      const box = arrangement.linkPlace.get(link.id)?.from
      const node = link.from.nodes[0]
      return box && node && rowRect(placement.models.get(box), placement.boxes.get(box), node)
        ? [link.id]
        : []
    }),
  )
  return { curves, leavesRow }
}
