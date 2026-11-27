/**
 * Where a selected rule's places lie that the canvas does not show: on which edge each one is,
 * the nearest first, and where along that edge its bearing crosses. A place shows when its
 * centre does; the rest are pointed to from the edge they lie past, so none goes unseen.
 *
 * A pointer sits on its edge, never on what is being read: nearest its bearing where it covers no
 * card the selection lights (nor another pointer), else where it covers least of them
 * (`placePointers`).
 */

import type { Frame } from './frame'
import type { Viewport } from './viewport'

import { rulePlaces } from '../scene/rules'
import { rectOf } from './frame'
import { overlaps, type Rect } from './geometry'

export type Side = 'top' | 'right' | 'bottom' | 'left'

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** What one edge points to. */
export interface EdgePointer {
  side: Side
  /** the places past it, nearest the centre of what shows first */
  ids: readonly string[]
  /** along the edge, in pane pixels: where the nearest one's bearing crosses it */
  at: number
}

/** The part of the pane that shows, in pane pixels. */
export interface Shown {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The places of the rules `ids`, by the id that frames each: a rule row on its card (the fold
 * that holds it while shut), or the link that carries it.
 */
export function placesOf(frame: Frame, ids: readonly string[]): Map<string, Rect> {
  const rects = new Map<string, Rect>()
  const places = rulePlaces(frame.scene)
  for (const place of ids.flatMap((id) => places.get(id) ?? [])) {
    const id = place.on === 'link' ? place.owner : (place.inner ?? place.row ?? place.owner)
    if (rects.has(id)) continue
    const rect = rectOf(frame, id)
    if (rect) rects.set(id, rect)
  }
  return rects
}

/** The places `rects` lays out that do not show, by the edge each lies past. */
export function offFrame(
  rects: ReadonlyMap<string, Rect>,
  viewport: Viewport,
  shown: Shown,
  /** how near an edge's ends a pointer may sit */
  keep = 32,
): EdgePointer[] {
  const halfW = (shown.right - shown.left) / 2
  const halfH = (shown.bottom - shown.top) / 2
  if (halfW <= keep || halfH <= keep) return []
  const cx = shown.left + halfW
  const cy = shown.top + halfH
  const past = new Map<Side, { id: string; distance: number; at: number }[]>()
  for (const [id, rect] of rects) {
    const x = (rect.x + rect.width / 2) * viewport.zoom + viewport.x
    const y = (rect.y + rect.height / 2) * viewport.zoom + viewport.y
    if (x >= shown.left && x <= shown.right && y >= shown.top && y <= shown.bottom) continue
    const dx = x - cx
    const dy = y - cy
    const across = Math.abs(dx) / halfW >= Math.abs(dy) / halfH
    const side: Side = across ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'
    const along = across ? cy + (dy * halfW) / Math.abs(dx) : cx + (dx * halfH) / Math.abs(dy)
    const [low, high] = across
      ? [shown.top + keep, shown.bottom - keep]
      : [shown.left + keep, shown.right - keep]
    const list = past.get(side) ?? []
    list.push({ id, distance: Math.hypot(dx, dy), at: Math.min(high, Math.max(low, along)) })
    past.set(side, list)
  }
  return SIDES.flatMap((side) => {
    const list = past.get(side)
    if (!list) return []
    list.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1))
    return [{ side, ids: list.map((one) => one.id), at: list[0]!.at }]
  })
}

/** A pointer's size on screen, as its words make it. */
export interface PointerSize {
  width: number
  height: number
}

/** A pointer placed: its top-left corner and size in pane pixels. */
export interface PlacedPointer {
  pointer: EdgePointer
  rect: Rect
}

/** How far a pointer keeps from what it must not cover. */
const CLEAR = 6
/** The step it moves along its edge by, looking for a free place. */
const STEP = 4

/**
 * Each pointer on its edge, `inset` in from it: centred where its bearing crosses when that covers
 * none of `cover` (in pane pixels), else at the nearest place along the edge that covers none,
 * else where it covers least. Pointers placed earlier are covered by later ones' rule too.
 */
export function placePointers(
  pointers: readonly EdgePointer[],
  shown: Shown,
  cover: readonly Rect[],
  sizeOf: (pointer: EdgePointer) => PointerSize,
  inset: number,
  /** how near an edge's ends a pointer's middle may sit */
  keep = 32,
): PlacedPointer[] {
  const taken: Rect[] = [...cover]
  return pointers.map((pointer) => {
    const size = sizeOf(pointer)
    const across = pointer.side === 'left' || pointer.side === 'right'
    const [start, end] = across ? [shown.top, shown.bottom] : [shown.left, shown.right]
    const half = (across ? size.height : size.width) / 2
    const low = start + Math.max(keep, half)
    const high = end - Math.max(keep, half)
    const rectAt = (middle: number) => pointerRect(pointer.side, middle, size, shown, inset)
    const covered = (rect: Rect) =>
      taken.reduce((sum, other) => sum + (overlaps(rect, other, CLEAR) ? area(rect, other) : 0), 0)
    let best: { rect: Rect; covers: number } | undefined
    if (low > high) best = { rect: rectAt((start + end) / 2), covers: 0 }
    else {
      const from = Math.min(high, Math.max(low, pointer.at))
      // Outward from the bearing, one step each way in turn: the first free place is the nearest.
      for (let away = 0; from - away >= low || from + away <= high; away += STEP) {
        for (const middle of away === 0 ? [from] : [from - away, from + away]) {
          if (middle < low || middle > high) continue
          const rect = rectAt(middle)
          const covers = covered(rect)
          if (!best || covers < best.covers) best = { rect, covers }
          if (covers === 0) break
        }
        if (best?.covers === 0) break
      }
    }
    taken.push(best!.rect)
    return { pointer, rect: best!.rect }
  })
}

/** A pointer's rect, its middle at `middle` along its edge and `inset` in from it. */
function pointerRect(
  side: Side,
  middle: number,
  size: PointerSize,
  shown: Shown,
  inset: number,
): Rect {
  const { width, height } = size
  switch (side) {
    case 'top':
      return { x: middle - width / 2, y: shown.top + inset, width, height }
    case 'bottom':
      return { x: middle - width / 2, y: shown.bottom - inset - height, width, height }
    case 'left':
      return { x: shown.left + inset, y: middle - height / 2, width, height }
    case 'right':
      return { x: shown.right - inset - width, y: middle - height / 2, width, height }
  }
}

/** How much of `a` grown by the clearance `b` covers. */
function area(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width + CLEAR) - Math.max(a.x, b.x - CLEAR)
  const height = Math.min(a.y + a.height, b.y + b.height + CLEAR) - Math.max(a.y, b.y - CLEAR)
  return Math.max(0, width) * Math.max(0, height)
}
