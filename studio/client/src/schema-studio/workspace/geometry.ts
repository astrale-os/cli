import type { NodePosition } from '@shared/types'
import type { Node } from '@xyflow/react'

import { containerBoxSize, DOMAIN_BOX, nodeSize, type Geometry, sizeOfNode } from '../geometry'
import { DOMAIN_PAD } from '../palette'

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
}

export interface WorkspaceLayoutUpdate {
  domainId: string
  updates: Geometry
}

/**
 * Where a domain's own coordinates land inside its frame. A CONSTANT, not a stored
 * preference: the fit keeps the frame's content pinned to exactly one padding on the
 * leading edges (see `normalizeContainerLayout`), so this offset is the padding itself
 * and the frame's saved position stays the only thing a reader ever moves.
 */
export const DOMAIN_CONTENT_ORIGIN: WorkspacePoint = { x: DOMAIN_PAD, y: DOMAIN_PAD }

export const WORKSPACE_DOMAIN_GAP = 112
const SHELF_WIDTH = 1900

/** The frame-relative rectangles a domain's root nodes occupy. */
function contentRects(nodes: Node[]) {
  return nodes
    .filter((node) => !node.parentId)
    .map((node) => ({
      x: node.position.x + DOMAIN_CONTENT_ORIGIN.x,
      y: node.position.y + DOMAIN_CONTENT_ORIGIN.y,
      ...nodeSize(node),
    }))
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
): WorkspaceDomainFrame[] {
  const unpositioned = sources.map((source) => {
    const box = containerBoxSize(DOMAIN_BOX, contentRects(source.nodes))
    return { domainId: source.domainId, size: { width: box.w, height: box.h } }
  })
  const positions = positionFrames(unpositioned, savedPositions)
  return unpositioned.map((frame, index) => ({ ...frame, position: positions[index]! }))
}

export function workspaceGeometry(node: {
  data?: Record<string, unknown>
}): WorkspaceNodeGeometryData | null {
  return (node.data?.workspaceGeometry as WorkspaceNodeGeometryData | undefined) ?? null
}

/** One canvas node, back in the owner-local coordinates its domain persists. */
export function workspaceLayoutUpdate(node: Node): WorkspaceLayoutUpdate | null {
  const metadata = workspaceGeometry(node)
  if (!metadata) return null
  return {
    domainId: metadata.domainId,
    updates: {
      [metadata.localId]: {
        x: Math.round(node.position.x - metadata.offset.x),
        y: Math.round(node.position.y - metadata.offset.y),
        ...sizeOfNode(node),
      },
    },
  }
}
