/**
 * Where the camera goes for a selection: its neighbourhood — the selection, what its links
 * reach, and the names on those links — whole, at the largest zoom up to `READING_ZOOM` that
 * shows it. Computed from the selection and the pane alone, never from where the camera stood,
 * so one selection always lands the same way.
 *
 * A neighbourhood is lowered to its legible zoom (`legibleZoomOf`) before anything of it is
 * left out. One that
 * still does not fit is drawn in (`drawIn`): what it reaches in other bands reads by name
 * alone, flush against the side facing the selection. Only one that does not fit even drawn
 * in keeps the selection and what fits with it — what stands later in the flow before what
 * stands earlier, nearest first.
 */

import type { Neighbourhood } from '../scene/focus'
import type { Scene } from '../scene/types'
import type { Frame } from './frame'
import type { PlacedLabel } from './labels'
import type { TextMeasure } from './metrics'

import { rectOf } from './frame'
import { type Rect, union } from './geometry'
import { curveLabels } from './labels'
import { boxModel, FONTS, LEGIBLE_TEXT, READING_ZOOM, rowRect } from './metrics'
import { drawnAlone } from './ribbons'
import {
  clampZoom,
  fitViewport,
  type Insets,
  revealRect,
  shownSize,
  type Viewport,
} from './viewport'

/** The least zoom a framed neighbourhood is read at: card names read at 8 px and up. */
export const LEGIBLE_ZOOM = 0.64

/**
 * The least zoom a neighbourhood of `scene` is framed at: where its cards carry rules, the zoom
 * their phrases read at (`rulesLegible`), so a selection lands where its rules read; else
 * `LEGIBLE_ZOOM`.
 */
export const legibleZoomOf = (scene: Scene): number =>
  scene.nodes.some((node) => (node.rules?.length ?? 0) > 0)
    ? Math.max(LEGIBLE_ZOOM, LEGIBLE_TEXT.show / FONTS.ruleText.size)
    : LEGIBLE_ZOOM
/** The room kept around a framed neighbourhood. */
export const FRAME_PADDING = 56

/** The rect drawn for a scene node — its row, when its box draws it as one — or for any id. */
export function nodeRect(frame: Frame, node: string): Rect | undefined {
  const box = frame.arrangement.boxOf.get(node)
  if (!box) return undefined
  const rect = frame.placement.boxes.get(box)
  return rowRect(frame.placement.models.get(box), rect, node) ?? rect
}

const middleOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

/** The column `selected` stands in: its node's, or its members' when it is a group. */
function columnOf(scene: Scene, selected: string): number | undefined {
  const own = scene.nodes.find((node) => node.id === selected)
  if (own) return own.column
  return scene.nodes.find((node) => node.group === selected)?.column
}

/** The names a focus's own lines read, wherever the camera stands: what framing keeps in view. */
export function focusLabels(
  frame: Frame,
  lit: Neighbourhood | null,
  measure: TextMeasure,
): PlacedLabel[] {
  if (!lit || frame.arrangement.lines !== 'ribbons') return []
  const { curves, leavesRow } = drawnAlone(frame, lit, new Set())
  const named = new Map([...curves].filter(([id]) => lit.links.has(id)))
  const { scene, arrangement, placement } = frame
  return curveLabels(scene, arrangement, placement, named, leavesRow, measure, (id) =>
    lit.links.has(id),
  )
}

/** The room a walk's numbered step takes beside what it numbers (see `walkSteps`). */
const STEP_ROOM = 28

/** Where a relationship a walk follows is read: along its whole line, with room for its step. */
function walkedLinkRect(frame: Frame, id: string): Rect | undefined {
  const place = frame.arrangement.linkPlace.get(id)
  const route = place?.trunk ? frame.placement.routes.get(place.trunk) : undefined
  if (!route || route.length === 0) return undefined
  const xs = route.map((point) => point.x)
  const ys = route.map((point) => point.y)
  const left = Math.min(...xs) - STEP_ROOM
  const top = Math.min(...ys) - STEP_ROOM
  return {
    x: left,
    y: top,
    width: Math.max(...xs) + STEP_ROOM - left,
    height: Math.max(...ys) + STEP_ROOM - top,
  }
}

/**
 * Where a walk is read: each relationship it walks along its whole line, with room for the
 * step numbered on it — so framing a rule that walks keeps every numbered step in the pane.
 */
function walkRects(frame: Frame, lit: Neighbourhood | null): Rect[] {
  return (lit?.walk?.ids ?? []).flatMap((id) => walkedLinkRect(frame, id) ?? [])
}

/** What a walk reads, in walking order: each Class it reaches, each relationship it follows. */
function walkPlaces(frame: Frame, lit: Neighbourhood | null): Rect[] {
  return (lit?.walk?.ids ?? []).flatMap(
    (id) => nodeRect(frame, id) ?? walkedLinkRect(frame, id) ?? [],
  )
}

export interface FocusView {
  viewport: Viewport
  /** whether the whole neighbourhood shows at `viewport` */
  whole: boolean
  /** what `viewport` frames: the neighbourhood, or the part of it kept */
  shows: Rect
}

/**
 * The camera for `selected` and its neighbourhood `lit`, its `labels` included, in what the
 * insets leave of `pane`: the whole at the largest zoom up to `READING_ZOOM`, if that is at
 * least the scene's legible zoom (`legibleZoomOf`), or for a walk, `LEGIBLE_ZOOM`; else the selection and what fits with it at
 * that zoom or more — of a walk, its steps from the start as far as they fit, then what lies
 * nearest —; else the selection alone — a relationship with both its ends whole, a card
 * across whole — below it.
 * None for what the frame does not draw.
 */
