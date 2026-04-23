import { CollapsibleValue } from '@/components/ui/collapsible-value'

import type { BusinessGraph } from '../lib/raw-to-business'

interface BusinessEdgeDetailProps {
  graph: BusinessGraph
  edgeId: string
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function BusinessEdgeDetail({ graph, edgeId }: BusinessEdgeDetailProps) {
  const edge = graph.edges.find((e) => e.id === edgeId)
  if (!edge) return null

  const source = graph.nodes.find((n) => n.id === edge.sourceId)
  const target = graph.nodes.find((n) => n.id === edge.targetId)

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">{edge.type}</h3>
        {edge.reified && <span className="text-[10px] text-muted-foreground">(reified edge)</span>}
      </div>

      <div className="rounded border border-border divide-y divide-border text-xs">
        <div className="flex justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Source</span>
          <span className="font-mono text-foreground/80 text-right max-w-[60%] truncate">
            {source?.displayName ?? edge.sourceId}
          </span>
        </div>
        <div className="flex justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Target</span>
          <span className="font-mono text-foreground/80 text-right max-w-[60%] truncate">
            {target?.displayName ?? edge.targetId}
          </span>
        </div>
      </div>

      {Object.keys(edge.properties).length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Properties</h4>
          <div className="rounded border border-border divide-y divide-border">
            {Object.entries(edge.properties).map(([k, v]) => (
              <div key={k} className="px-3 py-1.5 text-xs">
                <span className="text-muted-foreground font-mono">{k}</span>
                <CollapsibleValue>{formatValue(v)}</CollapsibleValue>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
