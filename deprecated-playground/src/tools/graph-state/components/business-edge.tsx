import { BaseEdge, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react'

import { getClassColor, type BusinessEdgeData } from '../lib/business-to-flow'

export function BusinessEdgeComponent(props: EdgeProps<Edge<BusinessEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props
  if (!data) return null

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const color = getClassColor(data.edgeType)

  return (
    <BaseEdge
      path={edgePath}
      style={{
        stroke: selected ? 'var(--primary)' : color.stroke,
        strokeWidth: selected ? 2.5 : 1.5,
      }}
    />
  )
}
