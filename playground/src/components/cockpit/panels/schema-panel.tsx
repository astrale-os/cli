import { RefreshCw } from 'lucide-react'

import { useWorkspace } from '@/hooks/use-workspace'

export function SchemaPanel() {
  const workspace = useWorkspace()

  if (workspace.graphStateLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading graph state…</span>
      </div>
    )
  }

  if (workspace.graphStateError) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <span className="text-sm text-destructive">{workspace.graphStateError}</span>
        <button
          onClick={workspace.refreshGraphState}
          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!workspace.schema) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <span className="text-sm text-muted-foreground">No schema derived from graph</span>
        <button
          onClick={workspace.refreshGraphState}
          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Refresh
        </button>
      </div>
    )
  }

  const nodeCount = Object.keys(workspace.schema.nodes ?? {}).length
  const edgeCount = Object.keys(workspace.schema.edges ?? {}).length
  const methodCount = Object.values(workspace.schema.methods ?? {}).reduce(
    (acc: number, m) => acc + Object.keys(m as Record<string, unknown>).length,
    0,
  )

  return (
    <div className="flex h-full items-center justify-between px-4">
      <span className="text-sm text-muted-foreground">
        Schema (from graph): {nodeCount} types, {edgeCount} edges, {methodCount} methods
      </span>
      <button
        onClick={workspace.refreshGraphState}
        className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        <RefreshCw className="h-3 w-3" />
        Refresh
      </button>
    </div>
  )
}
