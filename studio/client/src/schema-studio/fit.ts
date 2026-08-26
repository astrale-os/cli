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
