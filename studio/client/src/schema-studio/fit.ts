import type { Node } from '@xyflow/react'

import { CLASS_H, CLASS_W } from './palette'

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

const PADDING = 0.12
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1

/**
 * Frame every node in the pane.
 *
 * React Flow's own `fitView` is queued behind its measurement lifecycle, so a
 * cold load can settle before it ever resolves and the canvas opens cropped.
 * We already know every node's geometry, so compute the viewport directly.
 *
 * Only top-level nodes are considered: children are positioned relative to
 * their module box, which already contains them.
 */
export function viewportForNodes(
  nodes: Node[],
  paneWidth: number,
  paneHeight: number,
): CanvasViewport | null {
  if (!paneWidth || !paneHeight) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    if (node.parentId) continue
    const width =
      node.measured?.width ?? (typeof node.style?.width === 'number' ? node.style.width : CLASS_W)
    const height =
      node.measured?.height ??
      (typeof node.style?.height === 'number' ? node.style.height : CLASS_H)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null

  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        paneWidth / ((maxX - minX) * (1 + PADDING)),
        paneHeight / ((maxY - minY) * (1 + PADDING)),
      ),
    ),
  )
  return {
    zoom,
    x: paneWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: paneHeight / 2 - ((minY + maxY) / 2) * zoom,
  }
}

/** A box in flow coordinates — a class card, a module box, a whole domain frame. */
export interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

/** Clear of the pane's own edge, so a revealed target never reads as clipped. */
const REVEAL_MARGIN = 24

/**
 * Where the viewport has to move for a whole target to read inside the pane — or null when
 * it already does, and the canvas should be left exactly where the reader put it.
 *
 * A target is usually ONE box (a class card, an imported domain's frame) and is panned to at
 * the zoom already chosen: a jump answers "where is it", not "how close do you want it". A
 * RELATIONSHIP is the exception — it is a line between two cards, so what has to land in the
 * pane is the span they define, and a span wider than the pane forces the zoom back just far
 * enough to hold the whole thing. Never further, and never closer.
 */
export function revealViewport(
  boxes: readonly CanvasBox[],
  current: CanvasViewport,
  paneWidth: number,
  paneHeight: number,
  minZoom: number,
): CanvasViewport | null {
  if (boxes.length === 0 || !paneWidth || !paneHeight) return null
  const centers = boxes.map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }))
  const shows = (point: { x: number; y: number }) => {
    const screenX = point.x * current.zoom + current.x
    const screenY = point.y * current.zoom + current.y
    return (
      screenX > REVEAL_MARGIN &&
      screenX < paneWidth - REVEAL_MARGIN &&
      screenY > REVEAL_MARGIN &&
      screenY < paneHeight - REVEAL_MARGIN
    )
  }
  if (centers.every(shows)) return null

  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  const zoom =
    boxes.length > 1
      ? Math.max(
          minZoom,
          Math.min(
            current.zoom,
            (paneWidth - REVEAL_MARGIN * 2) / Math.max(maxX - minX, 1),
            (paneHeight - REVEAL_MARGIN * 2) / Math.max(maxY - minY, 1),
          ),
        )
      : current.zoom
  return {
    zoom,
    x: paneWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: paneHeight / 2 - ((minY + maxY) / 2) * zoom,
  }
}
