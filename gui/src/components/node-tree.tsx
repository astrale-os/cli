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

import { dotClassName, rowClassName, type BadgeInfo, type HighlightInfo } from './tree/view-model'

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
  selectedNodeId: string | null
  onSelect(node: KernelNode): void
  highlightMap: Map<string, HighlightInfo>
  folderBadgeMap: Map<string, BadgeInfo>
  onRootsChange?(roots: TreeNode[] | null): void
  /** When true, expand every loaded container whose subtree contains a highlighted path. */
  autoExpand: boolean
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
  selected,
  highlight,
  badge,
  onToggle,
  onSelect,
  onOpen,
}: {
  entry: TreeNode
  depth: number
  selected: boolean
  highlight: HighlightInfo | undefined
  badge: BadgeInfo | undefined
  onToggle(entry: TreeNode): void
  onSelect(node: KernelNode): void
  onOpen(node: KernelNode): void
}) {
  const indent = { paddingLeft: `${depth * 14 + 6}px` }
  const expandable = isContainer(entry.node)
  const showBadge = badge && !entry.expanded
  const highlightCls = highlight ? rowClassName(highlight) : ''
  // Hover does not replace the highlight tint: we use a subtle accent overlay
  // that stacks readably on top. Selection uses a ring so it never fights
  // with the highlight's left-border + tint.
  const hoverCls = highlight ? 'hover:bg-accent/30' : 'hover:bg-muted'
  const selectedCls = selected ? 'ring-1 ring-ring ring-inset' : ''
  return (
    <div
      className={`group relative flex items-center gap-1.5 py-0.5 pr-2 text-xs cursor-pointer select-none ${hoverCls} ${highlightCls} ${selectedCls}`}
      style={indent}
      role="treeitem"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(entry.node)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onOpen(entry.node)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onOpen(entry.node)
        } else if (e.key === ' ' && expandable) {
          e.preventDefault()
          e.stopPropagation()
          onToggle(entry)
        }
      }}
      title={entry.node.path}
    >
      {showBadge && (
        <span
          className={`absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${dotClassName(badge)}`}
          title="Contains a highlighted match"
        />
      )}
      {expandable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(entry)
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={entry.expanded ? 'Collapse' : 'Expand'}
        >
          {entry.expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
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
  selectedNodeId: string | null,
  highlightMap: Map<string, HighlightInfo>,
  folderBadgeMap: Map<string, BadgeInfo>,
  onToggle: (entry: TreeNode) => void,
  onSelect: (node: KernelNode) => void,
  onOpen: (node: KernelNode) => void,
): ReactNode[] {
  const out: ReactNode[] = []
  for (const entry of entries) {
    out.push(
      <TreeRow
        key={entry.node.id}
        entry={entry}
        depth={depth}
        selected={selectedNodeId === entry.node.id}
        highlight={highlightMap.get(entry.node.path)}
        badge={folderBadgeMap.get(entry.node.path)}
        onToggle={onToggle}
        onSelect={onSelect}
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
      out.push(
        ...renderTree(
          entry.children,
          depth + 1,
          selectedNodeId,
          highlightMap,
          folderBadgeMap,
          onToggle,
          onSelect,
          onOpen,
        ),
      )
    }
  }
  return out
}

export function NodeTree({
  kernel,
  onOpen,
  selectedNodeId,
  onSelect,
  highlightMap,
  folderBadgeMap,
  onRootsChange,
  autoExpand,
}: NodeTreeProps) {
  const [roots, setRoots] = useState<TreeNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Snapshot of each entry's expanded state before autoExpand was enabled,
  // so we can restore faithfully when the user toggles it off.
  const [priorExpansion, setPriorExpansion] = useState<Map<string, boolean> | null>(null)

  useEffect(() => {
    onRootsChange?.(roots)
  }, [roots, onRootsChange])

  const loadChildren = useCallback(
    async (path: string): Promise<KernelNode[]> => {
      const res = (await kernel.call(`${path}::listChildren`, {})) as KernelNode[]
      return [...res].sort((a, b) => {
        const ca = classShortName(a.class)
        const cb = classShortName(b.class)
        if (ca !== cb) return ca.localeCompare(cb)
        return nameOf(a).localeCompare(nameOf(b))
      })
    },
    [kernel],
  )

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

  // Auto-expand every collapsed container whose subtree contains a highlight
  // target. Lazy-loaded folders (children: null) are also loaded so the
  // match becomes visible. We iterate until the tree is stable since each
  // newly-loaded layer may itself contain deeper matches.
  //
  // On toggle-off we restore the snapshot taken *before* auto-expand so
  // the user's manually-opened folders stay open, and the ones we opened
  // fold back.
  useEffect(() => {
    if (!autoExpand) {
      setRoots((prev) => {
        if (!prev || !priorExpansion) return prev
        return mapTree(prev, (e) => {
          const prior = priorExpansion.get(e.node.id)
          return prior === undefined ? e : { ...e, expanded: prior }
        })
      })
      if (priorExpansion) setPriorExpansion(null)
      return
    }
    if (priorExpansion) return // already snapshotted + already driving
    if (!roots || highlightMap.size === 0) return

    const snapshot = new Map<string, boolean>()
    const walkSnapshot = (entries: TreeNode[]): void => {
      for (const e of entries) {
        snapshot.set(e.node.id, e.expanded)
        if (e.children) walkSnapshot(e.children)
      }
    }
    walkSnapshot(roots)
    setPriorExpansion(snapshot)

    const highlightedPaths = Array.from(highlightMap.keys())
    const hasMatchUnder = (p: string) => {
      const prefix = p.endsWith('/') ? p : p + '/'
      return highlightedPaths.some((hp) => hp.startsWith(prefix))
    }

    let cancelled = false
    ;(async () => {
      // Iterate: each loop, find collapsed containers with matches inside,
      // expand them (loading children if needed). Read the latest tree via
      // functional setState to avoid stale closures.
      for (let pass = 0; pass < 10 && !cancelled; pass += 1) {
        const toLoad: TreeNode[] = []
        await new Promise<void>((resolve) => {
          setRoots((prev) => {
            if (!prev) return prev
            toLoad.length = 0
            const next = mapTree(prev, (e) => {
              if (!isContainer(e.node)) return e
              if (e.expanded) return e
              if (!hasMatchUnder(e.node.path)) return e
              if (!e.children) toLoad.push(e)
              return { ...e, expanded: true }
            })
            resolve()
            return next
          })
        })
        if (toLoad.length === 0) return // stable
        await Promise.all(
          toLoad.map(async (entry) => {
            try {
              const children = await loadChildren(entry.node.path)
              setRoots((prev) =>
                prev
                  ? replaceEntry(prev, entry.node.id, (e) => ({
                      ...e,
                      children: children.map((n) => ({
                        node: n,
                        children: null,
                        loading: false,
                        error: null,
                        expanded: false,
                      })),
                      loading: false,
                    }))
                  : prev,
              )
            } catch {
              /* ignore; the folder stays expanded but with no children */
            }
          }),
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [autoExpand, roots, highlightMap, priorExpansion, loadChildren])

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

  return (
    <div className="text-xs font-mono">
      {renderTree(roots, 0, selectedNodeId, highlightMap, folderBadgeMap, toggle, onSelect, onOpen)}
    </div>
  )
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

function mapTree(entries: TreeNode[], update: (e: TreeNode) => TreeNode): TreeNode[] {
  return entries.map((entry) => {
    const updated = update(entry)
    if (updated.children) {
      return { ...updated, children: mapTree(updated.children, update) }
    }
    return updated
  })
}

export type { KernelNode, TreeNode }
