import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

import { cn } from '@/lib/utils'

import type { SchemaNodeData } from '../lib/schema-to-flow'

const NODE_COLORS = [
  { border: 'border-blue-400', header: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  {
    border: 'border-emerald-400',
    header: 'bg-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
  },
  {
    border: 'border-violet-400',
    header: 'bg-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
  },
  { border: 'border-amber-400', header: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  { border: 'border-cyan-400', header: 'bg-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/40' },
  { border: 'border-rose-400', header: 'bg-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/40' },
]

const INTERFACE_COLOR = {
  border: 'border-gray-400 border-dashed',
  header: 'bg-gray-500',
  bg: 'bg-gray-50 dark:bg-gray-950/40',
}

function getColor(data: SchemaNodeData) {
  if (data.kind === 'interface') return INTERFACE_COLOR
  let hash = 0
  for (let i = 0; i < data.label.length; i++) {
    hash = (hash * 31 + data.label.charCodeAt(i)) | 0
  }
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length]
}

export function SchemaNodeComponent({ data, selected }: NodeProps<Node<SchemaNodeData>>) {
  const color = getColor(data)

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm transition-shadow min-w-[220px] overflow-hidden',
        color.border,
        color.bg,
        selected && 'ring-2 ring-primary shadow-md',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      {/* Header */}
      <div className={cn('px-3 py-1.5 text-white', color.header)}>
        <div className="flex items-center gap-1.5">
          {data.kind === 'interface' && (
            <span className="text-[10px] font-medium opacity-75">&laquo;interface&raquo;</span>
          )}
          <span className="text-xs font-bold">{data.label}</span>
        </div>
        {data.implements && data.implements.length > 0 && (
          <div className="text-[10px] opacity-75 mt-0.5">: {data.implements.join(', ')}</div>
        )}
      </div>

      {/* Attributes */}
      {data.attributes.length > 0 && (
        <div className="border-t border-border/30">
          {data.attributes.map((attr) => (
            <div
              key={attr}
              className="px-3 py-0.5 text-[11px] font-mono text-foreground/80 leading-[20px]"
            >
              {attr}
            </div>
          ))}
        </div>
      )}

      {/* Methods */}
      {data.methods.length > 0 && (
        <div className="border-t border-border/30">
          {data.methods.map((m) => (
            <div
              key={m.name}
              className="px-3 py-0.5 text-[11px] font-mono text-foreground/80 leading-[20px]"
            >
              <span className="text-violet-600 dark:text-violet-400">f</span> {m.name}()
              <span className="text-muted-foreground">: {m.returns}</span>
            </div>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}
