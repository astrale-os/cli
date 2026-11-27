/**
 * A canvas of several Domains: each Domain's area is laid out alone, as its own canvas lays it
 * out, and the areas are packed side by side.
 *
 * - An area's frame holds its boxes and modules, padded, with room above for its name.
 * - Areas are packed in Scene order — the canvas's own Domain first — in rows, with as many
 *   rows as make the whole read largest in a landscape view. No two frames come closer than
 *   `AREA_GAP`.
 * - A line inside one area is laid out with it; a line between areas is routed once they are
 *   packed, around every box.
 *
 * Pure and deterministic: the same sizes always pack the same way.
 */

import type { Area, Arrangement } from '../scene/arrange'

import { type Point, type Rect, union } from './geometry'

/** An area frame's room around its boxes and modules. */
export const AREA_PAD = 24
/** The height of an area's name and version, over its boxes. */
export const AREA_HEADER = 34
/** The room an area keeps above its boxes, for its name. */
export const AREA_TOP = AREA_HEADER + 12
/** The least gap between two area frames. */
export const AREA_GAP = 96
/** The frame of an area that draws no box: its name over a little room. */
export const EMPTY_AREA = { width: 280, height: AREA_TOP + 48 }
/** The view the packing reads largest in: wider than tall. */
const VIEW_ASPECT = 1.6

/** An area's frame around its boxes' and modules' rects, padded; none around none. */
export function areaFrame(rects: readonly Rect[]): Rect | undefined {
  const box = union(rects)
  if (!box) return undefined
  return {
    x: box.x - AREA_PAD,
    y: box.y - AREA_TOP,
    width: box.width + AREA_PAD * 2,
    height: box.height + AREA_TOP + AREA_PAD,
  }
}

/** The arrangement of one area alone: its boxes, its modules, and the lines inside it. */
export function withinArea(arrangement: Arrangement, area: Area): Arrangement {
  const inside = new Set(area.members)
  const { areas: _areas, ...rest } = arrangement
  return {
    ...rest,
    key: `${arrangement.key}@${area.id}`,
    boxes: arrangement.boxes.filter((box) => inside.has(box.id)),
    regions: arrangement.regions
      .map((region) => ({ ...region, members: region.members.filter((id) => inside.has(id)) }))
      .filter((region) => region.members.length > 0),
    trunks: arrangement.trunks.filter((trunk) => inside.has(trunk.from) && inside.has(trunk.to)),
    ribbons: arrangement.ribbons.filter(
      (ribbon) => inside.has(ribbon.from) && inside.has(ribbon.to),
    ),
    fans: arrangement.fans.filter((fan) => inside.has(fan.junction) && inside.has(fan.box)),
  }
}

/** Each box's area; a box no area holds — a junction between areas — has none. */
export function areaOfBoxes(arrangement: Arrangement): Map<string, string> {
  const areas = new Map<string, string>()
  for (const area of arrangement.areas ?? []) for (const id of area.members) areas.set(id, area.id)
  return areas
}

interface Size {
  width: number
  height: number
}

/**
 * Where each of `sizes` stands, by its top-left corner: in rows, in order, split so the widest
 * row is as narrow as it can be — the earlier rows fuller where that is equal — rows
 * top-aligned and `gap` apart. Of
 * every number of rows, the one whose whole is smallest in a view `aspect` times wider than
 * tall wins; equal, the fewer rows.
 */
export function packAreas(sizes: readonly Size[], gap = AREA_GAP, aspect = VIEW_ASPECT): Point[] {
  if (sizes.length === 0) return []
  let best: { score: number; corners: Point[] } | undefined
  for (let rows = 1; rows <= sizes.length; rows += 1) {
    const corners = inRows(sizes, splitRows(sizes, rows, gap), gap)
    const width = Math.max(...sizes.map((size, index) => corners[index]!.x + size.width))
    const height = Math.max(...sizes.map((size, index) => corners[index]!.y + size.height))
    const score = Math.max(width / aspect, height)
    if (!best || score < best.score - 0.5) best = { score, corners }
  }
  return best!.corners
}

/** The first index of each row, splitting `sizes` in order into at most `rows` rows. */
function splitRows(sizes: readonly Size[], rows: number, gap: number): number[] {
  const n = sizes.length
  const span = (from: number, to: number) => {
    let width = 0
    for (let index = from; index < to; index += 1) width += sizes[index]!.width
    return width + gap * (to - from - 1)
  }
  // widest[k][i]: the narrowest widest row splitting the first i sizes into k rows.
  const widest: number[][] = [[0, ...Array<number>(n).fill(Infinity)]]
  const cut: number[][] = [[]]
  for (let k = 1; k <= rows; k += 1) {
    widest.push([0])
    cut.push([0])
    for (let i = 1; i <= n; i += 1) {
      let value = Infinity
      let at = 0
      for (let j = k - 1; j < i; j += 1) {
        const candidate = Math.max(widest[k - 1]![j]!, span(j, i))
        // equal, the later cut: the earlier rows hold more
        if (candidate <= value) {
          value = candidate
          at = j
        }
      }
      widest[k]!.push(value)
      cut[k]!.push(at)
    }
  }
  const starts: number[] = []
  for (let k = rows, i = n; k > 0 && i > 0; k -= 1) {
    const at = cut[k]![i]!
    starts.unshift(at)
    i = at
  }
  return [...new Set(starts)]
}

function inRows(sizes: readonly Size[], starts: readonly number[], gap: number): Point[] {
  const corners: Point[] = []
  let y = 0
  starts.forEach((start, row) => {
    const end = starts[row + 1] ?? sizes.length
    let x = 0
    let height = 0
    for (let index = start; index < end; index += 1) {
      corners[index] = { x, y }
      x += sizes[index]!.width + gap
      height = Math.max(height, sizes[index]!.height)
    }
    y += height + gap
  })
  return corners
}
