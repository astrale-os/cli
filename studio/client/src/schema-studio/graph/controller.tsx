import type { LayoutState, NodePosition, StudioSchemaBundle, VisibilityState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react'
import { AppWindow, Globe, LayoutGrid, Plug, Spline } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { api, qk } from '@/lib/api'
import {
  useAnatomy,
  useCatalog,
  useComments,
  useCore,
  useViewsModel,
  useVisibility,
} from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { ErdMarkerDefs } from '../cardinality-markers'
import { CoreModeToggle } from '../core-view'
import { elkLayout } from '../elk-layout'
import { crossDomainEdges, externalDomains } from '../external'
import { edgeTypes, separateParallelEdges } from '../floating-edge'
import { type Geometry, applyGeometry, geometryOf, packPendingNodes, sizeOfNode } from '../geometry'
import { useLayoutCommitter } from '../layout-commit'
import { moduleOfClass } from '../modules'
import { type ClassNodeData, projectDomainCanvas } from '../projection'
import { VISIBILITY_DEFAULT, domainVisible, visibilityEqual } from '../visibility'
import { CanvasCommentPin, schemaNodeTypes } from './nodes'
import {
  buildCrossEdges,
  buildExternalLayout,
  commentNodes,
  deriveRegion,
  neighborSet,
  schemaCanvasCommentGroups,
  schemaCanvasFallbackComments,
} from './structure'

export function SchemaGraph({
  bundle,
  domainId,
  saved,
}: {
  bundle: StudioSchemaBundle
  domainId: string
  saved?: Record<string, NodePosition>
}) {
  const { fitView, getNodes } = useReactFlow()
  const focusId = useUI((s) => s.focusId)
  const focusClass = useUI((s) => s.focusClass)
  const panelOverlay = useUI((s) => s.panelOverlay)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)
  const viewsCount = useViewsModel(domainId).all.length
  const integrationsCount = useAnatomy(domainId).data?.detectedIntegrations?.length ?? 0
  const core = useCore(domainId).data
  const coreCount = (core?.nodes.length ?? 0) + (core?.edges.length ?? 0)
  const selectClass = useUI((s) => s.selectClass)
  const selectedClass = useUI((s) => s.selectedClass)
  const setFocus = useUI((s) => s.setFocus)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const collapsedModules = useUI((s) => s.collapsedModules)
  const toggleModule = useUI((s) => s.toggleModule)
  const hidden = useUI((s) => s.hidden)
  const showInheritedEdges = useUI((s) => s.showInheritedEdges)
  const toggleInheritedEdges = useUI((s) => s.toggleInheritedEdges)
  const setVisibility = useUI((s) => s.setVisibility)
  const { data: catalog } = useCatalog()
  const { data: commentStore } = useComments(domainId)
  const { data: visibility } = useVisibility(domainId)
  const visibilityHydrated = useRef(false)

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [hoverId, setHoverId] = useState<string | null>(null)

  const structure = useMemo(
    () => projectDomainCanvas(bundle, new Set(collapsedModules), hidden, showInheritedEdges),
    [bundle.renderFingerprint, bundle, collapsedModules, hidden, showInheritedEdges],
  )
  const allExternal = useMemo(() => externalDomains(bundle), [bundle])
  const crossE = useMemo(() => crossDomainEdges(bundle), [bundle])
  const hiddenKey = Object.keys(hidden).sort().join(',') + `|${showInheritedEdges}`

  // auto-expand a collapsed module when one of its classes is selected (e.g. from ⌘K)
  useEffect(() => {
    if (!selectedClass?.startsWith('class.')) return
    const mp = moduleOfClass(bundle, selectedClass.slice('class.'.length))
    if (collapsedModules.includes(mp)) toggleModule(mp)
  }, [selectedClass, bundle, collapsedModules, toggleModule])

  // ── geometry of record = the persisted layout query cache ──
  // The cache OUTLIVES this component (e.g. a core⇄schema toggle unmounts it), so it's
  // the single source of truth: every write updates it via setQueryData, positions are
  // never lost across remounts, and data refetches (file edits) never relayout.
  const qc = useQueryClient()
  const fitted = useRef(false)
  const { commitLayout } = useLayoutCommitter()
  const commit = useCallback(
    (updates: Geometry) => {
      commitLayout(domainId, updates)
    },
    [commitLayout, domainId],
  )

  // ── visibility of record = the persisted per-domain visibility cache ──
  // Same client-authoritative model as layout: the zustand store holds the LIVE slice,
  // the query cache holds the PER-DOMAIN record. Hydrate the store on domain switch, then
  // write genuine user toggles to both the cache and disk.
  // hydrate the store from this domain's persisted slice (the live slice is per-domain, so
  // loading a domain overwrites it). IDEMPOTENT: only setVisibility when the loaded slice
  // actually differs from the live store. This is load-bearing — the persist effect below
  // writes the store back into the query cache, which would otherwise bounce here as a fresh
  // setVisibility and ping-pong the two effects into an infinite render loop (React #185 →
  // blank canvas on domain switch). Skipping the equal echo breaks the loop (and, with it,
  // the cross-domain write the loop caused). Defaults paint the instant the domain changes,
  // before the GET resolves, so the canvas never shows the previous domain's slice.
  useEffect(() => {
    if (!visibility) return
    const incoming = visibility
    const live = useUI.getState()
    const next: VisibilityState = {
      hidden: incoming.hidden,
      showInheritedEdges: incoming.showInheritedEdges,
    }
    if (!visibilityEqual(next, live)) setVisibility(next)
    visibilityHydrated.current = true
  }, [domainId, visibility, setVisibility])
  // Persist only after this domain's saved slice has hydrated. Reading the live store here is
  // intentional: hydration updates Zustand synchronously, so the immediately-following persist
  // effect sees the restored value instead of overwriting it with its pre-hydration render.
  useEffect(() => {
    if (!visibilityHydrated.current) return
    const live = useUI.getState()
    const next: VisibilityState = {
      hidden: live.hidden,
      showInheritedEdges: live.showInheritedEdges,
    }
    const cached = qc.getQueryData<VisibilityState>(qk.visibility(domainId)) ?? VISIBILITY_DEFAULT
    if (visibilityEqual(next, cached)) return
    qc.setQueryData<VisibilityState>(qk.visibility(domainId), next)
    api.setVisibility(domainId, next).catch(() => {})
  }, [hidden, showInheritedEdges, domainId, qc])

  // paint a set of positions onto the structure and append the external area.
  const compose = useCallback(
    (g: Geometry) => {
      const internal = structure.nodes.map((n) => applyGeometry(n, g))
      const visibleDomains = allExternal.filter((d) => domainVisible(d.origin, hidden))
      const { extNodes } = buildExternalLayout(internal, visibleDomains, catalog, g)
      const all = [...internal, ...extNodes]
      const ids = new Set(all.map((n) => n.id))
      setNodes(all)
      setEdges(
        separateParallelEdges([
          ...structure.edges,
          ...buildCrossEdges(
            crossE,
            new Set(visibleDomains.map((d) => d.origin)),
            ids,
            bundle,
            new Set(collapsedModules),
            hidden,
            showInheritedEdges,
          ),
        ]),
      )
    },
    [structure, allExternal, hidden, catalog, crossE, bundle, collapsedModules, showInheritedEdges],
  )
  const firstFit = useCallback(() => {
    if (fitted.current) return
    fitted.current = true
    requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 400 })
    })
  }, [fitView])

  // Read the cache NON-reactively in the reconciler. A drag's own `commit` updates the
  // cache; if the reconciler depended on that, every drag would rebuild all nodes and
  // fight the live drag (the rollback). So it keys off STRUCTURE only (file edits,
  // collapse, new domains) + a one-shot "layout loaded" flag — never off a position change.
  const savedRef = useRef(saved)
  savedRef.current = saved
  const layoutReady = saved !== undefined

  // reconcile structure → layout: pure repaint when every node is known; ELK only when the
  // canvas is cold; cheap packing for nodes the agent newly added. NEVER runs on a drag.
  useEffect(() => {
    const cur = savedRef.current
    if (!cur) return // layout still loading — don't lay out (would overwrite it)
    const placed = structure.nodes.filter((n) => cur[n.id])
    const pending = structure.nodes.filter((n) => !cur[n.id])
    if (pending.length === 0) {
      compose(cur)
      firstFit()
      return
    }
    if (placed.length === 0) {
      // cold canvas: lay everything out once, persist it as the baseline, fit the view
      let cancelled = false
      elkLayout(structure.nodes, structure.edges).then((laid) => {
        if (cancelled) return
        const g = geometryOf(laid)
        compose(g)
        commit(g)
        firstFit()
      })
      return () => {
        cancelled = true
      }
    }
    // incremental: place only the new nodes, leave everything else exactly put
    const added = packPendingNodes(
      placed.map((node) => ({ node, position: cur[node.id] })),
      pending,
    )
    compose({ ...cur, ...added })
    commit(added)
    firstFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, layoutReady, allExternal, crossE, catalog, hiddenKey])

  // the 'region' rectangle is a derived node (not in state) — ignore changes targeting it
  const onNodesChange = useCallback(
    (c: NodeChange[]) =>
      setNodes((nds) =>
        applyNodeChanges(
          c.filter((ch) => (ch as { id?: string }).id !== 'region'),
          nds,
        ),
      ),
    [],
  )
  const onEdgesChange = useCallback(
    (c: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(c, eds)),
    [],
  )

  // a drag commits to the layout of record (cache now, disk debounced). For a class drag we
  // ALSO persist its module box's grown size — `expandParent` enlarged it to fit the class,
  // and if we didn't save that, the next recompose would shrink it and clamp the class back
  // (the rollback). `extent:'parent'` keeps classes at ≥0 offsets, so the box origin never
  // moves and siblings never shift — only the box SIZE needs capturing.
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const updates: Geometry = {
        [node.id]: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          ...sizeOfNode(node),
        },
      }
      if (node.parentId) {
        const all = getNodes()
        const parent = all.find((n) => n.id === node.parentId)
        if (parent) {
          let w =
            parent.measured?.width ??
            (typeof parent.style?.width === 'number' ? parent.style.width : 200)
          let h =
            parent.measured?.height ??
            (typeof parent.style?.height === 'number' ? parent.style.height : 120)
          for (const k of all) {
            if (k.parentId !== node.parentId) continue
            w = Math.max(w, k.position.x + (k.measured?.width ?? 160))
            h = Math.max(h, k.position.y + (k.measured?.height ?? 88))
          }
          updates[parent.id] = {
            x: Math.round(parent.position.x),
            y: Math.round(parent.position.y),
            w: Math.round(w),
            h: Math.round(h),
          }
        }
      }
      commit(updates)
    },
    [commit, getNodes],
  )

  // the one deliberate relayout: drop manual geometry, run ELK over everything, fit.
  const autoArrange = useCallback(async () => {
    await api.resetLayout(domainId).catch(() => {})
    const laid = await elkLayout(structure.nodes, structure.edges)
    const g = geometryOf(laid)
    compose(g)
    qc.setQueryData<LayoutState>(qk.layout(domainId), { positions: g })
    api.setLayout(domainId, g).catch(() => {})
    requestAnimationFrame(() => fitView({ padding: 0.18, duration: 400 }))
  }, [domainId, structure, fitView, compose, qc])

  // focus + context: dim non-neighbors of the active (pinned or hovered) node
  const active = focusId ?? hoverId
  const sets = useMemo(() => (active ? neighborSet(active, edges) : null), [active, edges])

  // the internal rectangle, re-derived from the live module positions → auto-resizes on drag
  const regionNode = useMemo(
    () => deriveRegion(nodes, bundle.ir?.domain ?? ''),
    [nodes, bundle.ir?.domain],
  )
  const canvasCommentGroups = useMemo(
    () => schemaCanvasCommentGroups(commentStore?.comments),
    [commentStore?.comments],
  )
  const canvasFallbackComments = useMemo(
    () => schemaCanvasFallbackComments(commentStore?.comments),
    [commentStore?.comments],
  )
  const canvasCommentNodes = useMemo(() => commentNodes(canvasCommentGroups), [canvasCommentGroups])

  const displayNodes = useMemo(() => {
    const mapped = nodes.map((n) => {
      if (n.type !== 'classNode') return n.className ? { ...n, className: undefined } : n
      const cls = sets && !sets.nodeIds.has(n.id) ? 'is-dimmed' : undefined
      return n.className === cls ? n : { ...n, className: cls }
    })
    const base = regionNode ? [regionNode, ...mapped] : mapped
    return canvasCommentNodes.length ? [...base, ...canvasCommentNodes] : base
  }, [nodes, sets, regionNode, canvasCommentNodes])
  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const edgeName = (e.data?.edgeClass as string | undefined) ?? e.id.replace(/^edge-/, '')
        const isSelected = selectedClass === `class.${edgeName}`
        const focusCls = !sets ? undefined : sets.edgeIds.has(e.id) ? 'is-on' : 'is-dimmed'
        const cls = isSelected ? cn('is-selected', focusCls) : focusCls
        if (isSelected) {
          const accent = 'var(--color-primary)'
          return {
            ...e,
            className: cls,
            data: { ...e.data, selected: true },
            style: { ...e.style, stroke: accent, strokeWidth: 3 },
            markerEnd:
              typeof e.markerEnd === 'object' ? { ...e.markerEnd, color: accent } : e.markerEnd,
          }
        }
        return e.className === cls && !e.data?.selected
          ? e
          : { ...e, className: cls, data: { ...e.data, selected: false } }
      }),
    [edges, sets, selectedClass],
  )

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={schemaNodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_, n) => {
        if (n.id.startsWith('class.')) focusClass(n.id)
        else if (n.id.startsWith('grp-')) selectClass(`module.${n.id.slice('grp-'.length)}`)
      }}
      onNodeMouseEnter={(_, n) => n.id.startsWith('class.') && setHoverId(n.id)}
      onNodeMouseLeave={() => setHoverId(null)}
      onEdgeClick={(_, edge) => {
        if (!edge.id.startsWith('edge-')) return // ignore cross-domain (implements) edges
        const name = (edge.data?.edgeClass as string | undefined) ?? edge.id.slice('edge-'.length)
        selectClass(`class.${name}`)
      }}
      onPaneClick={() => {
        setFocus(null)
        setOpenAnchor(null)
      }}
      minZoom={0.15}
      nodesConnectable={false}
      edgesFocusable={true}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={18} size={1} color="oklch(0.3 0.01 270)" />
      <ErdMarkerDefs />
      <Controls
        className="!bg-card !border !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!fill-foreground"
        showInteractive={false}
      >
        <ControlButton onClick={autoArrange} title="Auto-arrange (ELK) — clears manual layout">
          <LayoutGrid className="h-4 w-4 text-foreground" />
        </ControlButton>
      </Controls>
      <MiniMap
        pannable
        zoomable
        className="!bg-card !border !border-border"
        nodeColor={(n) =>
          n.type === 'classNode'
            ? `oklch(0.6 0.13 ${(n.data as ClassNodeData).hue})`
            : 'transparent'
        }
        nodeStrokeWidth={0}
        maskColor="oklch(0.17 0.01 270 / 0.7)"
      />
      <Panel position="top-right" className="flex gap-1.5">
        {canvasFallbackComments.length > 0 && (
          <CanvasCommentPin
            threads={canvasFallbackComments}
            anchor={{ ref: 'section.schema', kind: 'section' }}
            excerpt="Schema canvas"
          />
        )}
        <Button
          size="xs"
          variant={panelOverlay === 'domains' ? 'default' : 'outline'}
          onClick={() => setPanelOverlay(panelOverlay === 'domains' ? null : 'domains')}
          title="Imported domains — shown in the right panel"
        >
          <Globe className="h-3.5 w-3.5" /> Domains
          <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
            {allExternal.length}
          </span>
        </Button>
        <Button
          size="xs"
          variant={panelOverlay === 'views' ? 'default' : 'outline'}
          onClick={() => setPanelOverlay(panelOverlay === 'views' ? null : 'views')}
          title="Views — shown in the right panel"
        >
          <AppWindow className="h-3.5 w-3.5" /> Views
          <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
            {viewsCount}
          </span>
        </Button>
        <Button
          size="xs"
          variant={panelOverlay === 'integrations' ? 'default' : 'outline'}
          onClick={() => setPanelOverlay(panelOverlay === 'integrations' ? null : 'integrations')}
          title="Integrations — shown in the right panel"
        >
          <Plug className="h-3.5 w-3.5" /> Integrations
          <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
            {integrationsCount}
          </span>
        </Button>
        <Button
          size="xs"
          variant={showInheritedEdges ? 'default' : 'outline'}
          onClick={toggleInheritedEdges}
          title="Toggle Class inheritance edges"
        >
          <Spline className="h-3.5 w-3.5" /> Inherited
        </Button>
        <CoreModeToggle count={coreCount} />
      </Panel>
    </ReactFlow>
  )
}
