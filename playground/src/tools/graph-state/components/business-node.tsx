import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

import { getClassColor, isFixedColor, type BusinessNodeData } from '../lib/business-to-flow'

const HIDDEN_HANDLE = '!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0'

export function BusinessNodeComponent({ data, selected }: NodeProps<Node<BusinessNodeData>>) {
  const color = getClassColor(data.className)
  const showLabel = data.className && !isFixedColor(data.className)
  const { nodePicker } = useWorkspace()
  const isPicking = !!nodePicker

  return (
    <div
      className={cn(
        'rounded-md shadow-sm transition-all overflow-hidden cursor-pointer',
        selected
          ? 'ring-2 ring-primary shadow-lg shadow-primary/25'
          : 'ring-1 ring-black/10 dark:ring-white/10',
        color.bg,
        isPicking && 'hover:ring-2 hover:ring-primary hover:shadow-lg hover:scale-105',
      )}
    >
      <Handle type="target" position={Position.Top} id="target-top" className={HIDDEN_HANDLE} />
      <Handle
        type="target"
        position={Position.Bottom}
        id="target-bottom"
        className={HIDDEN_HANDLE}
      />
      <Handle type="target" position={Position.Left} id="target-left" className={HIDDEN_HANDLE} />
      <Handle type="target" position={Position.Right} id="target-right" className={HIDDEN_HANDLE} />

      <Handle type="source" position={Position.Top} id="source-top" className={HIDDEN_HANDLE} />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        className={HIDDEN_HANDLE}
      />
      <Handle type="source" position={Position.Left} id="source-left" className={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Right} id="source-right" className={HIDDEN_HANDLE} />

      <div
        className={cn(
          'px-2.5 py-1 text-white flex items-center gap-1.5 min-w-[80px]',
          color.header,
        )}
      >
        {showLabel && (
          <span className="text-[9px] font-medium opacity-75 uppercase shrink-0">
            {data.className}
          </span>
        )}
        <span className="text-[11px] font-semibold truncate">{data.displayName}</span>
      </div>
    </div>
  )
}
