import { X, MousePointer } from 'lucide-react'

import type { CanvasMode } from '@/providers/workspace'

import { useWorkspace } from '@/hooks/use-workspace'
import { GraphInspector } from '@/tools/graph-state/views/graph-inspector'
import { SchemaInspector } from '@/tools/schema/views/schema-inspector'

const INSPECTOR_MAP: Record<CanvasMode, React.FC> = {
  graph: GraphInspector,
  schema: SchemaInspector,
  filesystem: GraphInspector,
}

export function Inspector() {
  const { canvasMode, selection, setSelection } = useWorkspace()
  const Content = INSPECTOR_MAP[canvasMode]

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 h-9">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Inspector
        </span>
        {selection && (
          <button
            onClick={() => setSelection(null)}
            aria-label="Close inspector"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {selection === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <MousePointer className="h-8 w-8" />
            <p className="text-sm">Select a node or edge on the canvas</p>
          </div>
        ) : (
          <Content />
        )}
      </div>
    </div>
  )
}
