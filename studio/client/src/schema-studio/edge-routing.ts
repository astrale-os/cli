import type { SmartEdgeOptions, SmartEdgeProviderOptions } from '@tisoap/react-flow-smart-edge'

import { type Edge, type Node, Position } from '@xyflow/react'

import { CLASS_H, CLASS_W } from './palette'

const PORT_CORNER_MARGIN = 8
const PORT_MIN_GAP = 8
const PORT_EXIT_CLEARANCE = 48

function stableParity(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0) & 1
}

export interface FloatingEdgePort {
  position: Position
  /** Position along the selected side, from 0 (top/left) to 1 (bottom/right). */
  offset: number
}

interface NodeRect {
  x: number
  y: number
  width: number
  height: number
}

interface Attachment {
  edge: Edge
  end: 'source' | 'target'
  nodeId: string
  otherNodeId: string
  other: NodeRect
  primary: Position
  secondary: Position
  tertiary: Position
  dominance: number
  assigned: Position
}

interface PortPair {
  sourcePort?: FloatingEdgePort
  targetPort?: FloatingEdgePort
}

/** Shared, stable routing defaults. Keeping this object at module scope avoids invalidating routes. */
export const SMART_EDGE_PROVIDER_OPTIONS = {
  preset: 'smoothstep',
  gridRatio: 8,
  nodePadding: 10,
  borderRadius: 8,
  routeOnlyWhenBlocked: false,
  routeWhileDragging: false,
  debounceMs: 16,
  cacheSize: 1_000,
} satisfies SmartEdgeProviderOptions

/** Edge-local presentation: rounded circuit traces with bridges at unavoidable crossings. */
export const SMART_EDGE_RENDER_OPTIONS = {
  borderRadius: 8,
  hops: { radius: 5, borderRadius: 8 },
} satisfies SmartEdgeOptions

function dimension(node: Node, axis: 'width' | 'height'): number {
  const measured = node.measured?.[axis]
  if (typeof measured === 'number' && measured > 0) return measured
  const styled = node.style?.[axis]
  if (typeof styled === 'number' && styled > 0) return styled
  return axis === 'width' ? CLASS_W : CLASS_H
}

function absoluteRects(nodes: Node[]): Map<string, NodeRect> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rects = new Map<string, NodeRect>()
  const visiting = new Set<string>()

  const resolve = (node: Node): NodeRect => {
    const cached = rects.get(node.id)
    if (cached) return cached

    // A malformed parent cycle should not blank the canvas. Treat that node as a root.
    if (visiting.has(node.id)) {
      return {
        x: node.position.x,
        y: node.position.y,
        width: dimension(node, 'width'),
        height: dimension(node, 'height'),
      }
    }

    visiting.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const parentRect = parent ? resolve(parent) : undefined
    const rect = {
      x: node.position.x + (parentRect?.x ?? 0),
      y: node.position.y + (parentRect?.y ?? 0),
      width: dimension(node, 'width'),
      height: dimension(node, 'height'),
    }
    visiting.delete(node.id)
    rects.set(node.id, rect)
    return rect
  }

  for (const node of nodes) resolve(node)
  return rects
}

const sideLength = (rect: NodeRect, side: Position) =>
  side === Position.Left || side === Position.Right ? rect.height : rect.width

function sideCapacity(rect: NodeRect, side: Position): number {
  const usable = Math.max(0, sideLength(rect, side) - PORT_CORNER_MARGIN * 2)
  return Math.max(1, Math.floor(usable / PORT_MIN_GAP) + 1)
}

