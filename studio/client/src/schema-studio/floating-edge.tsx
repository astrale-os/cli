import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  EdgeLabelRenderer,
  type InternalNode,
  type Node,
  Position,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
} from '@xyflow/react'

const PARALLEL_EDGE_GAP = 32

interface FloatingEdgeData extends Record<string, unknown> {
  label?: string
  selected?: boolean
  parallelCount?: number
  parallelOffset?: number
}

/**
 * Assign stable, symmetric lanes to floating edges that connect the same unordered node pair.
 * Reciprocal edges share the same physical lane coordinate even though their source direction is
 * reversed. Single edges are returned untouched so their existing route never changes.
 */
export function separateParallelEdges(edges: Edge[]): Edge[] {
  const groups = new Map<string, Edge[]>()
  for (const edge of edges) {
    if (edge.type !== 'floating' || edge.source === edge.target) continue
    const [a, b] = [edge.source, edge.target].sort()
    const key = `${a}\u0000${b}`
    const group = groups.get(key)
    if (group) group.push(edge)
    else groups.set(key, [edge])
  }

  const lanes = new Map<string, Pick<FloatingEdgeData, 'parallelCount' | 'parallelOffset'>>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => {
      const aLabel = String(a.data?.label ?? a.data?.edgeClass ?? '')
      const bLabel = String(b.data?.label ?? b.data?.edgeClass ?? '')
      return aLabel.localeCompare(bLabel) || a.id.localeCompare(b.id)
    })
    const center = (ordered.length - 1) / 2
    ordered.forEach((edge, index) => {
      const canonicalOffset = (index - center) * PARALLEL_EDGE_GAP
      const canonicalDirection = edge.source < edge.target ? 1 : -1
      lanes.set(edge.id, {
        parallelCount: ordered.length,
        parallelOffset: canonicalOffset * canonicalDirection,
      })
    })
  }

  return edges.map((edge) => {
    const lane = lanes.get(edge.id)
    return lane ? { ...edge, data: { ...edge.data, ...lane } } : edge
  })
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

export function parallelEdgePath({
  sx,
  sy,
  tx,
  ty,
  offset,
}: {
  sx: number
  sy: number
  tx: number
  ty: number
  offset: number
}): [path: string, labelX: number, labelY: number] {
  const dx = tx - sx
  const dy = ty - sy
  const length = Math.hypot(dx, dy) || 1
  const normalX = -dy / length
  const normalY = dx / length
  // A quadratic curve reaches half its control-point displacement at t=.5, so double the
  // control offset to place the visible midpoint (and label) on the assigned lane.
  const controlX = (sx + tx) / 2 + normalX * offset * 2
  const controlY = (sy + ty) / 2 + normalY * offset * 2
  const labelX = sx * 0.25 + controlX * 0.5 + tx * 0.25
  const labelY = sy * 0.25 + controlY * 0.5 + ty * 0.25
  return [`M ${sx},${sy} Q ${controlX},${controlY} ${tx},${ty}`, labelX, labelY]
}

export function FloatingEdge({
  id,
  source,
  target,
  markerStart,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode)
  const d = data as FloatingEdgeData | undefined
  const [path, labelX, labelY] =
    (d?.parallelCount ?? 1) > 1
      ? parallelEdgePath({ sx, sy, tx, ty, offset: d?.parallelOffset ?? 0 })
      : getBezierPath({
          sourceX: sx,
          sourceY: sy,
          sourcePosition: sourcePos,
          targetX: tx,
          targetY: ty,
          targetPosition: targetPos,
          curvature: 0.25,
        })

  const label = d?.label
  const selected = d?.selected === true
  const strokeColor = selected
    ? 'var(--color-primary)'
    : ((style?.stroke as string) ?? 'var(--color-muted-foreground)')
  const edgeStyle = selected ? { ...style, stroke: strokeColor, strokeWidth: 3 } : style
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={edgeStyle}
        interactionWidth={18}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="absolute font-mono font-extrabold text-[9px] px-1 rounded pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: strokeColor,
              background: 'oklch(0.17 0.01 270)',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
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
