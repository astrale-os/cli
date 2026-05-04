import type { MountedWindow } from '@astrale-os/shell'

import { Skeleton, Tabs, TabsList, TabsTrigger } from '@astrale-os/ui-components'
import { createFileRoute } from '@tanstack/react-router'
import { PanelLeftOpen, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { NodeTree, type KernelNode, type TreeNode } from '@/components/node-tree'
import { TreeLegend, TreeToolbar } from '@/components/tree-toolbar'
import {
  availableKindsFromEdges,
  computeFolderBadges,
  computeInheritance,
  computePermissions,
  computeRelations,
  fetchAllLinks,
  type BadgeInfo,
  type ComputedView,
  type HighlightInfo,
  type ViewMode,
} from '@/components/tree/view-model'
import { StandaloneShellProvider, useKernel, useShell } from '@/providers/shell'

type ResolvedView = {
  id: string
  path: string
  url: string
  name?: string
  origin: 'self' | 'instance' | 'class'
}

type Tab = {
  /**
   * Stable, opaque identifier — set once at tab creation, never changes.
   * Used as React `key` so hot-swap (updating `node`) doesn't re-key the
   * TabStage and re-parent its `hostEl`, which would reload the iframe.
   */
  id: string
  node: KernelNode
  view: ResolvedView
  /** `null` while mount is in-flight; set to the MountedWindow on success. */
  mounted: MountedWindow | null
  hostEl: HTMLDivElement
}

function newTabId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function instanceUrl(instanceId: string) {
  return `http://localhost:4400/${instanceId}/`
}

/**
 * Walk the kernel from root for the first node whose path ends with
 * `/class.<className>`. Returns the full kernel path (e.g.
 * `/dist.astrale.ai/class.View`) so callers can build method paths via
 * `${path}/<method>` without reconstructing the domain.
 *
 * Generic by design: the View class lives in `distribution` today but may
 * move, be renamed, or be served by a non-default domain (`dist.localhost`,
 * `dist.local-<tunnel>.astrale.ai`, …). We don't hardcode any of that —
 * we ask the kernel which domains exist and check each for the class.
 *
 * Note: in the kernel graph, a class definition is materialized as a
 * `Folder` node named `class.<Name>` (its method nodes live inside).
 * So the filter is on path suffix, not label.
 *
 * Lookups are one round-trip per domain, in parallel. Classes are direct
 * children of their domain by convention (no further folder nesting), so
 * we don't recurse — keeps the discovery cheap and predictable.
 */
async function findClassPath(
  kernel: NonNullable<ReturnType<typeof useKernel>>,
  className: string,
): Promise<string | null> {
  const suffix = `/class.${className}`
  const roots = (await kernel.call('/::listChildren', {})) as KernelNode[]
  const domains = roots.filter((n) => n.__labels.includes('Domain'))
  const domainChildren = await Promise.all(
    domains.map((d) =>
      (kernel.call(`${d.path}::listChildren`, {}) as Promise<KernelNode[]>).catch(
        () => [] as KernelNode[],
      ),
    ),
  )
  for (const children of domainChildren) {
    const cls = children.find((n) => n.path.endsWith(suffix))
    if (cls) return cls.path
  }
  return null
}

function InstancePage() {
  const { instanceId } = Route.useParams()
  const { shell, status, error } = useShell()
  const kernel = useKernel()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ node: KernelNode; views: ResolvedView[] } | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const [selectedNode, setSelectedNode] = useState<KernelNode | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode | null>(null)
  const [computedView, setComputedView] = useState<ComputedView | null>(null)
  const [treeRoots, setTreeRoots] = useState<TreeNode[] | null>(null)
  // Path to `class.View`, resolved once on kernel ready (e.g.
  // `/dist.astrale.ai/class.View`). `null` until the lookup completes;
  // stays `null` if no installed domain exposes a View class.
  const [viewClassPath, setViewClassPath] = useState<string | null>(null)
  const [isComputing, setIsComputing] = useState(false)
  const [autoExpand, setAutoExpand] = useState(false)
  // Monotonic id stamped on each computeFor call. Async results that don't
  // match the latest id are dropped — prevents a slow request for node A
  // from overwriting a fresh one for node B when the user clicks fast.
  const computeReqRef = useRef(0)

  const selectedIsIdentity = selectedNode?.__labels.includes('Identity') ?? false

  const highlightMap = useMemo<Map<string, HighlightInfo>>(() => {
    if (!computedView) return new Map()
    if (
      computedView.mode === 'relations' &&
      computedView.edgeCache &&
      computedView.selectedEdgeKinds
    ) {
      return computeRelations(
        computedView.pinnedPath,
        computedView.edgeCache,
        computedView.selectedEdgeKinds,
        computedView.inheritanceMap,
      )
    }
    return computedView.highlightMap
  }, [computedView])

  const folderBadgeMap = useMemo<Map<string, BadgeInfo>>(
    () => computeFolderBadges(highlightMap, treeRoots),
    [highlightMap, treeRoots],
  )

  const canAutoExpand = !!viewMode && (folderBadgeMap.size > 0 || autoExpand)

  const computeFor = useCallback(
    async (mode: ViewMode, node: KernelNode) => {
      if (!kernel) return
      if (mode === 'permissions' && !node.__labels.includes('Identity')) {
        setStatusMsg('Permissions view requires an Identity')
        return
      }
      const reqId = ++computeReqRef.current
      setIsComputing(true)
      setStatusMsg(null)
      try {
        const pinnedPath = node.path
        const pinnedNodeId = node.id
        if (mode === 'relations') {
          const [edges, inheritanceMap] = await Promise.all([
            fetchAllLinks(kernel, pinnedPath),
            computeInheritance(pinnedPath, kernel),
          ])
          if (reqId !== computeReqRef.current) return
          const availableEdgeKinds = availableKindsFromEdges(edges)
          const selectedEdgeKinds = new Set(availableEdgeKinds)
          setComputedView({
            mode: 'relations',
            pinnedNodeId,
            pinnedPath,
            highlightMap: computeRelations(pinnedPath, edges, selectedEdgeKinds, inheritanceMap),
            availableEdgeKinds,
            selectedEdgeKinds,
            edgeCache: edges,
            inheritanceMap,
          })
        } else {
          const map = await computePermissions(pinnedPath, kernel)
          if (reqId !== computeReqRef.current) return
          setComputedView({ mode, pinnedNodeId, pinnedPath, highlightMap: map })
        }
      } catch (err) {
        if (reqId !== computeReqRef.current) return
        setStatusMsg(err instanceof Error ? err.message : 'Compute failed')
      } finally {
        if (reqId === computeReqRef.current) setIsComputing(false)
      }
    },
    [kernel],
  )

  const handleRefresh = useCallback(() => {
    if (!selectedNode || !viewMode) return
    void computeFor(viewMode, selectedNode)
  }, [computeFor, selectedNode, viewMode])

  // Re-run the active view whenever the pinned node or mode changes —
  // covers both toolbar toggle and clicking another node in the tree.
  useEffect(() => {
    if (!selectedNode || !viewMode) return
    void computeFor(viewMode, selectedNode)
  }, [selectedNode, viewMode, computeFor])

  const handleModeChange = useCallback((mode: ViewMode | null) => {
    setViewMode(mode)
    if (!mode) setComputedView(null)
  }, [])

  const handleEdgeKindToggle = useCallback((kind: string) => {
    setComputedView((prev) => {
      if (!prev || prev.mode !== 'relations' || !prev.selectedEdgeKinds) return prev
      const next = new Set(prev.selectedEdgeKinds)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return { ...prev, selectedEdgeKinds: next }
    })
  }, [])

  const handleAutoExpandToggle = useCallback(() => setAutoExpand((v) => !v), [])

  // Track tabs via ref so the route-unmount cleanup closes every iframe
  // even if it fires before the latest state has been committed.
  const tabsRef = useRef<Tab[]>([])
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    return () => {
      for (const t of tabsRef.current) {
        if (t.mounted) void t.mounted.close({ force: true }).catch(() => {})
        t.hostEl.remove()
      }
    }
  }, [])

  const openView = useCallback(
    async (node: KernelNode, view: ResolvedView) => {
      if (!shell) return
      setStatusMsg(null)

      // 1. Existing tab for this exact (node, view) → just activate it.
      const existing = tabs.find((t) => t.node.id === node.id && t.view.id === view.id)
      if (existing) {
        setActiveTabId(existing.id)
        return
      }

      // 2. Hot-swap: if the active tab is already showing this view (for a
      // different node), re-target the iframe via the `setTarget` intent
      // instead of mounting a second iframe. Only the active tab is touched —
      // inactive tabs keep their state untouched. `tab.id` does NOT change
      // here: changing it would re-key TabStage and re-parent the iframe.
      const activeTab = tabs.find((t) => t.id === activeTabId)
      if (activeTab?.mounted && activeTab.view.id === view.id && view.origin !== 'self') {
        shell.children.send(activeTab.mounted.windowId, {
          type: 'intent',
          version: 1,
          envelope: {
            name: 'setTarget',
            payload: { nodeId: node.id },
            sender: { windowId: 'root' },
          },
        })
        setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, node } : t)))
        return
      }

      // 3. Mount a fresh tab.
      //
      // The iframe must stay at ONE DOM position from the moment its `src` is
      // set — moving it triggers a reload, which re-runs the child SPA's init
      // handshake without a listening parent (parent's handshake already
      // resolved the first time). So we: (a) register the tab as pending via
      // `flushSync` so TabStage synchronously attaches `hostEl` to the stage
      // slot; (b) call `shell.mount` with `hostEl` already in-DOM; (c) update
      // the tab with the mounted handle on success, or drop it on failure.
      const tabId = newTabId()
      const hostEl = document.createElement('div')
      hostEl.style.width = '100%'
      hostEl.style.height = '100%'
      const pendingTab: Tab = { id: tabId, node, view, mounted: null, hostEl }
      flushSync(() => {
        setTabs((prev) => [...prev, pendingTab])
        setActiveTabId(tabId)
      })

      try {
        const mounted = await shell.mount({
          host: hostEl,
          url: view.url,
          functionId: view.id,
          ...(view.origin === 'self' ? {} : { targetNodeId: node.id }),
          capabilities: {
            intents: ['setTarget', 'open', 'focus', 'closeAck', 'closeRefuse'],
          },
          sandbox: {
            allowScripts: true,
            allowSameOrigin: true,
            allowForms: false,
            allowPopups: false,
            allowModals: false,
          },
        })
        const el = mounted.handle.element as HTMLElement
        el.style.width = '100%'
        el.style.height = '100%'
        el.style.border = '0'
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, mounted } : t)))
      } catch (err) {
        console.error('[InstancePage] mount failed:', err)
        hostEl.remove()
        setTabs((prev) => prev.filter((t) => t.id !== tabId))
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
              ? JSON.stringify(err)
              : String(err)
        setStatusMsg(`Mount failed: ${msg}`)
      }
    },
    [shell, tabs, activeTabId],
  )

  const onOpen = useCallback(
    async (node: KernelNode) => {
      if (!kernel) return
      setPicker(null)
      setStatusMsg(null)
      if (!viewClassPath) {
        setStatusMsg(
          'No View class found on this kernel — install a domain that exposes one (e.g. `distribution`).',
        )
        return
      }
      try {
        const views = (await kernel.call(`${viewClassPath}/resolve`, {
          node: node.path,
        })) as ResolvedView[]
        if (views.length === 0) {
          setStatusMsg(`No view available for ${node.path}`)
          return
        }
        if (views.length === 1) {
          void openView(node, views[0]!)
          return
        }
        setPicker({ node, views })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'View.resolve failed'
        // Connection-refused style failures usually mean the worker hosting
        // View.resolve isn't running. The viewClassPath looks like
        // `/dist.localhost/class.View`; the slug is the domain that ships
        // the View class, and the user needs `astrale domain dev up` there.
        if (/connect|fetch|ECONN|network|unreachable/i.test(msg)) {
          const slug = viewClassPath.split('/').filter(Boolean)[0] ?? 'unknown'
          setStatusMsg(
            `View resolver in domain "${slug}" is unreachable — start its worker with \`astrale domain dev up\` in the directory of that domain. (${msg})`,
          )
        } else {
          setStatusMsg(msg)
        }
      }
    },
    [kernel, openView, viewClassPath],
  )

  useEffect(() => {
    if (!kernel || viewClassPath) return
    let cancelled = false
    void findClassPath(kernel, 'View')
      .then((path) => {
        if (!cancelled && path) setViewClassPath(path)
      })
      .catch(() => {
        /* discovery failure is non-fatal; onOpen surfaces a helpful message */
      })
    return () => {
      cancelled = true
    }
  }, [kernel, viewClassPath])

  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (tab.mounted) await tab.mounted.close({ force: true }).catch(() => {})
      tab.hostEl.remove()

      const idx = tabs.findIndex((t) => t.id === tabId)
      setTabs((prev) => prev.filter((t) => t.id !== tabId))
      if (activeTabId === tabId) {
        const next = tabs[idx + 1] ?? tabs[idx - 1] ?? null
        setActiveTabId(next?.id ?? null)
      }
    },
    [tabs, activeTabId],
  )

  if (status === 'loading') {
    return <InstancePageSkeleton instanceId={instanceId} />
  }
  if (status === 'error') {
    return (
      <div className="p-4 text-destructive">
        <p className="font-medium">Connection failed</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    )
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div className="h-full w-full flex overflow-hidden">
      {sidebarCollapsed ? (
        <aside className="w-9 shrink-0 border-r border-border flex flex-col items-center py-2">
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="Expand graph panel"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </aside>
      ) : (
        <aside className="w-72 shrink-0 border-r border-border flex flex-col">
          <TreeToolbar
            mode={viewMode}
            onModeChange={handleModeChange}
            selectedIsIdentity={selectedIsIdentity}
            autoExpand={autoExpand}
            onAutoExpandToggle={handleAutoExpandToggle}
            canAutoExpand={canAutoExpand}
            onRefresh={handleRefresh}
            refreshDisabled={!selectedNode || isComputing}
            refreshTitle={
              !selectedNode
                ? 'Select a node to refresh'
                : isComputing
                  ? 'Computing…'
                  : 'Refresh view'
            }
            isRefreshing={isComputing}
            onCollapse={() => setSidebarCollapsed(true)}
          />
          <div className="flex-1 overflow-auto pt-2">
            {kernel && (
              <NodeTree
                kernel={kernel}
                onOpen={onOpen}
                selectedNodeId={selectedNode?.id ?? null}
                onSelect={setSelectedNode}
                highlightMap={highlightMap}
                folderBadgeMap={folderBadgeMap}
                onRootsChange={setTreeRoots}
                autoExpand={autoExpand}
              />
            )}
          </div>
          <TreeLegend
            mode={viewMode}
            availableEdgeKinds={computedView?.availableEdgeKinds ?? []}
            selectedEdgeKinds={computedView?.selectedEdgeKinds ?? new Set()}
            onEdgeKindToggle={handleEdgeKindToggle}
          />
        </aside>
      )}

      <main className="flex-1 flex flex-col relative min-w-0">
        {tabs.length > 0 && (
          <Tabs
            value={activeTabId ?? undefined}
            onValueChange={(v) => setActiveTabId(v)}
            className="shrink-0 border-b border-border gap-0"
          >
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto rounded-none h-9 px-2"
            >
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  title={`${t.view.name ?? t.view.path} — ${t.node.path}`}
                  className="group/tab max-w-[220px] flex-none"
                >
                  <span className="truncate">{t.view.name ?? t.view.path}</span>
                  <span
                    role="button"
                    aria-label="Close tab"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      void closeTab(t.id)
                    }}
                    className="ml-1 inline-flex items-center justify-center opacity-60 hover:opacity-100 hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {activeTab && (
          <div className="h-7 shrink-0 px-3 border-b border-border text-xs flex items-center gap-3 text-muted-foreground">
            <span className="text-[10px] uppercase tracking-wide">
              origin: {activeTab.view.origin}
            </span>
            <span className="truncate">for {activeTab.node.path}</span>
          </div>
        )}

        {statusMsg && (
          <div className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
            {statusMsg}
          </div>
        )}

        <div className="flex-1 bg-background relative overflow-hidden">
          {tabs.map((t) => (
            <TabStage key={t.id} tab={t} visible={t.id === activeTabId} />
          ))}
          {tabs.length === 0 && !statusMsg && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
              No view mounted.
            </div>
          )}
        </div>
      </main>

      {picker && (
        <Picker
          node={picker.node}
          views={picker.views}
          onPick={(v) => {
            setPicker(null)
            void openView(picker.node, v)
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  )
}

function InstancePageSkeleton({ instanceId: _instanceId }: { instanceId: string }) {
  return (
    <div className="h-full w-full flex overflow-hidden">
      <aside className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="flex-1 overflow-hidden">
          <div className="h-9 border-b border-border flex items-center gap-2 px-3">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-5 w-5 rounded ml-auto" />
          </div>
          <div className="pt-2 px-2 space-y-1.5">
            {[60, 48, 72, 56, 64, 52, 68, 44].map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-2 py-1"
                style={{ paddingLeft: `${(i % 3) * 12 + 4}px` }}
              >
                <Skeleton className="w-3.5 h-3.5 rounded-sm shrink-0" />
                <Skeleton className="h-3.5 rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col relative min-w-0">
        <div className="flex-1 bg-background relative overflow-hidden" />
      </main>
    </div>
  )
}

function TabStage({ tab, visible }: { tab: Tab; visible: boolean }) {
  const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && !el.contains(tab.hostEl)) el.appendChild(tab.hostEl)
    },
    [tab.hostEl],
  )

  useEffect(() => {
    tab.hostEl.style.display = visible ? 'block' : 'none'
    tab.hostEl.style.width = '100%'
    tab.hostEl.style.height = '100%'
  }, [tab.hostEl, visible])

  return <div ref={slotRef} className="absolute inset-0" />
}

function Picker({
  node,
  views,
  onPick,
  onCancel,
}: {
  node: KernelNode
  views: ResolvedView[]
  onPick(v: ResolvedView): void
  onCancel(): void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
      <div className="bg-background border border-border rounded-lg shadow-xl w-[420px] p-4">
        <div className="text-sm font-semibold">Choose a view</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{node.path}</div>
        <div className="mt-3 space-y-1">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => onPick(v)}
              className="w-full text-left px-3 py-2 rounded border border-border hover:bg-muted"
            >
              <div className="text-sm font-medium">{v.name ?? v.path}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                origin: {v.origin}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{v.url}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function InstanceRoute() {
  const { instanceId } = Route.useParams()
  return (
    <StandaloneShellProvider kernelUrl={instanceUrl(instanceId)}>
      <InstancePage />
    </StandaloneShellProvider>
  )
}

export const Route = createFileRoute('/kernel/$instanceId')({
  component: InstanceRoute,
})
