import type { KernelClient } from '@astrale-os/shell'

import {
  ChevronDown,
  ChevronRight,
  File,
  Folder as FolderIcon,
  Hash,
  Layout,
  Loader2,
  Monitor,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

type KernelNode = {
  id: string
  class: string
  path: string
  props: Record<string, unknown>
  __labels: string[]
}

type TreeNode = {
  node: KernelNode
  children: TreeNode[] | null
  loading: boolean
  error: string | null
  expanded: boolean
}

type NodeTreeProps = {
  kernel: KernelClient
  onOpen(node: KernelNode): void
}

// Which classes act as containers whose children are worth listing. Anything
// implementing Container (Root, Domain, Folder, Group, Home) exposes
// `::listChildren`. We allow them all; non-Container nodes are leaves.
const CONTAINER_LABELS = new Set(['Root', 'Domain', 'Folder', 'Group', 'Home'])

function isContainer(node: KernelNode): boolean {
  return node.__labels.some((l) => CONTAINER_LABELS.has(l))
}

function nameOf(node: KernelNode): string {
  const name = node.props['kernel.astrale.ai:interface.Named.property.name']
  if (typeof name === 'string' && name.length > 0) return name
  const last = node.path.split('/').filter(Boolean).pop()
  return last ?? node.path
}

function classShortName(cls: string): string {
  // `/:<domain>:class.Name` → `Name`
  const parts = cls.split(':')
  const last = parts[parts.length - 1] ?? cls
  const dot = last.indexOf('.')
  return dot >= 0 ? last.slice(dot + 1) : last
}

function IconFor({ node }: { node: KernelNode }) {
  const cls = classShortName(node.class)
  const common = 'w-3.5 h-3.5 shrink-0'
  if (cls === 'Domain') return <Hash className={`${common} text-indigo-500`} />
  if (cls === 'Folder') return <FolderIcon className={`${common} text-amber-500`} />
  if (cls === 'View') return <Layout className={`${common} text-emerald-500`} />
  if (cls === 'Desktop') return <Monitor className={`${common} text-sky-500`} />
  if (cls === 'User') return <UserIcon className={`${common} text-pink-500`} />
  if (cls === 'Group') return <Users className={`${common} text-violet-500`} />
  return <File className={`${common} text-muted-foreground`} />
}

function TreeRow({
  entry,
  depth,
  onToggle,
  onOpen,
}: {
  entry: TreeNode
  depth: number
  onToggle(entry: TreeNode): void
  onOpen(node: KernelNode): void
}) {
  const indent = { paddingLeft: `${depth * 14 + 6}px` }
  const expandable = isContainer(entry.node)
  return (
    <div
      className="group flex items-center gap-1.5 py-0.5 pr-2 text-xs hover:bg-muted cursor-pointer select-none"
      style={indent}
      onClick={() => expandable && onToggle(entry)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onOpen(entry.node)
      }}
      title={entry.node.path}
    >
      {expandable ? (
        entry.expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <IconFor node={entry.node} />
      <span className="truncate">{nameOf(entry.node)}</span>
      <span className="ml-auto text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
        {classShortName(entry.node.class)}
      </span>
    </div>
  )
}

function renderTree(
  entries: TreeNode[],
  depth: number,
  onToggle: (entry: TreeNode) => void,
  onOpen: (node: KernelNode) => void,
): ReactNode[] {
  const out: ReactNode[] = []
  for (const entry of entries) {
    out.push(
      <TreeRow
        key={entry.node.id}
        entry={entry}
        depth={depth}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    )
    if (entry.loading) {
      out.push(
        <div
          key={entry.node.id + ':loading'}
          className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground"
          style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading…
        </div>,
      )
    }
    if (entry.error) {
      out.push(
        <div
          key={entry.node.id + ':err'}
          className="text-xs text-destructive"
          style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}
        >
          {entry.error}
        </div>,
      )
    }
    if (entry.expanded && entry.children) {
      out.push(...renderTree(entry.children, depth + 1, onToggle, onOpen))
    }
  }
  return out
}

export function NodeTree({ kernel, onOpen }: NodeTreeProps) {
  const [roots, setRoots] = useState<TreeNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadChildren = useCallback(
    async (path: string): Promise<KernelNode[]> => {
      const res = (await kernel.call(`${path}::listChildren`, {})) as KernelNode[]
      // Stable order: class → name.
      return [...res].sort((a, b) => {
        const ca = classShortName(a.class)
        const cb = classShortName(b.class)
        if (ca !== cb) return ca.localeCompare(cb)
        return nameOf(a).localeCompare(nameOf(b))
      })
    },
    [kernel],
  )

  // Initial load: the kernel Root. We ls `/` to get top-level children.
  useEffect(() => {
    let cancelled = false
    setRoots(null)
    setLoadError(null)
    ;(async () => {
      try {
        const children = await loadChildren('/')
        if (cancelled) return
        setRoots(
          children.map((n) => ({
            node: n,
            children: null,
            loading: false,
            error: null,
            expanded: false,
          })),
        )
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load tree')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadChildren])

  const toggle = useCallback(
    async (entry: TreeNode) => {
      const update = (patch: Partial<TreeNode>) =>
        setRoots((prev) => prev && replaceEntry(prev, entry.node.id, (e) => ({ ...e, ...patch })))

      if (entry.expanded) {
        update({ expanded: false })
        return
      }
      if (entry.children) {
        update({ expanded: true })
        return
      }
      update({ loading: true, error: null, expanded: true })
      try {
        const children = await loadChildren(entry.node.path)
        update({
          children: children.map((n) => ({
            node: n,
            children: null,
            loading: false,
            error: null,
            expanded: false,
          })),
          loading: false,
        })
      } catch (err) {
        update({ loading: false, error: err instanceof Error ? err.message : 'Load failed' })
      }
    },
    [loadChildren],
  )

  if (loadError) {
    return <div className="p-3 text-xs text-destructive bg-destructive/10 rounded">{loadError}</div>
  }
  if (!roots) {
    return (
      <div className="p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading tree…
      </div>
    )
  }

  return <div className="text-xs font-mono">{renderTree(roots, 0, toggle, onOpen)}</div>
}

// ─── helpers ───────────────────────────────────────────────────────────────

function replaceEntry(
  entries: TreeNode[],
  id: string,
  update: (e: TreeNode) => TreeNode,
): TreeNode[] {
  return entries.map((entry) => {
    if (entry.node.id === id) return update(entry)
    if (entry.children) {
      return { ...entry, children: replaceEntry(entry.children, id, update) }
    }
    return entry
  })
}

export type { KernelNode }