export function focusView(
  frame: Frame,
  lit: Neighbourhood | null,
  selected: string,
  labels: readonly PlacedLabel[],
  pane: { width: number; height: number },
  insets: Insets,
): FocusView | undefined {
  const legible = legibleZoomOf(frame.scene)
  const own =
    (frame.scene.nodes.some((node) => node.id === selected)
      ? nodeRect(frame, selected)
      : undefined) ?? rectOf(frame, selected)
  if (!own) return undefined
  const options = { insets, padding: FRAME_PADDING, maxZoom: READING_ZOOM }
  const reached = [...(lit?.nodes ?? [])].flatMap((node) => nodeRect(frame, node) ?? [])
  const whole = union([own, ...reached, ...labels, ...walkRects(frame, lit)])!
  const fitted = fitViewport(whole, pane, options)
  if (fitted.zoom >= legible) return { viewport: fitted, whole: true, shows: whole }
  // A walk reads by its numbered steps and the names they stand by, more than by the phrases on
  // its cards: it shows whole where names still read before anything of it is left out.
  if (lit?.walk && fitted.zoom >= LEGIBLE_ZOOM)
    return { viewport: fitted, whole: true, shows: whole }

  const columns = new Map(frame.scene.nodes.map((node) => [node.id, node.column]))
  const column = columnOf(frame.scene, selected)
  const earlier = (node: string) => {
    const at = columns.get(node)
    return column !== undefined && at !== undefined && at < column ? 1 : 0
  }
  const from = middleOf(own)
  const away = (rect: Rect) => Math.hypot(middleOf(rect).x - from.x, middleOf(rect).y - from.y)
  const around = [...(lit?.nodes ?? [])]
    .flatMap((node) => {
      const rect = nodeRect(frame, node)
      return rect ? [{ node, rect, earlier: earlier(node), away: away(rect) }] : []
    })
    .sort((a, b) => a.earlier - b.earlier || a.away - b.away || (a.node < b.node ? -1 : 1))
  // A walk is kept from its start, step by step, as far as it reads; then what lies nearest.
  let held = own
  for (const rect of walkPlaces(frame, lit)) {
    const next = union([held, rect])!
    if (fitViewport(next, pane, options).zoom < legible) break
    held = next
  }
  for (const { rect } of around) {
    const next = union([held, rect])!
    if (fitViewport(next, pane, options).zoom >= legible) held = next
  }
  const kept = fitViewport(held, pane, options)
  if (kept.zoom >= legible) return { viewport: kept, whole: false, shows: held }
  // The selection alone is larger than what the pane shows at the legible zoom. A relationship
  // is its two ends: both whole, at the zoom they fit.
  if (frame.arrangement.linkPlace.has(selected))
    return { viewport: kept, whole: false, shows: held }
  // A card shows across whole — at the legible zoom where its width fits, else at the zoom it
  // does (a panel floating over a narrow canvas leaves a strip, and the selection is never drawn
  // under it) — centred, or its top where it is taller.
  const room = shownSize(pane, insets)
  const gap = Math.min(FRAME_PADDING, room.width / 10, room.height / 10)
  const zoom = clampZoom(Math.min(legible, (room.width - gap * 2) / Math.max(1, own.width)))
  const tall = own.height * zoom > room.height - gap * 2
  return {
    viewport: {
      zoom,
      x: insets.left + room.width / 2 - (own.x + own.width / 2) * zoom,
      y: tall
        ? insets.top + gap - own.y * zoom
        : insets.top + room.height / 2 - (own.y + own.height / 2) * zoom,
    },
    whole: false,
    shows: own,
  }
}

/**
 * Whether the camera at `view` already shows what `target` frames, whole and at its zoom:
 * framing it there would move every card on screen and show nothing more.
 */
export function alreadyFramed(
  view: Viewport,
  target: FocusView,
  pane: { width: number; height: number },
  insets: Insets,
): boolean {
  return (
    target.whole &&
    Math.abs(target.viewport.zoom - view.zoom) < 0.005 &&
    revealRect(view, target.shows, pane, insets) === view
  )
}

/**
 * `frame` with the bands `selected` reaches drawn in: every card standing in another column
 * than the selection's, where `lit` reaches, reads by name alone — its tallies are what every
 * function does with it, where the lit lines say what this one does — as narrow as that name,
 * flush against the side of its column facing the selection. Nothing else moves.
 */
export function drawIn(
  frame: Frame,
  lit: Neighbourhood,
  selected: string,
  measure: TextMeasure,
): Frame {
  const column = columnOf(frame.scene, selected)
  if (column === undefined) return frame
  const cards = frame.arrangement.boxes.flatMap((box) =>
    box.kind === 'node' && box.node.shape !== 'pill' && box.node.column !== undefined
      ? [{ box, at: box.node.column }]
      : [],
  )
  const reached = new Set(
    cards.flatMap(({ box, at }) => (at !== column && lit.boxes.has(box.id) ? [at] : [])),
  )
  const boxes = new Map(frame.placement.boxes)
  const models = new Map(frame.placement.models)
  let drawn = false
  for (const { box, at } of cards) {
    if (!reached.has(at) || !box.node.tallies?.length) continue
    const rect = boxes.get(box.id)
    if (!rect) continue
    const named = boxModel(
      { ...box, node: { ...box.node, tallies: [] } },
      frame.placement.detail,
      measure,
    )
    if (named.width >= rect.width) continue
    boxes.set(box.id, {
      x: at < column ? rect.x + rect.width - named.width : rect.x,
      y: rect.y,
      width: named.width,
      height: named.height,
    })
    models.set(box.id, named)
    drawn = true
  }
  return drawn ? { ...frame, placement: { ...frame.placement, boxes, models } } : frame
}
