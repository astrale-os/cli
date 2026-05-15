import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Shapes, Layers, FolderTree } from 'lucide-react'

import type { CanvasMode } from '@/providers/workspace'

import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { FilesystemView } from '@/tools/graph-state/views/filesystem-view'
import { GraphView } from '@/tools/graph-state/views/graph-view'
import { SchemaView } from '@/tools/schema/views/schema-view'

const canvasModes: { mode: CanvasMode; icon: typeof Shapes; label: string }[] = [
  { mode: 'graph', icon: Layers, label: 'Graph' },
  { mode: 'schema', icon: Shapes, label: 'Schema' },
  { mode: 'filesystem', icon: FolderTree, label: 'Tree' },
]

function ModeSwitcher() {
  const workspace = useWorkspace()

  return (
    <div className="flex items-center border-b border-border bg-background px-3 h-9 shrink-0">
      {canvasModes.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => workspace.setCanvasMode(mode)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm transition-colors',
            workspace.canvasMode === mode
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

const VIEW_MAP: Record<CanvasMode, React.FC> = {
  graph: GraphView,
  schema: SchemaView,
  filesystem: FilesystemView,
}

function GraphCanvasInner() {
  const workspace = useWorkspace()
  const View = VIEW_MAP[workspace.canvasMode]

  return (
    <div className="flex flex-col h-full w-full">
      <ModeSwitcher />
      <div className="flex-1 min-h-0 relative">
        <View />
      </div>
    </div>
  )
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  )
}
