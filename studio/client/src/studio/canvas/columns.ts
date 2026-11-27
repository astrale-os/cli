/**
 * Where boxes go in a Scene of ribbons: one column per Scene column, left to right, each a
 * list read top to bottom. Nothing is routed — a ribbon is drawn between its two boxes — so
 * a box's place is all there is to lay out, and it is laid out so ribbons do not cross:
 *
 * - The column at an end of the most ribbons keeps the Scene's order. Every other column is
 *   ordered by where the boxes it is tied to stand, nearest columns first; a box `beside`
 *   another is tied to it above any ribbon.
 * - Each box is then drawn level with what it is tied to, weighed by what the ribbons carry
 *   (a hub's barely), never nearer its neighbours than a gap and never out of its column's
 *   order.
 * - Columns stand apart by a gap that grows with the tallest one, so the curves between them
 *   stay gentle. A column holding only pills keeps no width: its pills are centred on its
 *   axis, so the boxes beyond stand where they stand without it.
 * - A junction stands just before the boxes it accepts, level with their middle.
 * - A band's heading stands above its column, every heading on one line over the topmost box.
 *
 * Synchronous and deterministic: the same arrangement and sizes always lay out the same way.
 */

import type { Arrangement, Box } from '../scene/arrange'
import type { Rect } from './geometry'
import type { BoxModel } from './metrics'

/** The gap between two boxes of one column. */
export const COLUMN_GAP = 16
/** The room a band's heading takes above the topmost box. */
export const HEADING_ROOM = 40
export const HEADING_H = 20
/** How far a junction stands before the boxes it accepts. */
const JUNCTION_REACH = 56
/** How much a hub's ribbon weighs against one carrying a single function. */
const AMBIENT_WEIGHT = 0.15
/** The passes that settle each column against the others. */
const SWEEPS = 8

const columnOf = (box: Box): number | undefined =>
  box.kind === 'node' ? box.node.column : box.kind === 'group' ? box.column : undefined

/** The gap between two neighbouring columns, from the tallest column's height. */
export const columnGap = (tallest: number) =>
  Math.round(Math.min(240, Math.max(160, tallest * 0.2)))

interface Tie {
  to: string
  weight: number
}

/** Each box's ties to the boxes of other columns: its ribbons, and the box it stands beside. */
function tiesOf(arrangement: Arrangement): Map<string, Tie[]> {
  const boxes = new Map(arrangement.boxes.map((box) => [box.id, box]))
  const ties = new Map<string, Tie[]>()
  const tie = (from: string, to: string, weight: number) => {
    if (from === to || !boxes.has(from) || !boxes.has(to)) return
    const list = ties.get(from) ?? ties.set(from, []).get(from)!
    const found = list.find((one) => one.to === to)
    if (found) found.weight += weight
    else list.push({ to, weight })
  }
  // A junction stands for the boxes it accepts: its ribbon ties to each of them in part.
  const through = (id: string): string[] => {
    const box = boxes.get(id)
    return box?.kind === 'junction' ? box.accepts : [id]
  }
  for (const ribbon of arrangement.ribbons) {
    const weight = ribbon.ambient ? AMBIENT_WEIGHT : ribbon.carriers
    const left = through(ribbon.from)
    const right = through(ribbon.to)
    for (const a of left)
      for (const b of right) {
        const share = weight / (left.length * right.length)
        tie(a, b, share)
        tie(b, a, share)
      }
  }
  for (const box of arrangement.boxes) {
    if (box.kind !== 'node' || !box.node.beside) continue
    const other = arrangement.boxOf.get(box.node.beside) ?? box.node.beside
    const own = (ties.get(box.id) ?? []).reduce((total, one) => total + one.weight, 0)
    // Above every ribbon it has, and felt by the other end as much as its own heaviest tie.
    tie(box.id, other, Math.max(8, own * 2))
    tie(other, box.id, Math.max(1, own))
  }
  return ties
}

/**
 * The tops of boxes kept in order with `gap` between them, each as near its wanted centre
 * as the order allows, weighed: isotonic regression (pool adjacent violators) on the
 * centres less the room the boxes before each take.
 */
