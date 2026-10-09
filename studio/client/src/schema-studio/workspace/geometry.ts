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
  /**
   * Room kept free on the frame's right for the imported frames that follow it there. Not
   * part of the frame: only what a newly placed domain must stay clear of.
   */
  trailing?: number
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

export interface WorkspaceRect {
  position: WorkspacePoint
  size: WorkspaceSize
}

export function rectsOverlap(a: WorkspaceRect, b: WorkspaceRect, gap: number): boolean {
  return (
    a.position.x < b.position.x + b.size.width + gap &&
    a.position.x + a.size.width + gap > b.position.x &&
    a.position.y < b.position.y + b.size.height + gap &&
    a.position.y + a.size.height + gap > b.position.y
  )
}

/** The empty space between two rectangles — 0 when they touch or overlap. */
function distanceBetween(a: WorkspaceRect, b: WorkspaceRect): number {
  const dx = Math.max(
    0,
    b.position.x - (a.position.x + a.size.width),
    a.position.x - (b.position.x + b.size.width),
  )
  const dy = Math.max(
    0,
    b.position.y - (a.position.y + a.size.height),
    a.position.y - (b.position.y + b.size.height),
  )
  return Math.hypot(dx, dy)
}

/** How much a canvas this wide and this tall costs to look at — a screen is landscape. */
const LANDSCAPE = 1.6

/**
 * A free spot for a frame beside what the canvas already holds.
 *
 * Nothing here moves: every obstacle is somewhere the reader (or an earlier placement) put
 * it, and the newcomer has to fit around it. The candidates are the edges the obstacles
 * offer — flush with one, or a gap right of or below it — so a hole a hand-moved domain left behind is filled
 * before the canvas grows, and growth goes whichever way keeps the whole thing closest to a
 * screen's shape. Between spots that cost the same, the one closest to an `anchor` wins — a
 * new domain sits next to the domains already there, not adrift in an empty corner or
 * tucked against an imported frame — then the one lined up with that neighbour, and the
 * last ties read like text: top first, then left.
 */
export function placeBeside(
  size: WorkspaceSize,
  obstacles: WorkspaceRect[],
  anchors: WorkspaceRect[] = obstacles,
  gap = WORKSPACE_DOMAIN_GAP,
): WorkspacePoint {
  if (obstacles.length === 0) return { x: 0, y: 0 }
  const left = Math.min(...obstacles.map((rect) => rect.position.x))
  const top = Math.min(...obstacles.map((rect) => rect.position.y))
  const right = Math.max(...obstacles.map((rect) => rect.position.x + rect.size.width))
  const bottom = Math.max(...obstacles.map((rect) => rect.position.y + rect.size.height))
  // Every edge a frame could line up with: flush with an obstacle, or one gap past it.
  const xs = [
    ...new Set(
      obstacles.flatMap((rect) => [rect.position.x, rect.position.x + rect.size.width + gap]),
    ),
  ]
  const ys = [
    ...new Set(
      obstacles.flatMap((rect) => [rect.position.y, rect.position.y + rect.size.height + gap]),
    ),
  ]

  let best: {
    position: WorkspacePoint
    score: number
    distance: number
    misalignment: number
  } | null = null
  for (const y of ys) {
    for (const x of xs) {
      const candidate = { position: { x, y }, size }
      if (obstacles.some((obstacle) => rectsOverlap(candidate, obstacle, gap))) continue
      const width = Math.max(right, x + size.width) - left
      const height = Math.max(bottom, y + size.height) - top
      const score = Math.max(width, height * LANDSCAPE)
      let distance = Number.POSITIVE_INFINITY
      let misalignment = Number.POSITIVE_INFINITY
      for (const anchor of anchors) {
        const apart = distanceBetween(candidate, anchor)
        const offset = Math.min(Math.abs(x - anchor.position.x), Math.abs(y - anchor.position.y))
        if (apart < distance || (apart === distance && offset < misalignment)) {
          distance = apart
          misalignment = offset
        }
      }
      const better =
        !best ||
        score < best.score ||
        (score === best.score &&
          (distance < best.distance ||
            (distance === best.distance &&
              (misalignment < best.misalignment ||
                (misalignment === best.misalignment &&
                  (y < best.position.y || (y === best.position.y && x < best.position.x)))))))
      if (better) best = { position: { x, y }, score, distance, misalignment }
    }
  }
  // The far right of everything is always free, so the search above cannot come back empty.
  return best?.position ?? { x: right + gap, y: top }
}

type UnpositionedFrame = Omit<WorkspaceDomainFrame, 'position'> & { trailing: number }

/** A frame together with the room its imported frames take up on its right. */
function footprint(frame: UnpositionedFrame): WorkspaceSize {
  return { width: frame.size.width + frame.trailing, height: frame.size.height }
}

function positionFrames(
  frames: UnpositionedFrame[],
  savedPositions: Record<string, WorkspacePoint>,
  fixed: WorkspaceRect[],
): WorkspacePoint[] {
  const placed = frames.filter((frame) => savedPositions[frame.domainId])
  if (placed.length === 0 && fixed.length === 0) return packInitialFrames(frames)

  const domains: WorkspaceRect[] = placed.map((frame) => ({
    position: savedPositions[frame.domainId]!,
    size: footprint(frame),
  }))
  return frames.map((frame) => {
    const saved = savedPositions[frame.domainId]
    if (saved) return saved
    const obstacles = [...fixed, ...domains]
    const size = footprint(frame)
    const position = placeBeside(size, obstacles, domains.length > 0 ? domains : obstacles)
    domains.push({ position, size })
    return position
  })
}

/**
 * Resolve stable domain frames. A frame wraps exactly what it holds — the same rule a
 * module box follows — so its SIZE is never a stored preference, only its position is.
 * Default positions are persisted by the caller after the first projection.
 *
 * A frame with no position yet never lands on one that has: saved frames, and the `fixed`
 * rectangles of anything else already placed on the canvas, stay exactly where they are
 * and the newcomer is fitted into the free space beside them.
 */
export function layoutWorkspaceFrames(
  sources: WorkspaceFrameSource[],
  savedPositions: Record<string, WorkspacePoint>,
  fixed: WorkspaceRect[] = [],
): WorkspaceDomainFrame[] {
  const unpositioned = sources.map((source) => {
    const box = containerBoxSize(DOMAIN_BOX, contentRects(source.nodes))
    return {
      domainId: source.domainId,
      size: { width: box.w, height: box.h },
      trailing: source.trailing ?? 0,
    }
  })
  const positions = positionFrames(unpositioned, savedPositions, fixed)
  return unpositioned.map(({ domainId, size }, index) => ({
    domainId,
    size,
    position: positions[index]!,
  }))
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
