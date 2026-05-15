import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'

import type { GraphEdgeData } from '../lib/graph-state-to-flow'

export function GraphStateEdgeComponent(props: EdgeProps<Edge<GraphEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props
  if (!data) return null

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const propCount = Object.keys(data.properties).length

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: selected ? 'var(--primary)' : 'var(--border)',
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto nodrag nopan rounded bg-background px-1.5 py-0.5 text-xs border border-border shadow-sm"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <span className="font-medium">{data.edgeType}</span>
          {propCount > 0 && <span className="ml-1 text-muted-foreground">({propCount})</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
