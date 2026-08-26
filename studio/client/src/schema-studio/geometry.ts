import type { NodePosition } from '@shared/types'
import type { Node } from '@xyflow/react'

import { CLASS_H, CLASS_W, MODULE_HEADER, MODULE_PAD } from './palette'

export type Geometry = Record<string, NodePosition>

const NEW_NODE_GAP = 20

/** Persisted size is meaningful only for expanded module containers. */
export function sizeOfNode(node: Node): { w?: number; h?: number } {
  if (node.type !== 'group') return {}
  const width =
    (typeof node.measured?.width === 'number' ? node.measured.width : undefined) ??
    (typeof node.style?.width === 'number' ? node.style.width : undefined)
  const height =
    (typeof node.measured?.height === 'number' ? node.measured.height : undefined) ??
    (typeof node.style?.height === 'number' ? node.style.height : undefined)
  return width !== undefined && height !== undefined
    ? { w: Math.round(width), h: Math.round(height) }
    : {}
}

export function applyGeometry(node: Node, geometry: Geometry): Node {
  const position = geometry[node.id]
  if (!position) return node
  const next: Node = { ...node, position: { x: position.x, y: position.y } }
  if (node.type === 'group' && position.w !== undefined && position.h !== undefined) {
    next.style = { ...node.style, width: position.w, height: position.h }
  }
  return next
}

export function geometryOf(nodes: Node[]): Geometry {
  const geometry: Geometry = {}
  for (const node of nodes) {
    geometry[node.id] = {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      ...sizeOfNode(node),
    }
  }
  return geometry
}

/** Place only newly introduced nodes while preserving every known position. */
export function packPendingNodes(
  placed: { node: Node; position: Geometry[string] }[],
  pending: Node[],
): Geometry {
  let maxX = 0
  let minY = Number.POSITIVE_INFINITY
  const childY = new Map<string, number>()
  for (const { node, position } of placed) {
    if (node.parentId) {
      const below = position.y + ((node.style?.height as number) ?? CLASS_H) + NEW_NODE_GAP
      childY.set(node.parentId, Math.max(childY.get(node.parentId) ?? MODULE_HEADER, below))
    } else {
      maxX = Math.max(maxX, position.x + ((node.style?.width as number) ?? CLASS_W))
      minY = Math.min(minY, position.y)
    }
  }
  if (!Number.isFinite(minY)) minY = 0

  const trayX = maxX + 96
  let trayY = minY
  const geometry: Geometry = {}
  for (const node of pending) {
    if (node.parentId) {
      const y = childY.get(node.parentId) ?? MODULE_HEADER
      geometry[node.id] = { x: MODULE_PAD, y }
      childY.set(node.parentId, y + CLASS_H + NEW_NODE_GAP)
    } else {
      geometry[node.id] = { x: trayX, y: trayY, ...sizeOfNode(node) }
      trayY +=
        ((node.style?.height as number) ?? MODULE_HEADER + CLASS_H + MODULE_PAD) + NEW_NODE_GAP
    }
  }
  return geometry
}
