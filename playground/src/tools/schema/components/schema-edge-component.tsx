import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'

import type { SchemaEdgeData } from '../lib/schema-to-flow'

export function SchemaEdgeComponent(props: EdgeProps<Edge<SchemaEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props
  if (!data) return null

  const isImplements = data.edgeKind === 'implements'

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: selected
            ? 'var(--primary)'
            : isImplements
              ? 'var(--muted-foreground)'
              : 'var(--border)',
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: isImplements ? '6 3' : undefined,
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
          <span className={isImplements ? 'text-muted-foreground italic' : 'font-medium'}>
            {data.label}
          </span>
          {!isImplements && data.sourceCardinality && data.targetCardinality && (
            <span className="ml-1 text-muted-foreground">
              {data.sourceCardinality}:{data.targetCardinality}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
