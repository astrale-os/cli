import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

import { cn } from '@/lib/utils'

import { getLabelColor, type GraphNodeData } from '../lib/graph-state-to-flow'

export function GraphStateNodeComponent({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const primaryLabel = data.labels[0] ?? 'unknown'
  const color = getLabelColor(primaryLabel)
  const name = (data.properties.name as string) || data.nodeId

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm transition-shadow overflow-hidden',
        color.border,
        color.bg,
        selected && 'ring-2 ring-primary shadow-md',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className={cn('px-3 py-1.5 text-white', color.header)}>
        <span className="text-xs font-semibold truncate block max-w-[200px]">{name}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}
