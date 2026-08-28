import type { LayoutState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { SmartEdgeProvider } from '@tisoap/react-flow-smart-edge'
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
  useStore,
} from '@xyflow/react'
import { Frame, LayoutGrid, Sigma, Spline, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { hasAnyUnsentDraft } from '@/components/thread'
import { api, qk } from '@/lib/api'
import { useCatalog, useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { ClassNodeData } from '../projection'

import { CanvasIconToggle, CanvasToolbar } from '../canvas-toolbar'
import { dismissMenusOnCanvasPress } from '../dismiss'
import { EdgeMarkerDefs } from '../edge-markers'
import { assignFloatingEdgePorts, SMART_EDGE_PROVIDER_OPTIONS } from '../edge-routing'
import { viewportForNodes } from '../fit'
import { type EdgeFocus, edgeTypes } from '../floating-edge'
import { clampInsideModule, moduleBoxSize, normalizeModuleLayout } from '../geometry'
import { CanvasCommentPin } from '../graph'
import {
  commentNodes,
  neighborSet,
  schemaCanvasCommentGroups,
  schemaCanvasFallbackComments,
  selectedRelationshipContext,
} from '../graph/structure'
import { useLayoutCommitter } from '../layout-commit'
import { CLASS_H, CLASS_W, VIEW_HUE, moduleTint } from '../palette'
import { workspaceLayoutUpdate } from './geometry'
import {
  WorkspaceNodeActionsProvider,
  workspaceNodeTypes,
  type WorkspaceNodeActions,
} from './nodes'
import {
  composeWorkspaceCanvas,
  qualifiedNodeId,
  type WorkspaceDomainProjection,
} from './projection'
import { useSchemaWorkspace } from './store'

function localNodeRef(id: string): { domainId: string; localId: string } | null {
  if (!id.startsWith('workspace:')) return null
  const [, encodedDomainId, ...rest] = id.split(':')
  if (!encodedDomainId || rest.length === 0) return null
  return { domainId: decodeURIComponent(encodedDomainId), localId: rest.join(':') }
}

export function WorkspaceSchemaGraph({
  domains,
  onToggleInherited,
}: {
  domains: WorkspaceDomainProjection[]
  onToggleInherited: () => void
}) {
  const { getInternalNode, getNode, getNodes, getViewport, setCenter, setViewport } = useReactFlow()
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const panZoomReady = useStore((state) => state.panZoom !== null)
  const [fitRequest, setFitRequest] = useState(0)
  const { data: catalog } = useCatalog()
  const activeDomainId = useUI((state) => state.domainId) ?? domains[0]?.input.summary.id ?? ''
  const selected = useUI((state) => state.selectedClass)
  const focusId = useUI((state) => state.focusId)
  const setDomain = useUI((state) => state.setDomain)
  const setOpenAnchor = useUI((state) => state.setOpenAnchor)
  const showCardinality = useUI((state) => state.showCardinality)
  const scheme = useUI((state) => state.resolvedTheme)
  const toggleCardinality = useUI((state) => state.toggleCardinality)
  const domainPositions = useSchemaWorkspace((state) => state.domainPositions)
  const externalPositions = useSchemaWorkspace((state) => state.externalPositions)
  const domainContentOffsets = useSchemaWorkspace((state) => state.domainContentOffsets)
  const setDomainPosition = useSchemaWorkspace((state) => state.setDomainPosition)
  const ensureDomainPositions = useSchemaWorkspace((state) => state.ensureDomainPositions)
  const ensureExternalPositions = useSchemaWorkspace((state) => state.ensureExternalPositions)
  const ensureDomainContentOffsets = useSchemaWorkspace((state) => state.ensureDomainContentOffsets)
  const resetWorkspaceFrames = useSchemaWorkspace((state) => state.resetWorkspaceFrames)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const { commitLayout } = useLayoutCommitter()
  const queryClient = useQueryClient()
  const { data: commentStore } = useComments(activeDomainId)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const fittedDomains = useRef('')
  const fitAfterReset = useRef(false)
  const solo = domains.length === 1

  // One click does both: focus the domain AND act on what was clicked. Requiring a
  // first click just to "enter" a domain made every selection a double click.
  const activate = useCallback(
    (domainId: string, ref?: string) => {
      if (useUI.getState().domainId !== domainId) setDomain(domainId)
      if (!ref) return
      // a class both selects AND pins graph focus (which dims what it is not wired to);
      // a module box only selects — there is nothing to trace from a container.
      if (ref.startsWith('class.')) useUI.getState().focusClass(ref)
      else useUI.getState().selectClass(ref)
    },
    [setDomain],
  )

  const toggleWorkspaceModule = useCallback(
    (domainId: string, path: string) => {
      if (useUI.getState().domainId !== domainId) setDomain(domainId)
      toggleModule(domainId, path)
    },
    [setDomain, toggleModule],
  )

  // Auto-arrange goes through the SAME path as a cold canvas: empty the domain's layout
  // of record, and `prepareWorkspaceDomain` lays it out with ELK on the next pass.
  const autoArrange = useCallback(async () => {
    if (!activeDomainId) return
    fitAfterReset.current = true
    // Drop the record on disk FIRST: a refetch that lands between the two would
    // restore the very positions this is discarding.
    await api.resetLayout(activeDomainId).catch(() => {})
    queryClient.setQueryData<LayoutState>(qk.layout(activeDomainId), { positions: {} })
  }, [activeDomainId, queryClient])

  const nodeActions = useMemo<WorkspaceNodeActions>(
    () => ({ toggleModule: toggleWorkspaceModule }),
    [toggleWorkspaceModule],
  )

  const projection = useMemo(
    () =>
      composeWorkspaceCanvas(domains, {
        activeDomainId,
        catalog,
        contentOffsets: domainContentOffsets,
        domainPositions,
        externalPositions,
      }),
    [activeDomainId, catalog, domainContentOffsets, domainPositions, domains, externalPositions],
  )
  const [nodes, setNodes] = useState<Node[]>(projection.nodes)
  const [edges, setEdges] = useState<Edge[]>(projection.edges)

  useEffect(() => {
    ensureDomainPositions(projection.domainPositions)
    ensureExternalPositions(projection.externalPositions)
    ensureDomainContentOffsets(projection.contentOffsets)
    // A box saved too small for its classes would clamp them onto each other, one saved
    // too large keeps space no class uses — paint the fit, and let the next drag persist it.
    setNodes(normalizeModuleLayout(projection.nodes))
    setEdges(projection.edges)
    if (fitAfterReset.current) {
      fitAfterReset.current = false
      setFitRequest((n) => n + 1)
      return
    }
    const domainKey = domains.map((domain) => domain.input.summary.id).join('|')
    if (fittedDomains.current === domainKey) return
    fittedDomains.current = domainKey
    setFitRequest((n) => n + 1)
  }, [
    domains,
    ensureDomainContentOffsets,
    ensureDomainPositions,
    ensureExternalPositions,
    projection,
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
  // class off its module label and the box wrapped tight around the classes it holds.
  // Domain frames are not module boxes, so they pass through untouched.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) =>
        normalizeModuleLayout(
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
      if (node.id.startsWith('workspace-domain:')) {
        setDomainPosition(node.id.slice('workspace-domain:'.length), {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        })
        return
      }

      // The event carries the RAW pointer position — `normalizeModuleLayout` clamped what is
      // painted, so clamp again here or the record and the canvas disagree.
      const parent = node.parentId ? getNode(node.parentId) : undefined
      const inBox = parent?.type === 'group'
      const dragged = inBox ? { ...node, position: clampInsideModule(node.position) } : node
      const update = workspaceLayoutUpdate(dragged)
      if (!update) return
      const updates = { ...update.updates }
      if (inBox && parent) {
        // Persist the box's re-fitted size too, or the next recompose restores the stale
        // one and clamps the class back.
        const siblings = getNodes()
          .filter((candidate) => candidate.parentId === parent.id)
          .map((candidate) => (candidate.id === node.id ? dragged.position : candidate.position))
        const box = moduleBoxSize(siblings)
        const boxUpdate = workspaceLayoutUpdate(parent, { width: box.w, height: box.h })
        if (boxUpdate) Object.assign(updates, boxUpdate.updates)
      }
      commitLayout(update.domainId, updates)
    },
    [commitLayout, getNode, getNodes, setDomainPosition],
  )

  // Selecting a class opens the right panel, which narrows the pane — pan the selection
  // back into view when it would sit under the panel (or off-screen after a ⌘K jump).
  // Zoom is preserved: only the framing moves. Without this the canvas answers a
  // selection with nothing visible, and `onlyRenderVisibleElements` even unmounts the
  // card that was just picked.
  useEffect(() => {
    if (!selected?.startsWith('class.') || !paneWidth || !paneHeight) return
    const node = getInternalNode(qualifiedNodeId(activeDomainId, selected))
    if (!node) return
    const { x, y, zoom } = getViewport()
    const cx = node.internals.positionAbsolute.x + (node.measured.width ?? CLASS_W) / 2
    const cy = node.internals.positionAbsolute.y + (node.measured.height ?? CLASS_H) / 2
    const screenX = cx * zoom + x
    const screenY = cy * zoom + y
    const margin = 24
    const onScreen =
      screenX > margin &&
      screenX < paneWidth - margin &&
      screenY > margin &&
      screenY < paneHeight - margin
    if (!onScreen) setCenter(cx, cy, { zoom })
  }, [activeDomainId, selected, paneWidth, paneHeight, getInternalNode, getViewport, setCenter])

  // ── focus + context, one canvas-wide reading ──
  // `focusId` is a LOCAL ref (`class.Foo`); on this canvas the same class exists in every
  // frame, so it only means anything once qualified with the domain the click activated.
  const focusNodeId = focusId ? qualifiedNodeId(activeDomainId, focusId) : null
  const selectedEdgeContext = useMemo(
    () => selectedRelationshipContext(selectedEdgeId, edges),
    [edges, selectedEdgeId],
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
        const ownerDomainId = edge.data?.ownerDomainId as string | undefined
        const edgeClass = edge.data?.edgeClass as string | undefined
        const isSelected = selectedEdgeId
          ? edge.id === selectedEdgeId
          : !!edgeClass && ownerDomainId === activeDomainId && selected === `class.${edgeClass}`
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
    [activeDomainId, edges, selected, selectedEdgeId, sets],
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
            if (target.localId.startsWith('class.')) activate(target.domainId, target.localId)
            else if (target.localId.startsWith('grp-'))
              activate(target.domainId, `module.${target.localId.slice('grp-'.length)}`)
          }}
          onEdgeClick={(_, edge) => {
            const ownerDomainId = edge.data?.ownerDomainId as string | undefined
            const edgeClass = edge.data?.edgeClass as string | undefined
            if (!ownerDomainId || !edgeClass) return
            setSelectedEdgeId(edge.id)
            if (useUI.getState().domainId !== ownerDomainId) setDomain(ownerDomainId)
            useUI.getState().selectClass(`class.${edgeClass}`)
            useUI.getState().setFocus(null)
          }}
          onPaneClick={() => {
            useUI.getState().setFocus(null)
            // keep a half-written comment open — its own × closes it
            if (!hasAnyUnsentDraft()) setOpenAnchor(null)
          }}
          minZoom={0.08}
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
          <Controls showFitView={false} showInteractive={false} position="bottom-left">
            <ControlButton
              onClick={() => void autoArrange()}
              title="Auto-arrange — discards manual positions"
            >
              <LayoutGrid className="h-4 w-4 text-foreground" />
            </ControlButton>
            {!solo && (
              <ControlButton
                onClick={() => {
                  fitAfterReset.current = true
                  resetWorkspaceFrames()
                }}
                title="Reset and auto-pack workspace regions"
              >
                <Frame className="h-4 w-4 text-foreground" />
              </ControlButton>
            )}
          </Controls>
          <MiniMap
            pannable
            zoomable
            style={{ width: 168, height: 112 }}
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
