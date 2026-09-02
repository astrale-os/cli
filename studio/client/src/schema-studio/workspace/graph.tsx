import type { LayoutState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { SmartEdgeProvider } from '@tisoap/react-flow-smart-edge'
import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type EdgeChange,
  type InternalNode,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { LayoutGrid, Sigma, Spline, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, qk } from '@/lib/api'
import { hasAnyUnsentDraft } from '@/lib/comment-drafts'
import { useCatalog, useComments, useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { decodeFlowNodeId } from '@/lib/targets'
import { cn } from '@/lib/utils'

import type { ClassNodeData } from '../projection'

import { CanvasIconToggle, CanvasToolbar } from '../canvas-toolbar'
import { dismissMenusOnCanvasPress } from '../dismiss'
import { EdgeMarkerDefs } from '../edge-markers'
import { assignFloatingEdgePorts, SMART_EDGE_PROVIDER_OPTIONS } from '../edge-routing'
import { type CanvasBox, revealViewport, viewportForNodes } from '../fit'
import { type EdgeFocus, edgeTypes } from '../floating-edge'
import { type Geometry, normalizeContainerLayout } from '../geometry'
import { CanvasCommentPin } from '../graph'
import {
  commentNodes,
  neighborSet,
  relationshipEdgeIds,
  schemaCanvasCommentGroups,
  schemaCanvasFallbackComments,
  selectedRelationshipContext,
} from '../graph/structure'
import { useLayoutCommitter } from '../layout-commit'
import { CLASS_H, CLASS_W, DOCK_CLEARANCE, VIEW_HUE, moduleTint } from '../palette'
import { workspaceExternalNodeId, workspaceExternalOrigin } from './external-frames'
import { workspaceGeometry, workspaceLayoutUpdate } from './geometry'
import {
  WorkspaceNodeActionsProvider,
  workspaceNodeTypes,
  type WorkspaceNodeActions,
} from './nodes'
import {
  composeWorkspaceCanvas,
  qualifiedNodeId,
  workspaceDomainNodeId,
  type WorkspaceDomainProjection,
} from './projection'
import { reorganizeSettled } from './reorganize'
import { useSchemaWorkspace } from './store'

/** How far the canvas may be zoomed out — by the wheel, and by a reveal backing off far
 *  enough to hold a whole relationship. */
const MIN_ZOOM = 0.08

/**
 * The nodes a reveal request has to bring into view: a class of the active domain, or the
 * frame an imported domain is drawn as — one box each.
 *
 * A RELATIONSHIP is the other shape this takes. It selects in the same `class.` namespace as
 * a node (see `revealSelection` in the store) but is drawn as a line, with no box of its own,
 * so what gets framed is the cards its paths run between. A relationship is looked up FIRST:
 * finding a path settles what the name means, whereas a class card missing from the store is
 * ambiguous — it can equally be one this projection has not published yet.
 *
 * A DOMAIN is named by origin, and the canvas draws one two ways: as a frame of its own when
 * the workspace composes it, or as the imported box a domain that only lends types is drawn
 * as. The composed frame wins — it is the one that holds the domain's actual members.
 *
 * A module has nothing to pan to, and returns null so the request is dropped.
 */
function revealTargetNodeIds(
  domainId: string,
  target: string,
  edges: Edge[],
  composedDomainIdByOrigin: Map<string, string>,
): string[] | null {
  if (target.startsWith('domain.')) {
    const origin = target.slice('domain.'.length)
    const composed = composedDomainIdByOrigin.get(origin)
    return [composed ? workspaceDomainNodeId(composed) : workspaceExternalNodeId(origin)]
  }
  const name = /^(?:class|edge)\./.exec(target) ? target.slice(target.indexOf('.') + 1) : null
  if (name === null) return null
  const paths = relationshipEdgeIds(edges, domainId, name)
  if (paths.length > 0) {
    const endpoints = new Set<string>()
    for (const edge of edges) {
      if (!paths.includes(edge.id)) continue
      endpoints.add(edge.source)
      endpoints.add(edge.target)
    }
    return [...endpoints]
  }
  // No path drawn for it: an `edge.` target is a relationship the canvas does not hold, a
  // `class.` one is the card it names — possibly not projected yet, which the caller waits on.
  return target.startsWith('class.') ? [qualifiedNodeId(domainId, target)] : null
}

/** A node's box in flow coordinates. Falls back to the declared style — an external frame is
 *  sized by style rather than measured until it mounts, and that is exactly the case a reveal
 *  is here to fix — and then to a class card, the canvas's smallest box. */
function nodeBox(node: InternalNode<Node> | undefined) {
  if (!node) return null
  const style = node.style as { width?: number; height?: number } | undefined
  const width = node.measured.width ?? style?.width ?? CLASS_W
  const height = node.measured.height ?? style?.height ?? CLASS_H
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width,
    height,
  }
}

function localNodeRef(id: string): { domainId: string; localId: string } | null {
  const identity = decodeFlowNodeId(id)
  return identity.domainId ? { domainId: identity.domainId, localId: identity.localId } : null
}

export function WorkspaceSchemaGraph({
  domains,
  onToggleInherited,
}: {
  domains: WorkspaceDomainProjection[]
  onToggleInherited: () => void
}) {
  const { getInternalNode, getViewport, setViewport } = useReactFlow()
  // the pane element itself — a reveal measures it rather than trusting the size the store
  // was last told (see the reveal effect)
  const domNode = useStore((state) => state.domNode)
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const panZoomReady = useStore((state) => state.panZoom !== null)
  const [fitRequest, setFitRequest] = useState(0)
  const { data: catalog } = useCatalog()
  const { data: workspace } = useWorkspace()
  const activeDomainId = useUI((state) => state.domainId) ?? domains[0]?.input.summary.id ?? ''
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  // What the reader picked, and where it lives. A selection with no owner yet (nothing
  // clicked since load) reads as the active domain's — that is what ⌘K and the comments
  // tab select into.
  const selectionDomain = selectionDomainId ?? activeDomainId
  const focusId = useUI((state) => state.focusId)
  // the floating dock sits over the bottom of the view: keep the controls above it
  const panelSide = useUI((state) => state.panelSide)
  const dockLift = panelSide === 'bottom' ? { bottom: DOCK_CLEARANCE } : undefined
  const revealTarget = useUI((state) => state.revealTarget)
  const revealOnCanvas = useUI((state) => state.revealOnCanvas)
  const setOpenAnchor = useUI((state) => state.setOpenAnchor)
  const showCardinality = useUI((state) => state.showCardinality)
  const scheme = useUI((state) => state.resolvedTheme)
  const toggleCardinality = useUI((state) => state.toggleCardinality)
  const domainPositions = useSchemaWorkspace((state) => state.domainPositions)
  const externalPositions = useSchemaWorkspace((state) => state.externalPositions)
  const setDomainPosition = useSchemaWorkspace((state) => state.setDomainPosition)
  const setExternalPosition = useSchemaWorkspace((state) => state.setExternalPosition)
  const ensureDomainPositions = useSchemaWorkspace((state) => state.ensureDomainPositions)
  const ensureExternalPositions = useSchemaWorkspace((state) => state.ensureExternalPositions)
  const resetWorkspaceFrames = useSchemaWorkspace((state) => state.resetWorkspaceFrames)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)
  const expandedExternals = useSchemaWorkspace((state) => state.expandedExternals)
  const toggleExternalExpanded = useSchemaWorkspace((state) => state.toggleExternalExpanded)
  // A grey frame that stands for a domain this workspace HAS can offer to draw it, so the
  // reader promotes it where they found it rather than going back to the rail to look it up.
  const workspaceOrigins = useMemo(
    () => Object.fromEntries((workspace ?? []).map((domain) => [domain.origin, domain.id])),
    [workspace],
  )
  // Which domains the canvas draws a frame OF ITS OWN for, by origin — how a `domain.` jump
  // tells a composed domain from one that is merely imported. Not `workspaceOrigins`: that
  // one also holds domains the canvas is not drawing, whose frame a jump could never reach.
  const composedDomainIdByOrigin = useMemo(
    () => new Map(domains.map((domain) => [domain.input.summary.origin, domain.input.summary.id])),
    [domains],
  )
  const { commitLayout, discardLayout } = useLayoutCommitter()
  const queryClient = useQueryClient()
  const { data: commentStore } = useComments(activeDomainId)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const fittedNodes = useRef('')
  // The domains a running reorganize still waits on — see the projection effect below.
  const reorganizing = useRef<string[] | null>(null)
  const solo = domains.length === 1

  // Selecting on the canvas says what you are looking at, and nothing else. It used to
  // also make the clicked node's domain ACTIVE — which silently swapped the agent
  // conversation, the comment threads and what Core/Process show, for a click that only
  // meant "show me this class". The selection carries its own domain instead.
  const select = useCallback((domainId: string, ref: string) => {
    // a class both selects AND pins graph focus (which dims what it is not wired to);
    // a module box only selects — there is nothing to trace from a container.
    if (ref.startsWith('class.')) useUI.getState().focusClass(ref, domainId)
    else useUI.getState().selectClass(ref, domainId)
  }, [])

  const toggleWorkspaceModule = useCallback(
    (domainId: string, path: string) => toggleModule(domainId, path),
    [toggleModule],
  )

  // One gesture, the whole canvas: discard EVERY hand-placed position — the geometry inside
  // each domain (the record on disk) and the frames those domains sit in (the record in the
  // workspace store) — and let ELK and the frame packer lay it out again, the exact path a
  // cold canvas takes. Framing the result is left to the projection effect below: the two
  // halves land on different schedules, and only it can see when the second one has.
  const reorganize = useCallback(async () => {
    const domainIds = domains.map((domain) => domain.input.summary.id)
    reorganizing.current = domainIds
    // A drag from the half-second before this click still owes a write; let it land and it
    // would put the discarded positions straight back, after the reset erased them.
    for (const domainId of domainIds) discardLayout(domainId)
    resetWorkspaceFrames()
    // Drop the records on disk FIRST: a refetch that lands between the two would
    // restore the very positions this is discarding.
    await Promise.all(domainIds.map((domainId) => api.resetLayout(domainId).catch(() => {})))
    for (const domainId of domainIds) {
      queryClient.setQueryData<LayoutState>(qk.layout(domainId), { positions: {} })
    }
  }, [discardLayout, domains, queryClient, resetWorkspaceFrames])

  const nodeActions = useMemo<WorkspaceNodeActions>(
    () => ({
      toggleModule: toggleWorkspaceModule,
      addDomainToCanvas: toggleDomain,
      toggleExternalExpanded,
    }),
    [toggleDomain, toggleExternalExpanded, toggleWorkspaceModule],
  )

  const projection = useMemo(
    () =>
      composeWorkspaceCanvas(domains, {
        catalog,
        domainPositions,
        externalPositions,
        workspaceOrigins,
        expandedExternals,
      }),
    [catalog, domainPositions, domains, expandedExternals, externalPositions, workspaceOrigins],
  )
  const [nodes, setNodes] = useState<Node[]>(projection.nodes)
  const [edges, setEdges] = useState<Edge[]>(projection.edges)

  // While a drag is in flight the canvas OWNS the frame anchors: `onNodeDragStop` reads each
  // one off the painted frame and writes it to the workspace store, which re-composes the
  // projection around it. Adopting that echo would repaint every node from the geometry of
  // record — still one drag behind, since its own projection lands a tick later — and flash
  // the dropped node back to where the drag started. So a projection is adopted only when
  // something the canvas does NOT already paint has changed: the prepared domains, which
  // domain is active, or the catalog. The frame anchors alone are never news to it.
  const adopted = useRef<{
    domains: WorkspaceDomainProjection[]
    catalog: typeof catalog
    expandedExternals: string[]
    workspaceOrigins: Record<string, string>
  } | null>(null)
  useEffect(() => {
    const echo =
      adopted.current !== null &&
      adopted.current.domains === domains &&
      adopted.current.catalog === catalog &&
      adopted.current.expandedExternals === expandedExternals &&
      adopted.current.workspaceOrigins === workspaceOrigins
    // …unless a reorganize is in flight, whose first wave is exactly a frame-only change and
    // the one time the canvas is not already painting the answer.
    if (echo && reorganizing.current === null) return
    adopted.current = { domains, catalog, expandedExternals, workspaceOrigins }
    // A reorganize lands in two waves (see `reorganizeSettled`), and the first one packs the
    // frames around the very geometry it is discarding. Paint that wave — it is what the
    // canvas holds until the re-layout arrives — but do not KEEP it: the store never
    // overwrites an anchor it already has, so a packing recorded here is the one the reader
    // is left with, spread across a canvas the re-layout has since made compact.
    const settling =
      reorganizing.current !== null && !reorganizeSettled(domains, reorganizing.current)
    if (!settling) {
      ensureDomainPositions(projection.domainPositions)
      ensureExternalPositions(projection.externalPositions)
    }
    // A box saved too small for its classes would drop them onto each other, one saved
    // too large keeps space no class uses — paint the fit, and let the next drag persist it.
    setNodes(normalizeContainerLayout(projection.nodes))
    setEdges(projection.edges)
    if (settling) return
    if (reorganizing.current) {
      reorganizing.current = null
      setFitRequest((n) => n + 1)
      return
    }
    // What is ON the canvas is what the framing answers to: a domain added or dropped, a
    // module collapsed, an imported domain shown again. Keyed on the node set rather than on
    // geometry, so the one thing that never re-frames is a drag — the reader put the canvas
    // where it is, and a drop must leave it exactly there.
    const nodeKey = projection.nodes
      .map((node) => node.id)
      .sort()
      .join('|')
    if (fittedNodes.current === nodeKey) return
    fittedNodes.current = nodeKey
    setFitRequest((n) => n + 1)
  }, [
    catalog,
    domains,
    ensureDomainPositions,
    ensureExternalPositions,
    expandedExternals,
    projection,
    workspaceOrigins,
  ])

  // React Flow's queued fitView waits on its measurement lifecycle, so frame the
  // canvas from the geometry we already hold (see fit.ts).
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const fitDone = useRef(0)
  useEffect(() => {
    if (fitRequest === 0 || fitRequest === fitDone.current || !panZoomReady) return
    const viewport = viewportForNodes(nodesRef.current, paneWidth, paneHeight)
    if (!viewport) return
    fitDone.current = fitRequest
    setViewport(viewport)
  }, [fitRequest, paneWidth, paneHeight, panZoomReady, setViewport])

  // Every position change (a drag frame included) is re-normalized: that is what keeps a
  // class off its module label, wraps each box tight around what it holds, and carries a
  // module dragged past its frame's edge out into the domain frame around it.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) =>
        normalizeContainerLayout(
          applyNodeChanges(
            changes.filter((change) => change.type !== 'remove'),
            current,
          ),
        ),
      ),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((current) =>
        applyEdgeChanges(
          changes.filter((change) => change.type !== 'remove'),
          current,
        ),
      ),
    [],
  )
  const inheritedOn = domains.every((domain) => domain.input.visibility.showInheritedEdges)

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      // The event carries the RAW pointer position; the canvas holds the re-fitted one, so
      // the record is read off the canvas or the two disagree the moment a box had to move.
      const painted = nodesRef.current
      const at = (id: string) => {
        const found = painted.find((candidate) => candidate.id === id)
        return found ? { x: Math.round(found.position.x), y: Math.round(found.position.y) } : null
      }

      // An imported domain's frame is laid out whole and holds no layout of ours, so its
      // origin is the ENTIRE record a drag writes — no per-node geometry to commit with it.
      const externalOrigin = workspaceExternalOrigin(node.id)
      if (externalOrigin) {
        const position = at(node.id)
        if (position) setExternalPosition(externalOrigin, position)
        return
      }

      const frameDrag = node.id.startsWith('workspace-domain:')
      const domainId = frameDrag
        ? node.id.slice('workspace-domain:'.length)
        : workspaceGeometry(node)?.domainId
      if (!domainId) return

      // The frame's position is the domain's anchor on the canvas, and a drag INSIDE it can
      // move that anchor: growing a box leftwards walks its own edge out to meet the drag.
      const frame = at(workspaceDomainNodeId(domainId))
      if (frame) setDomainPosition(domainId, frame)
      // A frame carries its content along, so dragging one leaves every local position alone.
      if (frameDrag) return

      // Persist the WHOLE domain rather than the node that was dragged: a box growing
      // leftwards shifts every sibling it holds by the same amount, and a partial record
      // would put those siblings back where they no longer belong.
      const updates: Geometry = {}
      for (const candidate of painted) {
        const update = workspaceLayoutUpdate(candidate)
        if (update?.domainId === domainId) Object.assign(updates, update.updates)
      }
      if (Object.keys(updates).length > 0) commitLayout(domainId, updates)
    },
    [commitLayout, setDomainPosition, setExternalPosition],
  )

  // A JUMP has to land somewhere visible: ⌘K, a comment revealed from the panel, or the
  // eye that un-hides an imported domain can all name something off-screen entirely, and
  // `onlyRenderVisibleElements` would not even mount it. So those — and only those — pan
  // the target in, at the current zoom.
  // A click never moves the canvas: the reader put it where it is, and answering a selection
  // by sliding the whole graph under the cursor loses the place they were reading.
  useEffect(() => {
    if (!revealTarget || !paneWidth || !paneHeight) return
    const targetIds = revealTargetNodeIds(
      selectionDomain,
      revealTarget,
      edges,
      composedDomainIdByOrigin,
    )
    // nothing on the canvas stands for it — drop the request rather than leave it pending
    if (!targetIds) {
      revealOnCanvas(null)
      return
    }
    const boxes = targetIds.map((id) => nodeBox(getInternalNode(id)))
    // Not in the store yet — leave the request standing and let the `nodes` dependency
    // below re-run this when it lands. Un-hiding CREATES the node rather than merely
    // scrolling to one, so the wait here is a projection round-trip, not a frame or two.
    if (boxes.some((box) => box === null)) return
    // MEASURED, not taken from the store: the gesture that asks for a jump also selects, and
    // selecting opens the detail panel — so the pane is a column narrower than React Flow has
    // been told yet (its size arrives on a ResizeObserver, a frame behind this effect). Frame
    // against the stale width and the target lands under the panel, which is a jump that did
    // nothing. Same reason the viewport is written directly: `setCenter` reads that width too.
    const pane = domNode?.getBoundingClientRect()
    const framing = revealViewport(
      boxes as CanvasBox[],
      getViewport(),
      pane?.width ?? paneWidth,
      pane?.height ?? paneHeight,
      MIN_ZOOM,
    )
    if (framing) setViewport(framing)
    revealOnCanvas(null)
  }, [
    selectionDomain,
    revealTarget,
    // the projection that brings a just-restored frame into the store
    nodes,
    // the paths a relationship target is resolved against
    edges,
    // the frames a domain target is resolved against
    composedDomainIdByOrigin,
    paneWidth,
    paneHeight,
    domNode,
    getInternalNode,
    getViewport,
    setViewport,
    revealOnCanvas,
  ])

  // ── focus + context, one canvas-wide reading ──
  // `focusId` is a LOCAL ref (`class.Foo`); on this canvas the same class exists in every
  // frame, so it only means anything once qualified with the domain the selection carries.
  // And only over a node that is actually drawn: a RELATIONSHIP selects under the same
  // `class.` prefix and a collapsed module swallows the cards it holds, so an unguarded
  // focus dims the WHOLE canvas against a node that is not on it.
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const focusCandidate = focusId ? qualifiedNodeId(selectionDomain, focusId) : null
  const focusNodeId = focusCandidate && nodeIds.has(focusCandidate) ? focusCandidate : null
  // Which paths a relationship selection lights up: the ONE a click picked, or — when it was
  // named rather than pointed at (⌘K, the rail, a comment's anchor) — every path it is drawn
  // as, since none of those callers has a physical line in hand.
  const selectedEdgeIds = useMemo(() => {
    if (selectedEdgeId) return [selectedEdgeId]
    if (!selected?.startsWith('class.')) return []
    return relationshipEdgeIds(edges, selectionDomain, selected.slice('class.'.length))
  }, [edges, selected, selectedEdgeId, selectionDomain])
  const selectedEdgeContext = useMemo(
    () => selectedRelationshipContext(selectedEdgeIds, edges),
    [edges, selectedEdgeIds],
  )
  useEffect(() => {
    if (!selectedEdgeId) return
    const edge = edges.find((candidate) => candidate.id === selectedEdgeId)
    const edgeClass = edge?.data?.edgeClass as string | undefined
    if (!edgeClass || selected !== `class.${edgeClass}`) setSelectedEdgeId(null)
  }, [edges, selected, selectedEdgeId])
  const sets = useMemo(
    () => (focusNodeId && !selectedEdgeContext ? neighborSet(focusNodeId, edges) : null),
    [edges, focusNodeId, selectedEdgeContext],
  )

  // Canvas-pinned comments belong to the active domain — they are anchored to
  // `section.schema`, which is per domain, not per workspace.
  const canvasCommentNodes = useMemo(
    () => commentNodes(schemaCanvasCommentGroups(commentStore?.comments)),
    [commentStore?.comments],
  )
  const canvasFallbackComments = useMemo(
    () => schemaCanvasFallbackComments(commentStore?.comments),
    [commentStore?.comments],
  )

  const displayNodes = useMemo(() => {
    const mapped = nodes.map((node) => {
      const focusable = node.type === 'classNode' || node.type === 'viewNode'
      const inFocus = focusable && sets ? sets.nodeIds.has(node.id) : false
      const cls =
        cn(
          selectedEdgeContext?.nodeIds.has(node.id) && 'is-edge-endpoint',
          focusable && sets && !inFocus && 'is-dimmed',
          inFocus && node.id !== focusNodeId && 'is-related',
        ) || undefined
      return node.className === cls ? node : { ...node, className: cls }
    })
    return canvasCommentNodes.length ? [...mapped, ...canvasCommentNodes] : mapped
  }, [nodes, sets, focusNodeId, selectedEdgeContext, canvasCommentNodes])

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isSelected = selectedEdgeContext?.edgeIds.has(edge.id) === true
        const focus: EdgeFocus | undefined = !sets
          ? undefined
          : sets.edgeIds.has(edge.id)
            ? 'on'
            : 'dim'
        const focusCls = focus && (focus === 'on' ? 'is-on' : 'is-dimmed')
        const cls = cn(isSelected && 'is-selected', focusCls) || undefined
        // An edge's labels render in React Flow's own portal, outside the <g> `className`
        // lands on, so the focus state has to ride along in `data` for them to follow.
        const data = { ...edge.data, selected: isSelected, focus }
        if (isSelected) {
          const accent = 'var(--color-primary)'
          return {
            ...edge,
            className: cls,
            data,
            style: { ...edge.style, stroke: accent, strokeWidth: 3 },
            markerEnd:
              typeof edge.markerEnd === 'object'
                ? { ...edge.markerEnd, color: accent }
                : edge.markerEnd,
          }
        }
        if (focus === 'on')
          return { ...edge, className: cls, data, style: { ...edge.style, strokeWidth: 2.4 } }
        return { ...edge, className: cls, data }
      }),
    [edges, selectedEdgeContext, sets],
  )
  const routedEdges = useMemo(
    () => assignFloatingEdgePorts(nodes, displayEdges),
    [nodes, displayEdges],
  )

  return (
    <WorkspaceNodeActionsProvider actions={nodeActions}>
      <SmartEdgeProvider nodes={nodes} options={SMART_EDGE_PROVIDER_OPTIONS}>
        <ReactFlow
          onPointerDownCapture={dismissMenusOnCanvasPress}
          data-testid="workspace-schema-canvas"
          nodes={displayNodes}
          edges={routedEdges}
          nodeTypes={workspaceNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, node) => {
            setSelectedEdgeId(null)
            const target = localNodeRef(node.id)
            if (!target) return
            if (target.localId.startsWith('class.')) select(target.domainId, target.localId)
            else if (target.localId.startsWith('grp-'))
              select(target.domainId, `module.${target.localId.slice('grp-'.length)}`)
          }}
          onEdgeClick={(_, edge) => {
            const ownerDomainId = edge.data?.ownerDomainId as string | undefined
            const edgeClass = edge.data?.edgeClass as string | undefined
            if (!ownerDomainId || !edgeClass) return
            setSelectedEdgeId(edge.id)
            useUI.getState().selectClass(`class.${edgeClass}`, ownerDomainId)
            useUI.getState().setFocus(null)
          }}
          onPaneClick={() => {
            // empty space is "nothing here": drop the selection (which closes its detail
            // panel) as well as the focus and the selected edge
            setSelectedEdgeId(null)
            useUI.getState().clearSelection()
            // keep a half-written comment open — its own × closes it
            if (!hasAnyUnsentDraft()) setOpenAnchor(null)
          }}
          minZoom={MIN_ZOOM}
          nodesConnectable={false}
          edgesFocusable
          // React Flow derives an edge's z-index from its endpoints, and a SELECTED node is
          // lifted to 1000 — which dragged that node's edges over the label layer and struck
          // every one of their labels through. Our nodes never overlap, so the lift buys
          // nothing and edges stay below the labels they belong to.
          elevateNodesOnSelect={false}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--color-input)" />
          <EdgeMarkerDefs />
          <Controls
            showFitView={false}
            showInteractive={false}
            position="bottom-left"
            style={dockLift}
          >
            <ControlButton
              onClick={() => void reorganize()}
              title="Auto-arrange and center — discards manual positions"
            >
              <LayoutGrid className="h-4 w-4 text-foreground" />
            </ControlButton>
          </Controls>
          <MiniMap
            pannable
            zoomable
            style={{ width: 168, height: 112, ...dockLift }}
            nodeColor={(node) =>
              node.type === 'classNode'
                ? moduleTint((node.data as ClassNodeData).hue, scheme).mark
                : node.type === 'viewNode'
                  ? moduleTint(VIEW_HUE, scheme).mark
                  : node.type === 'workspaceDomain' && !solo
                    ? moduleTint(255, scheme).border
                    : 'transparent'
            }
            nodeStrokeWidth={0}
          />

          {projection.diagnostics.length > 0 && (
            <Panel position="top-center" className="max-w-xl">
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-card px-3 py-2 text-[11px] text-warning shadow-lg backdrop-blur">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{projection.diagnostics.join(' ')}</span>
              </div>
            </Panel>
          )}

          <Panel position="top-right" className="flex items-center gap-1.5">
            {canvasFallbackComments.length > 0 && (
              <CanvasCommentPin
                threads={canvasFallbackComments}
                anchor={{ ref: 'section.schema', kind: 'section' }}
                excerpt="Schema canvas"
              />
            )}
            <CanvasToolbar>
              <CanvasIconToggle
                icon={<Spline />}
                label="Inheritance"
                hint="draw an edge from each class to the one it extends, in every selected domain"
                pressed={inheritedOn}
                onClick={onToggleInherited}
              />
              <CanvasIconToggle
                icon={<Sigma />}
                label="Cardinality"
                hint="spell out how many of each side a relationship allows"
                pressed={showCardinality}
                onClick={toggleCardinality}
              />
            </CanvasToolbar>
          </Panel>
        </ReactFlow>
      </SmartEdgeProvider>
    </WorkspaceNodeActionsProvider>
  )
}
