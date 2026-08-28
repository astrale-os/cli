import type { NodePosition } from '@shared/types'
import type { Node } from '@xyflow/react'

import { type Geometry, sizeOfNode } from '../geometry'
import { CLASS_H, CLASS_W } from '../palette'

export interface WorkspacePoint {
  x: number
  y: number
}

export interface WorkspaceSize {
  width: number
  height: number
}

export interface WorkspaceNodeGeometryData {
  domainId: string
  localId: string
  offset: NodePosition
}

export interface WorkspaceFrameSource {
  domainId: string
  nodes: Node[]
}

export interface WorkspaceDomainFrame {
  domainId: string
  position: WorkspacePoint
  size: WorkspaceSize
  contentOffset: WorkspacePoint
}

export interface WorkspaceLayoutUpdate {
  domainId: string
  updates: Geometry
}

export const DOMAIN_MIN_SIZE: WorkspaceSize = { width: 360, height: 220 }
export const MODULE_MIN_SIZE: WorkspaceSize = { width: 200, height: 120 }

const DOMAIN_PADDING = 52
export const WORKSPACE_DOMAIN_GAP = 112
const SHELF_WIDTH = 1900

function nodeSize(node: Node): WorkspaceSize {
  const fallback =
    node.type === 'classNode'
      ? { width: CLASS_W, height: CLASS_H }
      : node.type === 'moduleNode'
        ? { width: 200, height: 44 }
        : MODULE_MIN_SIZE
  return {
    width:
      node.measured?.width ??
      (typeof node.style?.width === 'number' ? node.style.width : fallback.width),
    height:
      node.measured?.height ??
      (typeof node.style?.height === 'number' ? node.style.height : fallback.height),
  }
}

function domainBounds(nodes: Node[]) {
  const roots = nodes.filter((node) => !node.parentId)
  if (roots.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of roots) {
    const size = nodeSize(node)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + size.width)
    maxY = Math.max(maxY, node.position.y + size.height)
  }
  return { minX, minY, maxX, maxY }
}

function packInitialFrames(frames: Omit<WorkspaceDomainFrame, 'position'>[]): WorkspacePoint[] {
  const positions: WorkspacePoint[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  for (const frame of frames) {
    if (x > 0 && x + frame.size.width > SHELF_WIDTH) {
      x = 0
      y += rowHeight + WORKSPACE_DOMAIN_GAP
      rowHeight = 0
    }
    positions.push({ x, y })
    x += frame.size.width + WORKSPACE_DOMAIN_GAP
    rowHeight = Math.max(rowHeight, frame.size.height)
  }
  return positions
}

function positionFrames(
  frames: Omit<WorkspaceDomainFrame, 'position'>[],
  savedPositions: Record<string, WorkspacePoint>,
): WorkspacePoint[] {
  const placed = frames.filter((frame) => savedPositions[frame.domainId])
  if (placed.length === 0) return packInitialFrames(frames)

  let x = placed.reduce((right, frame) => {
    const position = savedPositions[frame.domainId]!
    return Math.max(right, position.x + frame.size.width)
  }, 0)
  const y = placed.reduce(
    (top, frame) => Math.min(top, savedPositions[frame.domainId]!.y),
    Number.POSITIVE_INFINITY,
  )

  return frames.map((frame) => {
    const saved = savedPositions[frame.domainId]
    if (saved) return saved
    x += WORKSPACE_DOMAIN_GAP
    const position = { x, y: Number.isFinite(y) ? y : 0 }
    x += frame.size.width
    return position
  })
}

/**
 * Resolve stable domain frames. A frame wraps exactly what it holds — the same rule a
 * module box follows — so its SIZE is never a stored preference, only its position is.
 * Default positions are persisted by the caller after the first projection.
 */
export function layoutWorkspaceFrames(
  sources: WorkspaceFrameSource[],
  savedPositions: Record<string, WorkspacePoint>,
  savedContentOffsets: Record<string, WorkspacePoint>,
): WorkspaceDomainFrame[] {
  const unpositioned = sources.map((source) => {
    const bounds = domainBounds(source.nodes)
    // A saved offset may predate the current module metrics, which is how one domain
    // ended up with its modules flush against its frame while its neighbour had air.
    // Never let the content sit closer than the padding; a wider offset is the user's.
    const saved = savedContentOffsets[source.domainId]
    const contentOffset = {
      x: Math.max(saved?.x ?? Number.NEGATIVE_INFINITY, DOMAIN_PADDING - bounds.minX),
      // Even padding all round: the origin sits ON the frame's top edge, so there is no
      // header to reserve room for.
      y: Math.max(saved?.y ?? Number.NEGATIVE_INFINITY, DOMAIN_PADDING - bounds.minY),
    }
    // the same padding on the far side, so the frame never crowds its content
    return {
      domainId: source.domainId,
      contentOffset,
      size: {
        width: Math.max(DOMAIN_MIN_SIZE.width, bounds.maxX + contentOffset.x + DOMAIN_PADDING),
        height: Math.max(DOMAIN_MIN_SIZE.height, bounds.maxY + contentOffset.y + DOMAIN_PADDING),
      },
    }
  })
  const positions = positionFrames(unpositioned, savedPositions)
  return unpositioned.map((frame, index) => ({ ...frame, position: positions[index]! }))
}

export function workspaceGeometry(node: {
  data?: Record<string, unknown>
}): WorkspaceNodeGeometryData | null {
  return (node.data?.workspaceGeometry as WorkspaceNodeGeometryData | undefined) ?? null
}

export function workspaceLayoutUpdate(
  node: Node,
  resized?: WorkspaceSize,
): WorkspaceLayoutUpdate | null {
  const metadata = workspaceGeometry(node)
  if (!metadata) return null
  return {
    domainId: metadata.domainId,
    updates: {
      [metadata.localId]: {
        x: Math.round(node.position.x - metadata.offset.x),
        y: Math.round(node.position.y - metadata.offset.y),
        ...(resized
          ? { w: Math.round(resized.width), h: Math.round(resized.height) }
          : sizeOfNode(node)),
      },
    },
  }
}