function candidateSides(
  node: NodeRect,
  other: NodeRect,
  stableKey: string,
): Pick<Attachment, 'primary' | 'secondary' | 'tertiary' | 'dominance'> {
  const nodeX = node.x + node.width / 2
  const nodeY = node.y + node.height / 2
  const otherX = other.x + other.width / 2
  const otherY = other.y + other.height / 2
  const dx = otherX - nodeX
  const dy = otherY - nodeY
  // Choose the dominant canvas axis, not the side hit by a centre-to-centre ray. Class cards
  // are much wider than they are tall; normalising by their dimensions made a small vertical
  // offset outweigh hundreds of horizontal pixels and sent routes through stacked neighbours.
  const horizontal = Math.abs(dx)
  const vertical = Math.abs(dy)
  const horizontalSide = dx >= 0 ? Position.Right : Position.Left
  const verticalSide =
    Math.abs(dy) < 0.5
      ? stableParity(stableKey) === 0
        ? Position.Top
        : Position.Bottom
      : dy >= 0
        ? Position.Bottom
        : Position.Top
  const oppositeHorizontal = horizontalSide === Position.Left ? Position.Right : Position.Left
  const oppositeVertical = verticalSide === Position.Top ? Position.Bottom : Position.Top

  return horizontal >= vertical
    ? {
        primary: horizontalSide,
        secondary: verticalSide,
        tertiary: oppositeVertical,
        dominance: horizontal - vertical,
      }
    : {
        primary: verticalSide,
        secondary: horizontalSide,
        tertiary: oppositeHorizontal,
        dominance: vertical - horizontal,
      }
}

function contains(outer: NodeRect, inner: NodeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}

