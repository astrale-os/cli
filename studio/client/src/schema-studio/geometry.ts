import type { NodePosition } from '@shared/types'
import type { Node } from '@xyflow/react'

import {
  CLASS_H,
  CLASS_W,
  DOMAIN_PAD,
  MODULE_COLLAPSED_H,
  MODULE_HEADER,
  MODULE_PAD,
  VIEW_H,
  VIEW_W,
} from './palette'

export type Geometry = Record<string, NodePosition>

const NEW_NODE_GAP = 20

/** Persisted size is meaningful only for expanded module containers. */
export function sizeOfNode(node: Node): { w?: number; h?: number } {
  if (node.type !== 'group') return {}
  // `style` first: it holds the size the last fit wrote, while `measured` is the DOM one
  // frame behind it — persisting the stale one puts the box back where the fit just left.
  const width =
    (typeof node.style?.width === 'number' ? node.style.width : undefined) ??
    (typeof node.measured?.width === 'number' ? node.measured.width : undefined)
  const height =
    (typeof node.style?.height === 'number' ? node.style.height : undefined) ??
    (typeof node.measured?.height === 'number' ? node.measured.height : undefined)
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

// ── containers ──

/**
 * What a container keeps between its edges and what it holds. `top` is its own: a module
 * box reserves room for the label printed inside it, while a domain frame wears its
 * origin ON the top edge and needs no more room there than on any other side.
 */
interface ContainerInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ContainerSpec {
  insets: ContainerInsets
  min: { w: number; h: number }
}

/** A module box: padded all round, its top clear of the label. Empty, it is one class row. */
const MODULE_BOX: ContainerSpec = {
  insets: { left: MODULE_PAD, top: MODULE_HEADER, right: MODULE_PAD, bottom: MODULE_PAD },
  min: { w: CLASS_W + MODULE_PAD * 2, h: MODULE_HEADER + CLASS_H + MODULE_PAD },
}

/** A domain frame: one even padding all round. Empty, it is big enough to read as a place. */
export const DOMAIN_BOX: ContainerSpec = {
  insets: { left: DOMAIN_PAD, top: DOMAIN_PAD, right: DOMAIN_PAD, bottom: DOMAIN_PAD },
  min: { w: 360, h: 220 },
}

/**
 * The containers this canvas fits, by node type. A domain frame sits in the SAME table as
 * a module box on purpose: both wrap what they hold under one rule, so the pair cannot
 * drift into two behaviours. Anything absent is left where its own projection put it —
 * an imported domain's frame, for one, is laid out whole and must not be re-fitted.
 */
const CONTAINER_SPECS: Record<string, ContainerSpec> = {
  group: MODULE_BOX,
  workspaceDomain: DOMAIN_BOX,
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** What a node measures before anything has styled it (see palette.ts for the metrics). */
const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  classNode: { w: CLASS_W, h: CLASS_H },
  viewNode: { w: VIEW_W, h: VIEW_H },
  moduleNode: { w: MODULE_BOX.min.w, h: MODULE_COLLAPSED_H },
  group: MODULE_BOX.min,
  workspaceDomain: DOMAIN_BOX.min,
}

/**
 * Rendered size of a node — what the container holding it has to reserve. A styled size
 * wins over the default: it is what a fit (or the layout engine) last wrote, and for a
 * box it is the only place the current size lives.
 */
export function nodeSize(node: Node): { w: number; h: number } {
  const fallback = DEFAULT_SIZES[node.type ?? ''] ?? { w: CLASS_W, h: CLASS_H }
  const width = typeof node.style?.width === 'number' ? node.style.width : fallback.w
  const height = typeof node.style?.height === 'number' ? node.style.height : fallback.h
  return { w: width, h: height }
}

/**
 * The box that exactly wraps `children` (parent-relative rects) plus its own insets.
 *
 * `min` is the size of an EMPTY box, not a floor under a full one: a container that holds
 * something wraps it to the pixel, so the margin a reader sees is the same on all four
 * sides. (A module's min is exactly one padded class row, so the two agree anyway.)
 */
export function containerBoxSize(spec: ContainerSpec, children: Rect[]): { w: number; h: number } {
  if (children.length === 0) return { ...spec.min }
  let w = 0
  let h = 0
  for (const child of children) {
    w = Math.max(w, child.x + child.w + spec.insets.right)
    h = Math.max(h, child.y + child.h + spec.insets.bottom)
  }
  return { w: Math.round(w), h: Math.round(h) }
}

/** The box that exactly wraps `children` (parent-relative offsets) plus its padding. */
function moduleBoxSize(children: { x: number; y: number }[]): { w: number; h: number } {
  return containerBoxSize(
    MODULE_BOX,
    children.map((child) => ({ ...child, w: CLASS_W, h: CLASS_H })),
  )
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

/** Containers innermost first, so a box is re-fitted before whatever has to wrap it. */
function deepestFirst(ids: Iterable<string>, byId: Map<string, Node>): string[] {
  const depth = (id: string) => {
    let steps = 0
    let parent = byId.get(id)?.parentId
    while (parent && steps <= byId.size) {
      steps += 1
      parent = byId.get(parent)?.parentId
    }
    return steps
  }
  return [...ids].sort((left, right) => depth(right) - depth(left))
}

/**
 * Re-fit every container around what it holds — the painted counterpart of
 * `fitModuleBoxes`, and the whole of the canvas's containment rule.
 *
 * A box follows its content in all FOUR directions. Out to the right and down it simply
 * grows. Left and up it cannot, since its own origin is there — so instead the children
 * are shifted back onto the inset and the box's position absorbs exactly that shift.
 * Nothing moves on screen but the boundary, which is the point: dragging a class past the
 * left edge of its module widens the module leftwards rather than pinning the class.
 *
 * Deepest first, so the shift cascades: the class grows its module box, the grown module
 * box grows the domain frame that has to wrap it, in one pass. Runs on every drag frame,
 * so a container tracks its content both ways — out as it grows, back as it shrinks.
 */
export function normalizeContainerLayout(nodes: Node[]): Node[] {
  const containers = new Map<string, ContainerSpec>()
  for (const node of nodes) {
    const spec = node.type ? CONTAINER_SPECS[node.type] : undefined
    if (spec) containers.set(node.id, spec)
  }
  if (containers.size === 0) return nodes

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, Node[]>()
  for (const node of nodes) {
    if (!node.parentId || !containers.has(node.parentId)) continue
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  }

  const positions = new Map(nodes.map((node) => [node.id, node.position]))
  const sizes = new Map(nodes.map((node) => [node.id, nodeSize(node)]))
  const rect = (node: Node): Rect => ({ ...positions.get(node.id)!, ...sizes.get(node.id)! })

  for (const id of deepestFirst(containers.keys(), byId)) {
    const held = children.get(id) ?? []
    if (held.length === 0) continue
    const spec = containers.get(id)!
    const shift = {
      x: spec.insets.left - Math.min(...held.map((node) => positions.get(node.id)!.x)),
      y: spec.insets.top - Math.min(...held.map((node) => positions.get(node.id)!.y)),
    }
    if (shift.x !== 0 || shift.y !== 0) {
      for (const node of held) {
        const at = positions.get(node.id)!
        positions.set(node.id, { x: at.x + shift.x, y: at.y + shift.y })
      }
      const at = positions.get(id)!
      positions.set(id, { x: at.x - shift.x, y: at.y - shift.y })
    }
    sizes.set(id, containerBoxSize(spec, held.map(rect)))
  }

  return nodes.map((node) => {
    const at = positions.get(node.id)!
    const box = containers.has(node.id) ? sizes.get(node.id)! : undefined
    const moved = at.x !== node.position.x || at.y !== node.position.y
    const resized = box && (node.style?.width !== box.w || node.style?.height !== box.h)
    if (!moved && !resized) return node
    const next: Node = { ...node, position: at }
    if (resized) next.style = { ...node.style, width: box.w, height: box.h }
    return next
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
