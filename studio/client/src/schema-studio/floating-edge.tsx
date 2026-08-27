import { SmartEdge } from '@tisoap/react-flow-smart-edge'
import {
  BaseEdge,
  type EdgeProps,
  EdgeText,
  type InternalNode,
  type Node,
  Position,
  getSmoothStepPath,
  useInternalNode,
} from '@xyflow/react'

import { useUI } from '@/lib/store'

import { type FloatingEdgePort, SMART_EDGE_RENDER_OPTIONS } from './edge-routing'

/** One end of a relationship as the schema declares it. */
export interface FloatingEdgeEnd {
  role?: string
  cardinality: string
}

interface FloatingEdgeData extends Record<string, unknown> {
  label?: string
  kind?: string
  selected?: boolean
  sourcePort?: FloatingEdgePort
  targetPort?: FloatingEdgePort
  sourceEnd?: FloatingEdgeEnd
  targetEnd?: FloatingEdgeEnd
}

// Standard react-flow "floating edge" geometry: connect at the node border on
// the side facing the other node, so edges take a sane path regardless of where
// the two nodes sit (no more everything-exits-the-bottom).

function getNodeIntersection(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const w = (intersectionNode.measured.width ?? 0) / 2
  const h = (intersectionNode.measured.height ?? 0) / 2
  const ip = intersectionNode.internals.positionAbsolute
  const tp = targetNode.internals.positionAbsolute
  const x2 = ip.x + w
  const y2 = ip.y + h
  const x1 = tp.x + (targetNode.measured.width ?? 0) / 2
  const y1 = tp.y + (targetNode.measured.height ?? 0) / 2
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 }
}

function getEdgePosition(node: InternalNode<Node>, point: { x: number; y: number }): Position {
  const n = node.internals.positionAbsolute
  const nx = Math.round(n.x)
  const ny = Math.round(n.y)
  const px = Math.round(point.x)
  const py = Math.round(point.y)
  if (px <= nx + 1) return Position.Left
  if (px >= nx + (node.measured.width ?? 0) - 1) return Position.Right
  if (py <= ny + 1) return Position.Top
  return Position.Bottom
}

function getEdgeParams(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sp = getNodeIntersection(source, target)
  const tp = getNodeIntersection(target, source)
  return {
    sx: sp.x,
    sy: sp.y,
    tx: tp.x,
    ty: tp.y,
    sourcePos: getEdgePosition(source, sp),
    targetPos: getEdgePosition(target, tp),
  }
}

function pointAtPort(
  node: InternalNode<Node>,
  port: FloatingEdgePort | undefined,
): { x: number; y: number; position: Position } | null {
  if (!port) return null
  const origin = node.internals.positionAbsolute
  const width = node.measured.width ?? 0
  const height = node.measured.height ?? 0
  if (width <= 0 || height <= 0) return null
  const offset = Math.min(1, Math.max(0, port.offset))

  switch (port.position) {
    case Position.Left:
      return { x: origin.x, y: origin.y + height * offset, position: port.position }
    case Position.Right:
      return { x: origin.x + width, y: origin.y + height * offset, position: port.position }
    case Position.Top:
      return { x: origin.x + width * offset, y: origin.y, position: port.position }
    case Position.Bottom:
      return { x: origin.x + width * offset, y: origin.y + height, position: port.position }
  }
}

function chipAtPort(
  point: { x: number; y: number },
  position: Position,
  other: { x: number; y: number },
): { x: number; y: number } | null {
  if (Math.hypot(other.x - point.x, other.y - point.y) < 110) return null
  const travel = 25
  switch (position) {
    case Position.Left:
      return { x: point.x - travel, y: point.y }
    case Position.Right:
      return { x: point.x + travel, y: point.y }
    case Position.Top:
      return { x: point.x, y: point.y - travel }
    case Position.Bottom:
      return { x: point.x, y: point.y + travel }
  }
}