export function settleColumn(
  heights: readonly number[],
  wanted: readonly number[],
  weights: readonly number[],
  gap: number,
): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const height of heights) {
    offsets.push(offset)
    offset += height + gap
  }
  const targets = wanted.map((centre, index) => centre - heights[index]! / 2 - offsets[index]!)
  const blocks: { value: number; weight: number; count: number }[] = []
  targets.forEach((value, index) => {
    blocks.push({ value, weight: weights[index]!, count: 1 })
    while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
      const last = blocks.pop()!
      const before = blocks.at(-1)!
      const weight = before.weight + last.weight
      before.value = (before.value * before.weight + last.value * last.weight) / weight
      before.weight = weight
      before.count += last.count
    }
  })
  const tops: number[] = []
  for (const block of blocks)
    for (let index = 0; index < block.count; index += 1)
      tops.push(block.value + offsets[tops.length]!)
  return tops
}

/** Every box's rect, laid out in columns. */
export function columnBoxes(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
): Map<string, Rect> {
  const ties = tiesOf(arrangement)
  const cards = arrangement.boxes.filter((box) => box.kind !== 'junction')
  const last = Math.max(0, ...cards.map((box) => columnOf(box) ?? 0))
  const columns = new Map<number, string[]>()
  for (const box of cards) {
    const column = columnOf(box) ?? last + 1
    columns.set(column, [...(columns.get(column) ?? []), box.id])
  }
  const indices = [...columns.keys()].sort((a, b) => a - b)
  const columnAt = new Map<string, number>()
  for (const [column, ids] of columns) for (const id of ids) columnAt.set(id, column)
  const height = (id: string) => models.get(id)?.height ?? 0
  const width = (id: string) => models.get(id)?.width ?? 0
  const isPill = (id: string) => {
    const box = arrangement.boxes.find((candidate) => candidate.id === id)
    return box?.kind === 'node' && box.node.shape === 'pill'
  }
  const order = new Map(arrangement.boxes.map((box, index) => [box.id, index]))
  const across = (id: string) =>
    (ties.get(id) ?? []).filter((one) => columnAt.get(one.to) !== columnAt.get(id))

  // ── order: the pivot keeps the Scene's, the rest follow what they are tied to ──
  const ribbonsAt = new Map<number, number>()
  for (const ribbon of arrangement.ribbons)
    for (const end of [ribbon.from, ribbon.to]) {
      const column = columnAt.get(end)
      if (column !== undefined) ribbonsAt.set(column, (ribbonsAt.get(column) ?? 0) + 1)
    }
  const pivot = indices.reduce(
    (best, column) => ((ribbonsAt.get(column) ?? 0) > (ribbonsAt.get(best) ?? 0) ? column : best),
    indices[0] ?? 0,
  )
  const rank = new Map<string, number>()
  const rankColumn = (ids: string[]) =>
    ids.forEach((id, index) => rank.set(id, (index + 0.5) / ids.length))
  rankColumn(columns.get(pivot) ?? [])
  const byDistance = indices
    .filter((column) => column !== pivot)
    .sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot) || a - b)
  for (const column of byDistance) {
    const ids = columns.get(column)!
    const barycentre = (id: string) => {
      let sum = 0
      let weight = 0
      for (const one of across(id)) {
        const at = rank.get(one.to)
        if (at === undefined) continue
        sum += at * one.weight
        weight += one.weight
      }
      return weight > 0 ? sum / weight : Number.POSITIVE_INFINITY
    }
    const sorted = [...ids].sort(
      (a, b) => barycentre(a) - barycentre(b) || order.get(a)! - order.get(b)!,
    )
    columns.set(column, sorted)
    rankColumn(sorted)
  }

  // ── level: each box drawn toward what it is tied to, its column kept in order ──
  const top = new Map<string, number>()
  for (const ids of columns.values()) {
    const total = ids.reduce((sum, id) => sum + height(id), 0) + COLUMN_GAP * (ids.length - 1)
    let y = -total / 2
    for (const id of ids) {
      top.set(id, y)
      y += height(id) + COLUMN_GAP
    }
  }
  const centreOf = (id: string) => top.get(id)! + height(id) / 2
  const settle = (column: number) => {
    const ids = columns.get(column)!
    const wanted: number[] = []
    const weights: number[] = []
    for (const id of ids) {
      let sum = 0
      let weight = 0
      for (const one of across(id)) {
        if (!top.has(one.to)) continue
        sum += centreOf(one.to) * one.weight
        weight += one.weight
      }
      wanted.push(weight > 0 ? sum / weight : centreOf(id))
      weights.push(Math.max(0.05, weight))
    }
    const tops = settleColumn(ids.map(height), wanted, weights, COLUMN_GAP)
    ids.forEach((id, index) => top.set(id, tops[index]!))
  }
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (const column of byDistance) settle(column)
    if (columns.has(pivot)) settle(pivot)
  }

  // ── across: columns apart by one gap, a column of pills keeping no width ──
  const heights = [...columns.values()].map((ids) => {
    const tops = ids.map((id) => top.get(id)!)
    const bottoms = ids.map((id) => top.get(id)! + height(id))
    return Math.max(...bottoms) - Math.min(...tops)
  })
  const gap = columnGap(Math.max(0, ...heights))
  const columnWidth = (column: number) =>
    Math.max(0, ...(columns.get(column) ?? []).filter((id) => !isPill(id)).map(width))
  const left = new Map<number, number>()
  let x = 0
  const first = indices[0] ?? 0
  for (let column = first; column <= (indices.at(-1) ?? first); column += 1) {
    if (column > first) x += gap
    left.set(column, x)
    x += columnWidth(column)
  }

  const boxes = new Map<string, Rect>()
  const minTop = Math.min(0, ...[...top.values()])
  for (const [column, ids] of columns) {
    const at = left.get(column)!
    const axis = at + columnWidth(column) / 2
    for (const id of ids) {
      const w = width(id)
      boxes.set(id, {
        x: isPill(id) ? Math.round(axis - w / 2) : at,
        y: Math.round(top.get(id)! - minTop),
        width: w,
        height: height(id),
      })
    }
  }

  // ── junctions: before the boxes they accept, level with their middle ──
  for (const box of arrangement.boxes) {
    if (box.kind !== 'junction') continue
    const accepted = box.accepts.flatMap((id) => boxes.get(id) ?? [])
    if (accepted.length === 0) continue
    const size = models.get(box.id)!
    const ribbon = arrangement.ribbons.find((one) => one.from === box.id || one.to === box.id)
    const other = ribbon ? boxes.get(ribbon.from === box.id ? ribbon.to : ribbon.from) : undefined
    const nearX = Math.min(...accepted.map((rect) => rect.x))
    const farX = Math.max(...accepted.map((rect) => rect.x + rect.width))
    const fromLeft = !other || other.x + other.width / 2 <= nearX
    const middle =
      accepted.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / accepted.length
    boxes.set(box.id, {
      x: Math.round(
        fromLeft ? nearX - JUNCTION_REACH - size.width / 2 : farX + JUNCTION_REACH - size.width / 2,
      ),
      y: Math.round(middle - size.height / 2),
      width: size.width,
      height: size.height,
    })
  }
  return boxes
}

export interface Heading {
  column: number
  label: string
  rect: Rect
}

/**
 * Each band's heading where its column's boxes stand: over the column's left edge, every
 * heading on one line above the topmost box drawn.
 */
export function bandHeadings(
  arrangement: Arrangement,
  boxes: ReadonlyMap<string, Rect>,
): Heading[] {
  if (arrangement.bands.length === 0) return []
  const rects = new Map<number, Rect[]>()
  for (const box of arrangement.boxes) {
    const column = columnOf(box)
    const rect = boxes.get(box.id)
    if (column === undefined || !rect) continue
    rects.set(column, [...(rects.get(column) ?? []), rect])
  }
  const all = [...rects.values()].flat()
  if (all.length === 0) return []
  const top = Math.min(...all.map((rect) => rect.y))
  return arrangement.bands.flatMap((band) => {
    const column = rects.get(band.column)
    if (!column) return []
    const x = Math.min(...column.map((rect) => rect.x))
    const right = Math.max(...column.map((rect) => rect.x + rect.width))
    return [
      {
        column: band.column,
        label: band.label,
        rect: { x, y: top - HEADING_ROOM, width: Math.max(80, right - x), height: HEADING_H },
      },
    ]
  })
}
