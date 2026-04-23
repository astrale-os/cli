import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

import { CollapsibleValue } from '@/components/ui/collapsible-value'
import { InspectorSection } from '@/components/ui/inspector-section'
import { cn } from '@/lib/utils'

import type { BusinessGraph } from '../lib/raw-to-business'

import { getClassColor } from '../lib/business-to-flow'
import { NodeMethods } from './node-methods'

interface BusinessNodeDetailProps {
  graph: BusinessGraph
  nodeId: string
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function BusinessNodeDetail({ graph, nodeId }: BusinessNodeDetailProps) {
  const node = graph.nodes.find((n) => n.id === nodeId)
  const [copied, setCopied] = useState<'id' | 'path' | false>(false)
  if (!node) return null

  const color = getClassColor(node.className)
  const outgoing = graph.edges.filter((e) => e.sourceId === nodeId)
  const incoming = graph.edges.filter((e) => e.targetId === nodeId)
  const filteredProps = Object.entries(node.properties).filter(
    ([k]) => k !== 'name' && k !== 'slug',
  )

  const copy = (text: string, kind: 'id' | 'path') => {
    navigator.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header — always visible */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-lg break-all">{node.displayName}</h3>
          {node.className && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shrink-0',
                color.header,
              )}
            >
              {node.className}
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-1.5 group cursor-pointer"
          onClick={() => copy(node.id, 'id')}
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">id</span>
          <span className="text-xs font-mono text-muted-foreground break-all">{node.id}</span>
          {copied === 'id' ? (
            <Check className="w-3 h-3 text-green-500 shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          )}
        </div>
        {node.path && (
          <div
            className="flex items-center gap-1.5 group cursor-pointer"
            onClick={() => copy(node.path!, 'path')}
          >
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">path</span>
            <span className="text-xs font-mono text-muted-foreground break-all">{node.path}</span>
            {copied === 'path' ? (
              <Check className="w-3 h-3 text-green-500 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </div>
        )}
      </div>

      {/* Properties section */}
      {filteredProps.length > 0 && (
        <InspectorSection title="Properties" count={filteredProps.length} defaultOpen>
          <div className="rounded-lg border border-border divide-y divide-border bg-muted/30">
            {filteredProps.map(([k, v]) => (
              <div key={k} className="px-3 py-1.5 text-xs">
                <span className="text-muted-foreground font-mono">{k}</span>
                <CollapsibleValue>{formatValue(v)}</CollapsibleValue>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}

      {/* Methods section */}
      {node.className && (
        <InspectorSection title="Methods">
          <NodeMethods nodeId={node.id} className={node.className} />
        </InspectorSection>
      )}

      {/* Connections section */}
      {(outgoing.length > 0 || incoming.length > 0) && (
        <InspectorSection title="Connections" count={outgoing.length + incoming.length}>
          <div className="rounded-lg border border-border divide-y divide-border bg-muted/30 text-xs">
            {outgoing.map((e) => {
              const target = graph.nodes.find((n) => n.id === e.targetId)
              return (
                <div key={e.id} className="px-3 py-1.5 font-mono flex items-center gap-1">
                  <span className="text-muted-foreground">--[{e.type}]--&gt;</span>
                  <span className="text-foreground/80 truncate">
                    {target?.displayName ?? e.targetId}
                  </span>
                </div>
              )
            })}
            {incoming.map((e) => {
              const source = graph.nodes.find((n) => n.id === e.sourceId)
              return (
                <div key={e.id} className="px-3 py-1.5 font-mono flex items-center gap-1">
                  <span className="text-muted-foreground">&lt;--[{e.type}]--</span>
                  <span className="text-foreground/80 truncate">
                    {source?.displayName ?? e.sourceId}
                  </span>
                </div>
              )
            })}
          </div>
        </InspectorSection>
      )}

      {/* DB Labels section */}
      {node.rawLabels.length > 0 && (
        <InspectorSection title="DB Labels" count={node.rawLabels.length}>
          <div className="flex gap-1 flex-wrap">
            {node.rawLabels.map((l) => (
              <span key={l} className="rounded bg-secondary px-2 py-0.5 text-[10px] font-mono">
                {l}
              </span>
            ))}
          </div>
        </InspectorSection>
      )}
    </div>
  )
}
