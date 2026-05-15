import { X } from 'lucide-react'

interface NodeDef {
  attributes?: string[]
  properties?: { properties?: Record<string, unknown> }
  implements?: string[]
  extends?: string[]
  abstract?: boolean
}

interface NodeDetailProps {
  schema: {
    nodes?: Record<string, NodeDef>
    methods?: Record<string, Record<string, { params?: unknown; returns?: string }>>
  }
  nodeId: string
  onClose?: () => void
}

export function NodeDetail({ schema, nodeId, onClose }: NodeDetailProps) {
  const nodeDef = schema.nodes?.[nodeId]
  if (!nodeDef) return null

  // Handle both distribution (attributes) and serialized (properties) formats
  const attributes: string[] =
    nodeDef.attributes ??
    (nodeDef.properties?.properties ? Object.keys(nodeDef.properties.properties) : [])
  const impls: string[] = nodeDef.implements ?? nodeDef.extends ?? []
  const isAbstract = nodeDef.abstract ?? false
  const methods = schema.methods?.[nodeId]

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{nodeId}</h3>
          {isAbstract && (
            <span className="text-xs text-muted-foreground italic">&laquo;interface&raquo;</span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {impls.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Implements</h4>
          <div className="flex gap-1 flex-wrap">
            {impls.map((l: string) => (
              <span key={l} className="rounded bg-secondary px-2 py-0.5 text-xs font-mono">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {attributes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Attributes</h4>
          <div className="rounded border border-border divide-y divide-border">
            {attributes.map((attr: string) => (
              <div key={attr} className="px-3 py-1.5 text-xs font-mono">
                {attr}
              </div>
            ))}
          </div>
        </div>
      )}

      {methods && Object.keys(methods).length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Methods</h4>
          <div className="rounded border border-border divide-y divide-border">
            {Object.entries(methods).map(([name, m]) => (
              <div key={name} className="px-3 py-1.5 text-xs font-mono">
                <span className="text-violet-600 dark:text-violet-400">f</span> {name}()
                {m.returns && <span className="text-muted-foreground">: {m.returns}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
