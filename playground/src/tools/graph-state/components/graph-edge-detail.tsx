import type { GraphStateData } from '@/lib/types'

import { CollapsibleValue } from '@/components/ui/collapsible-value'

interface GraphEdgeDetailProps {
  graphState: GraphStateData
  src: string
  dest: string
  edgeType: string
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function GraphEdgeDetail({ graphState, src, dest, edgeType }: GraphEdgeDetailProps) {
  const edge = graphState.edges.find((e) => e.src === src && e.dest === dest && e.type === edgeType)
  if (!edge) return null

  const props = edge.props ?? {}

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">{edgeType}</h3>
      </div>

      <div className="rounded border border-border divide-y divide-border text-xs">
        <div className="flex justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Source</span>
          <span className="font-mono text-foreground/80 break-all text-right max-w-[60%]">
            {src}
          </span>
        </div>
        <div className="flex justify-between px-3 py-1.5">
          <span className="text-muted-foreground">Target</span>
          <span className="font-mono text-foreground/80 break-all text-right max-w-[60%]">
            {dest}
          </span>
        </div>
      </div>

      {Object.keys(props).length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Properties</h4>
          <div className="rounded border border-border divide-y divide-border">
            {Object.entries(props).map(([k, v]) => (
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
