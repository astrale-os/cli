import type { StudioCore, StudioCoreNode, StudioSchemaBundle } from '@shared/types'

import { Box, Boxes, ChevronDown, ChevronRight, FolderClosed } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Commentable } from '@/components/commentable'
import { cn } from '@/lib/utils'

import { moduleTint } from '../palette'
import { SchemaIcon } from '../schema-icon'
import { classIcon, displayName, hueMapOf, nodeAnchor } from './model'

// ── left panel: the path-hierarchy tree ─────────────────────────────────────

interface CoreTreeNode {
  node: StudioCoreNode
  children: CoreTreeNode[]
}

function buildCoreTree(core: StudioCore): CoreTreeNode[] {
  const paths = new Set(core.nodes.map((n) => n.path))
  const byParent = new Map<string, StudioCoreNode[]>()
  const roots: StudioCoreNode[] = []
  for (const n of core.nodes) {
    if (n.parent && paths.has(n.parent)) {
      const arr = byParent.get(n.parent) ?? []
      arr.push(n)
      byParent.set(n.parent, arr)
    } else {
      roots.push(n)
    }
  }
  const build = (n: StudioCoreNode): CoreTreeNode => ({
    node: n,
    children: (byParent.get(n.path) ?? []).map(build),
  })
  return roots.map(build)
}

function CoreRow({
  domainId,
  item,
  depth,
  bundle,
  hues,
  selectedPath,
  onSelect,
}: {
  domainId: string
  item: CoreTreeNode
  depth: number
  bundle: StudioSchemaBundle
  hues: Map<string, number>
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  const n = item.node
  const hasKids = item.children.length > 0
  const active = selectedPath === n.path
  const hue = hues.get(n.className) ?? 264
  const icon = classIcon(bundle, n.className)
  const isFolder = n.className === 'Folder'
  return (
    <div>
      <div
        data-tree-row=""
        className={cn(
          'group/row flex items-center gap-0.5 rounded-md pr-2 hover:bg-accent',
          active && 'bg-accent',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Commentable
          domainId={domainId}
          anchor={{ ref: nodeAnchor(n.path), kind: 'section' }}
          excerpt={`${displayName(n)} (${n.className})`}
          className="flex-1 min-w-0"
        >
          <button
            type="button"
            onClick={() => onSelect(n.path)}
            className="flex w-full items-center gap-1.5 py-1 text-left min-w-0"
          >
            <span style={{ color: moduleTint(hue).mark }} className="shrink-0">
              {icon ? (
                <SchemaIcon svg={icon} className="h-4 w-4" />
              ) : isFolder ? (
                <FolderClosed className="h-3.5 w-3.5" />
              ) : (
                <Box className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="truncate text-[13px] font-medium">{displayName(n)}</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
              {n.className}
            </span>
          </button>
        </Commentable>
      </div>
      {open && hasKids && (
        <div>
          {item.children.map((c) => (
            <CoreRow
              domainId={domainId}
              key={c.node.path}
              item={c}
              depth={depth + 1}
              bundle={bundle}
              hues={hues}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CoreTree({
  domainId,
  core,
  bundle,
  selectedPath,
  onSelect,
}: {
  domainId: string
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const hues = useMemo(() => hueMapOf(core), [core])
  const tree = useMemo(() => buildCoreTree(core), [core])

  return (
    <div className="text-sm py-2">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" /> Core
      </div>
      {tree.length === 0 ? (
        <p className="px-3 pt-2 text-[12px] text-muted-foreground">
          {core.error ? core.error.message : 'This domain defines no core (genesis) data.'}
        </p>
      ) : (
        tree.map((c) => (
          <CoreRow
            domainId={domainId}
            key={c.node.path}
            item={c}
            depth={0}
            bundle={bundle}
            hues={hues}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}
