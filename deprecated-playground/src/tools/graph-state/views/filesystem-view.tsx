import { Folder, FolderOpen, Circle } from 'lucide-react'
import { useMemo, useState, useCallback } from 'react'

import type { GraphStateNode } from '@/lib/types'

import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { STRUCTURE_TYPE, DOMAIN_LABEL } from '@/tools/graph-state/lib/kernel-fabric'
import { resolveDisplayName } from '@/tools/graph-state/lib/raw-to-business'

function getNodeLabel(node: GraphStateNode): string | null {
  const labels = node.labels ?? []
  return labels.find((l) => l !== 'Node') ?? null
}

export function FilesystemView() {
  const workspace = useWorkspace()
  // selectedPath[i] = the selected node ID in column i
  const [selectedPath, setSelectedPath] = useState<string[]>([])

  const nodeIndex = useMemo(() => {
    if (!workspace.graphState) return new Map<string, GraphStateNode>()
    return new Map(workspace.graphState.nodes.map((n) => [n.id, n]))
  }, [workspace.graphState])

  const { rootIds, childrenOf } = useMemo(() => {
    if (!workspace.graphState)
      return { rootIds: [] as string[], childrenOf: new Map<string, string[]>() }

    const { nodes, edges } = workspace.graphState
    const childrenOf = new Map<string, string[]>()
    const hasParentSet = new Set<string>()

    for (const edge of edges) {
      if (edge.type !== STRUCTURE_TYPE.hasParent) continue
      hasParentSet.add(edge.src)
      const list = childrenOf.get(edge.dest) ?? []
      list.push(edge.src)
      childrenOf.set(edge.dest, list)
    }

    // Skip Root-labeled nodes — surface their children directly as top-level entries
    const rootLabeledIds = new Set(
      nodes.filter((n) => n.labels?.includes(DOMAIN_LABEL.Root)).map((n) => n.id),
    )
    const rawRootIds = nodes.filter((n) => !hasParentSet.has(n.id)).map((n) => n.id)
    const rootIds = rawRootIds.flatMap((id) =>
      rootLabeledIds.has(id) ? (childrenOf.get(id) ?? []) : [id],
    )

    return { rootIds, childrenOf }
  }, [workspace.graphState])

  // columns[0] = roots, columns[i+1] = children of selectedPath[i]
  const columns = useMemo(() => {
    const cols: string[][] = [rootIds]
    for (const selectedId of selectedPath) {
      const children = childrenOf.get(selectedId) ?? []
      if (children.length === 0) break
      cols.push(children)
    }
    return cols
  }, [rootIds, childrenOf, selectedPath])

  const handleSelect = useCallback(
    (colIdx: number, nodeId: string) => {
      setSelectedPath((prev) => [...prev.slice(0, colIdx), nodeId])
      workspace.setSelection({ type: 'graph-node', id: nodeId })
    },
    [workspace],
  )

  if (!workspace.graphState) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Load the graph to browse it</p>
          <button
            onClick={workspace.refreshGraphState}
            disabled={workspace.graphStateLoading}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {workspace.graphStateLoading ? 'Loading...' : 'Load Graph'}
          </button>
          {workspace.graphStateError && (
            <p className="text-xs text-destructive">{workspace.graphStateError}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-x-auto overflow-y-hidden bg-background">
      {columns.map((columnNodeIds, colIdx) => {
        const selectedId = selectedPath[colIdx]
        return (
          <div key={colIdx} className="flex-shrink-0 w-52 border-r border-border overflow-y-auto">
            {columnNodeIds.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground italic">Empty</div>
            )}
            {columnNodeIds.map((id) => {
              const node = nodeIndex.get(id)
              if (!node) return null
              const displayName = resolveDisplayName(node)
              const label = getNodeLabel(node)
              const isSelected = id === selectedId
              const hasChildren = (childrenOf.get(id) ?? []).length > 0

              return (
                <button
                  key={id}
                  onClick={() => handleSelect(colIdx, id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {hasChildren ? (
                    isSelected ? (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <Circle className="h-2.5 w-2.5 shrink-0 fill-current opacity-50" />
                  )}
                  <span className="flex-1 truncate font-medium">{displayName}</span>
                  {label && !isSelected && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[56px] shrink-0">
                      {label}
                    </span>
                  )}
                  {hasChildren && (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      ›
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
