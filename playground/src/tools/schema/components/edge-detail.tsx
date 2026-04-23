import { X } from 'lucide-react'

interface EdgeDef {
  endpoints?: Record<string, { types: string[]; cardinality?: { min?: number; max?: number } }>
  from?: string | string[]
  to?: string | string[]
  cardinality?: { outbound?: string; inbound?: string }
  constraints?: Record<string, boolean>
}

interface EdgeDetailProps {
  schema: { edges?: Record<string, EdgeDef> }
  edgeId: string
  onClose?: () => void
}

export function EdgeDetail({ schema, edgeId, onClose }: EdgeDetailProps) {
  const edgeDef = schema.edges?.[edgeId]
  if (!edgeDef) return null

  // Handle both distribution (endpoints) and serialized (from/to) formats
  const isDistribution = !!edgeDef.endpoints
  const endpoints = isDistribution && edgeDef.endpoints ? Object.entries(edgeDef.endpoints) : null
  const constraints = edgeDef.constraints

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{edgeId}</h3>
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

      <div className="rounded border border-border divide-y divide-border">
        {isDistribution && endpoints ? (
          endpoints.map(([role, ep]) => (
            <div key={role} className="px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{role}</span>
                <span className="font-mono text-xs">{ep.types.join(' | ')}</span>
              </div>
              {ep.cardinality && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {ep.cardinality.min ?? 0}..{ep.cardinality.max ?? '*'}
                </div>
              )}
            </div>
          ))
        ) : (
          <>
            <div className="flex justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">From</span>
              <span className="font-mono text-xs">
                {Array.isArray(edgeDef.from) ? edgeDef.from.join(' | ') : edgeDef.from}
              </span>
            </div>
            <div className="flex justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">To</span>
              <span className="font-mono text-xs">
                {Array.isArray(edgeDef.to) ? edgeDef.to.join(' | ') : edgeDef.to}
              </span>
            </div>
            {edgeDef.cardinality && (
              <>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Outbound</span>
                  <span className="font-mono text-xs">{edgeDef.cardinality.outbound}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Inbound</span>
                  <span className="font-mono text-xs">{edgeDef.cardinality.inbound}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {constraints && Object.keys(constraints).length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">Constraints</h4>
          <div className="flex gap-1 flex-wrap">
            {Object.entries(constraints)
              .filter(([, v]) => v)
              .map(([key]) => (
                <span key={key} className="rounded bg-secondary px-2 py-0.5 text-xs font-mono">
                  {key}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
