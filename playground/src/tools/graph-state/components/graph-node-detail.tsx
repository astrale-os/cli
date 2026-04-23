import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

import type { GraphStateData } from '@/lib/types'

import { CollapsibleValue } from '@/components/ui/collapsible-value'

import { getLabelColor } from '../lib/graph-state-to-flow'

interface GraphNodeDetailProps {
  graphState: GraphStateData
  nodeId: string
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function GraphNodeDetail({ graphState, nodeId }: GraphNodeDetailProps) {
  const node = graphState.nodes.find((n) => n.id === nodeId)
  const [copied, setCopied] = useState(false)
  if (!node) return null

  const { id, labels, _labels, ...rest } = node as Record<string, unknown>
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (k !== 'n') properties[k] = v
  }

  const nodeLabels = (labels as string[]) ?? []
  const name = (properties.name as string) || (id as string)
  const metaEntries = Object.entries(properties).filter(([k]) => k !== 'name' && k !== 'slug')

  const copyId = () => {
    navigator.clipboard.writeText(id as string)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {nodeLabels.map((l) => {
            const c = getLabelColor(l)
            return (
              <span
                key={l}
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${c.header}`}
              >
                {l}
              </span>
            )
          })}
        </div>
        {name && <h3 className="font-semibold text-lg break-all">{name}</h3>}
        <div className="flex items-center gap-1.5 group cursor-pointer" onClick={copyId}>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">id</span>
          <span className="text-xs font-mono text-muted-foreground break-all">{id as string}</span>
          {copied ? (
            <Check className="w-3 h-3 text-green-500 shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          )}
        </div>
      </div>

      {metaEntries.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-1.5">
            Properties
          </h4>
          <div className="rounded-lg border border-border divide-y divide-border bg-muted/30">
            {metaEntries.map(([k, v]) => (
              <div key={k} className="px-3 py-1.5 text-xs">
                <span className="text-muted-foreground font-mono">{k}</span>
                <CollapsibleValue>{formatValue(v)}</CollapsibleValue>
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const outgoing = graphState.edges.filter((e) => e.src === nodeId)
        const incoming = graphState.edges.filter((e) => e.dest === nodeId)
        if (outgoing.length === 0 && incoming.length === 0) return null

        return (
          <div>
            <h4 className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-1.5">
              Connections
            </h4>
            <div className="rounded-lg border border-border divide-y divide-border bg-muted/30 text-xs">
              {outgoing.map((e) => (
                <div
                  key={`${e.type}:${e.dest}`}
                  className="px-3 py-1.5 font-mono flex items-center gap-1"
                >
                  <span className="text-muted-foreground">--[{e.type}]--&gt;</span>
                  <span className="text-foreground/80 truncate">{e.dest}</span>
                </div>
              ))}
              {incoming.map((e) => (
                <div
                  key={`${e.type}:${e.src}`}
                  className="px-3 py-1.5 font-mono flex items-center gap-1"
                >
                  <span className="text-muted-foreground">&lt;--[{e.type}]--</span>
                  <span className="text-foreground/80 truncate">{e.src}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