function overlaps(left: NodeRect, right: NodeRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function sideIsBlocked(
  rect: NodeRect,
  side: Position,
  rects: Map<string, NodeRect>,
  nodeId: string,
  otherNodeId: string,
): boolean {
  const inset = Math.min(PORT_CORNER_MARGIN, sideLength(rect, side) / 4)
  const corridor =
    side === Position.Left
      ? {
          x: rect.x - PORT_EXIT_CLEARANCE,
          y: rect.y + inset,
          width: PORT_EXIT_CLEARANCE,
          height: rect.height - inset * 2,
        }
      : side === Position.Right
        ? {
            x: rect.x + rect.width,
            y: rect.y + inset,
            width: PORT_EXIT_CLEARANCE,
            height: rect.height - inset * 2,
          }
        : side === Position.Top
          ? {
              x: rect.x + inset,
              y: rect.y - PORT_EXIT_CLEARANCE,
              width: rect.width - inset * 2,
              height: PORT_EXIT_CLEARANCE,
            }
          : {
              x: rect.x + inset,
              y: rect.y + rect.height,
              width: rect.width - inset * 2,
              height: PORT_EXIT_CLEARANCE,
            }

  for (const [obstacleId, obstacle] of rects) {
    if (obstacleId === nodeId || obstacleId === otherNodeId) continue
    // Compound parents contain their children by design; neither should make every exit from
    // the other look blocked.
    if (contains(obstacle, rect) || contains(rect, obstacle)) continue
    if (overlaps(corridor, obstacle)) return true
  }
  return false
}

function balanceSides(rect: NodeRect, attachments: Attachment[], rects: Map<string, NodeRect>) {
  const sides = [Position.Left, Position.Right, Position.Top, Position.Bottom]
  const count = (side: Position) => attachments.filter((item) => item.assigned === side).length

  // Four sides are enough to settle every realistic class fan-in. The loop limit is merely a
  // guard against malformed zero-sized geometry producing an impossible capacity graph.
  for (let pass = 0; pass < attachments.length * 4; pass += 1) {
    const overloaded = sides.find((side) => count(side) > sideCapacity(rect, side))
    if (!overloaded) return

    const candidate = attachments
      .filter(
        (item) =>
          item.assigned === overloaded &&
          [item.secondary, item.tertiary].some(
            (side) => side !== overloaded && count(side) < sideCapacity(rect, side),
          ),
      )
      .flatMap((item) =>
        [item.secondary, item.tertiary]
          .filter((side) => side !== overloaded && count(side) < sideCapacity(rect, side))
          .map((side) => ({
            item,
            side,
            blocked: sideIsBlocked(rect, side, rects, item.nodeId, item.otherNodeId),
          })),
      )
      .sort(
        (left, right) =>
          Number(left.blocked) - Number(right.blocked) ||
          count(left.side) - count(right.side) ||
          left.item.dominance - right.item.dominance ||
          left.item.edge.id.localeCompare(right.item.edge.id) ||
          left.item.end.localeCompare(right.item.end),
      )[0]
    if (!candidate) return
    candidate.item.assigned = candidate.side
  }
}

function attachmentOrder(left: Attachment, right: Attachment): number {
  const vertical = left.assigned === Position.Left || left.assigned === Position.Right
  const leftAxis = vertical
    ? left.other.y + left.other.height / 2
    : left.other.x + left.other.width / 2
  const rightAxis = vertical
    ? right.other.y + right.other.height / 2
    : right.other.x + right.other.width / 2
  const leftLabel = String(left.edge.data?.label ?? left.edge.data?.edgeClass ?? '')
  const rightLabel = String(right.edge.data?.label ?? right.edge.data?.edgeClass ?? '')
  return (
    leftAxis - rightAxis ||
    leftLabel.localeCompare(rightLabel) ||
    left.edge.id.localeCompare(right.edge.id) ||
    left.end.localeCompare(right.end)
  )
}

function offsetsFor(count: number, length: number): number[] {
  if (count <= 1) return [0.5]
  const margin = Math.min(0.35, PORT_CORNER_MARGIN / Math.max(length, 1))
  const span = 1 - margin * 2
  return Array.from({ length: count }, (_, index) =>
    Number((margin + (span * index) / (count - 1)).toFixed(4)),
  )
}

/**
 * Give every floating edge a deterministic logical port. Besides separating true parallel edges,
 * this prevents high-degree nodes (Company in the CRM fixture) from collapsing every arrowhead
 * onto one border pixel. Parent-relative React Flow positions are resolved before sides are chosen.
 */
export function assignFloatingEdgePorts(nodes: Node[], edges: Edge[]): Edge[] {
  if (nodes.length === 0 || edges.length === 0) return edges
  const rects = absoluteRects(nodes)
  const byNode = new Map<string, Attachment[]>()

  for (const edge of edges) {
    if (edge.type !== 'floating' || edge.source === edge.target) continue
    const source = rects.get(edge.source)
    const target = rects.get(edge.target)
    if (!source || !target) continue

    const sourceSides = candidateSides(source, target, `${edge.id}:source`)
    const targetSides = candidateSides(target, source, `${edge.id}:target`)
    const sourceAttachment: Attachment = {
      edge,
      end: 'source',
      nodeId: edge.source,
      otherNodeId: edge.target,
      other: target,
      ...sourceSides,
      assigned: sourceSides.primary,
    }
    const targetAttachment: Attachment = {
      edge,
      end: 'target',
      nodeId: edge.target,
      otherNodeId: edge.source,
      other: source,
      ...targetSides,
      assigned: targetSides.primary,
    }
    byNode.set(edge.source, [...(byNode.get(edge.source) ?? []), sourceAttachment])
    byNode.set(edge.target, [...(byNode.get(edge.target) ?? []), targetAttachment])
  }

  const ports = new Map<string, PortPair>()
  for (const [nodeId, attachments] of byNode) {
    const rect = rects.get(nodeId)
    if (!rect) continue
    balanceSides(rect, attachments, rects)

    for (const side of [Position.Left, Position.Right, Position.Top, Position.Bottom]) {
      const onSide = attachments.filter((item) => item.assigned === side).sort(attachmentOrder)
      const offsets = offsetsFor(onSide.length, sideLength(rect, side))
      onSide.forEach((attachment, index) => {
        const pair = ports.get(attachment.edge.id) ?? {}
        pair[attachment.end === 'source' ? 'sourcePort' : 'targetPort'] = {
          position: side,
          offset: offsets[index] ?? 0.5,
        }
        ports.set(attachment.edge.id, pair)
      })
    }
  }

  return edges.map((edge) => {
    const pair = ports.get(edge.id)
    return pair ? { ...edge, data: { ...edge.data, ...pair } } : edge
  })
}
