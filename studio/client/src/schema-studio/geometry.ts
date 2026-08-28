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

/** Smallest a module box may get: one class row, padded, clear of the header. */
export const MODULE_MIN_W = CLASS_W + MODULE_PAD * 2
export const MODULE_MIN_H = MODULE_HEADER + CLASS_H + MODULE_PAD

/**
 * A class belongs to the PADDED area of its box: never on the module label, never
 * flush against a side. The box has no bottom/right bound — it grows to follow.
 */
export function clampInsideModule(position: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.max(position.x, MODULE_PAD), y: Math.max(position.y, MODULE_HEADER) }
}

/** The box that exactly wraps `children` (parent-relative offsets) plus its padding. */
export function moduleBoxSize(children: { x: number; y: number }[]): { w: number; h: number } {
  let w = MODULE_MIN_W
  let h = MODULE_MIN_H
  for (const child of children) {
    w = Math.max(w, child.x + CLASS_W + MODULE_PAD)
    h = Math.max(h, child.y + CLASS_H + MODULE_PAD)
  }
  return { w: Math.round(w), h: Math.round(h) }
}

/**
 * Re-size module boxes so each one exactly wraps its classes.
 *
 * Load-bearing in BOTH directions: a box left too small drops a class on top of a
 * sibling, and a box left too large never gives the space back when the classes are
 * dragged together. Returns only the boxes that had to change, so the caller can
 * persist just that.
 */
export function fitModuleBoxes(nodes: Node[], geometry: Geometry): Geometry {
  const children = new Map<string, { x: number; y: number }[]>()
  for (const node of nodes) {
    if (node.type === 'group') children.set(node.id, children.get(node.id) ?? [])
  }
  for (const node of nodes) {
    const siblings = node.parentId ? children.get(node.parentId) : undefined
    const position = geometry[node.id]
    if (siblings && position) siblings.push(position)
  }

  const fitted: Geometry = {}
  for (const [id, siblings] of children) {
    const box = geometry[id]
    if (!box) continue
    const size = moduleBoxSize(siblings)
    if (size.w !== box.w || size.h !== box.h) fitted[id] = { ...box, ...size }
  }
  return fitted
}

/**
 * The painted counterpart of `fitModuleBoxes`: clamp every class into its module's
 * padded area, then size every box around what it now holds. Runs on each drag frame,
 * so the box tracks the class both ways — out as it grows, back as it shrinks.
 */
export function normalizeModuleLayout(nodes: Node[]): Node[] {
  const boxes = new Map<string, { w: number; h: number }>()
  for (const node of nodes) {
    if (node.type === 'group') boxes.set(node.id, { w: MODULE_MIN_W, h: MODULE_MIN_H })
  }
  if (boxes.size === 0) return nodes

  // only module children: an imported domain's members carry a parentId too, and
  // their box has its own (smaller) header.
  const clamped = nodes.map((node) => {
    if (!node.parentId || !boxes.has(node.parentId)) return node
    const inside = clampInsideModule(node.position)
    return inside.x === node.position.x && inside.y === node.position.y
      ? node
      : { ...node, position: inside }
  })

  for (const node of clamped) {
    const box = node.parentId ? boxes.get(node.parentId) : undefined
    if (!box) continue
    const size = moduleBoxSize([node.position])
    box.w = Math.max(box.w, size.w)
    box.h = Math.max(box.h, size.h)
  }

  return clamped.map((node) => {
    const box = boxes.get(node.id)
    if (!box || (node.style?.width === box.w && node.style?.height === box.h)) return node
    return { ...node, style: { ...node.style, width: box.w, height: box.h } }
  })
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

  const all = [...placed.map((entry) => entry.node), ...pending]
  const known = Object.fromEntries(placed.map((entry) => [entry.node.id, entry.position]))
  return { ...geometry, ...fitModuleBoxes(all, { ...known, ...geometry }) }
}