export function FloatingEdge(props: EdgeProps) {
  const { id, source, target, style, data } = props
  const showCardinality = useUI((state) => state.showCardinality)
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const d = data as FloatingEdgeData | undefined
  const sourcePort = pointAtPort(sourceNode, d?.sourcePort)
  const targetPort = pointAtPort(targetNode, d?.targetPort)
  const fallback = getEdgeParams(sourceNode, targetNode)
  const sx = sourcePort?.x ?? fallback.sx
  const sy = sourcePort?.y ?? fallback.sy
  const tx = targetPort?.x ?? fallback.tx
  const ty = targetPort?.y ?? fallback.ty
  const sourcePosition = sourcePort?.position ?? fallback.sourcePos
  const targetPosition = targetPort?.position ?? fallback.targetPos

  // A dashed inheritance trace already says "extends". Repeating that word on every long
  // connector adds noise without information, so relationship labels keep the visual priority.
  const label = d?.kind === 'extends' ? undefined : d?.label
  const selected = d?.selected === true
  const strokeColor = selected
    ? 'var(--color-primary)'
    : ((style?.stroke as string) ?? 'var(--color-muted-foreground)')
  const edgeStyle = selected ? { ...style, stroke: strokeColor, strokeWidth: 3 } : style
  const chipLabelStyle = { fill: 'var(--color-muted-foreground)' }
  const chipBgStyle = { fill: 'var(--color-card)', stroke: 'var(--color-border)' }
  const sourceChip = showCardinality ? d?.sourceEnd : undefined
  const targetChip = showCardinality ? d?.targetEnd : undefined
  const sourceChipAt = sourceChip
    ? chipAtPort({ x: sx, y: sy }, sourcePosition, { x: tx, y: ty })
    : null
  const targetChipAt = targetChip
    ? chipAtPort({ x: tx, y: ty }, targetPosition, { x: sx, y: sy })
    : null
  return (
    <>
      <SmartEdge
        {...props}
        sourceX={sx}
        sourceY={sy}
        targetX={tx}
        targetY={ty}
        sourcePosition={sourcePosition}
        targetPosition={targetPosition}
        preset="smoothstep"
        options={SMART_EDGE_RENDER_OPTIONS}
        style={edgeStyle}
        label={label}
        labelStyle={selected ? { fill: strokeColor, fontWeight: 600 } : chipLabelStyle}
        labelShowBg
        labelBgStyle={chipBgStyle}
        labelBgPadding={[6, 2]}
        labelBgBorderRadius={4}
        interactionWidth={18}
      />
      {sourceChip && sourceChipAt && (
        <g>
          <title>{endpointTitle(sourceChip, d?.label)}</title>
          <EdgeText
            x={sourceChipAt.x}
            y={sourceChipAt.y}
            label={sourceChip.cardinality}
            labelStyle={chipLabelStyle}
            labelShowBg
            labelBgStyle={chipBgStyle}
            labelBgPadding={[5, 1]}
            labelBgBorderRadius={4}
          />
        </g>
      )}
      {targetChip && targetChipAt && (
        <g>
          <title>{endpointTitle(targetChip, d?.label)}</title>
          <EdgeText
            x={targetChipAt.x}
            y={targetChipAt.y}
            label={targetChip.cardinality}
            labelStyle={chipLabelStyle}
            labelShowBg
            labelBgStyle={chipBgStyle}
            labelBgPadding={[5, 1]}
            labelBgBorderRadius={4}
          />
        </g>
      )}
    </>
  )
}

/** The chip shows the multiplicity alone; the role rides in the native tooltip. */
function endpointTitle(end: FloatingEdgeEnd, edge?: string): string {
  const subject = end.role ?? edge ?? 'this end'
  return `${subject}: ${end.cardinality}`
}

// Orthogonal "elbow" edge for the structural parent→child tree. The core canvas
// lays out strictly left→right, so we route from the parent's right edge into the
// child's left edge (flipping sides if a drag puts the child on the left) — a clean
// org-chart skeleton that reads apart from the bezier "wiring" of the typed edges.
export function TreeEdge({ id, source, target, style }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const sp = sourceNode.internals.positionAbsolute
  const tp = targetNode.internals.positionAbsolute
  const sw = sourceNode.measured.width ?? 0
  const sh = sourceNode.measured.height ?? 0
  const tw = targetNode.measured.width ?? 0
  const th = targetNode.measured.height ?? 0
  const childRight = tp.x >= sp.x
  const [path] = getSmoothStepPath({
    sourceX: childRight ? sp.x + sw : sp.x,
    sourceY: sp.y + sh / 2,
    sourcePosition: childRight ? Position.Right : Position.Left,
    targetX: childRight ? tp.x : tp.x + tw,
    targetY: tp.y + th / 2,
    targetPosition: childRight ? Position.Left : Position.Right,
    borderRadius: 16,
  })
  return <BaseEdge id={id} path={path} style={style} interactionWidth={18} />
}

export const edgeTypes = { floating: FloatingEdge, tree: TreeEdge }
