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
import { AppWindow, LayoutGrid, Sigma, Spline, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCatalog } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { ClassNodeData } from '../projection'

import { CanvasIconToggle, CanvasToggle, CanvasToolbar } from '../canvas-toolbar'
import { dismissMenusOnCanvasPress } from '../dismiss'
import { EdgeMarkerDefs } from '../edge-markers'
import { assignFloatingEdgePorts, SMART_EDGE_PROVIDER_OPTIONS } from '../edge-routing'
import { viewportForNodes } from '../fit'
import { edgeTypes } from '../floating-edge'
import { useLayoutCommitter } from '../layout-commit'
import { moduleTint } from '../palette'
import { workspaceLayoutUpdate, type WorkspaceSize } from './geometry'
import {
  WorkspaceNodeActionsProvider,
  workspaceNodeTypes,
  type WorkspaceNodeActions,
} from './nodes'
import { composeWorkspaceCanvas, type WorkspaceDomainProjection } from './projection'
import { useSchemaWorkspace } from './store'

function localNodeRef(id: string): { domainId: string; localId: string } | null {
  if (!id.startsWith('workspace:')) return null
  const [, encodedDomainId, ...rest] = id.split(':')
  if (!encodedDomainId || rest.length === 0) return null
  return { domainId: decodeURIComponent(encodedDomainId), localId: rest.join(':') }
}

export function WorkspaceSchemaGraph({
  domains,
  viewsCount,
  onToggleInherited,
}: {
  domains: WorkspaceDomainProjection[]
  viewsCount: number
  onToggleInherited: () => void
}) {
  const { getNode, setViewport } = useReactFlow()
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const panZoomReady = useStore((state) => state.panZoom !== null)
  const [fitRequest, setFitRequest] = useState(0)
  const { data: catalog } = useCatalog()
  const activeDomainId = useUI((state) => state.domainId) ?? domains[0]?.input.summary.id ?? ''
  const selected = useUI((state) => state.selectedClass)
  const setDomain = useUI((state) => state.setDomain)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const showCardinality = useUI((state) => state.showCardinality)
  const scheme = useUI((state) => state.resolvedTheme)
  const toggleCardinality = useUI((state) => state.toggleCardinality)
  const domainPositions = useSchemaWorkspace((state) => state.domainPositions)
  const externalPositions = useSchemaWorkspace((state) => state.externalPositions)
  const domainSizes = useSchemaWorkspace((state) => state.domainSizes)
  const domainContentOffsets = useSchemaWorkspace((state) => state.domainContentOffsets)
  const setDomainPosition = useSchemaWorkspace((state) => state.setDomainPosition)
  const setDomainSize = useSchemaWorkspace((state) => state.setDomainSize)
  const ensureDomainPositions = useSchemaWorkspace((state) => state.ensureDomainPositions)
  const ensureExternalPositions = useSchemaWorkspace((state) => state.ensureExternalPositions)
  const ensureDomainContentOffsets = useSchemaWorkspace((state) => state.ensureDomainContentOffsets)
  const resetWorkspaceFrames = useSchemaWorkspace((state) => state.resetWorkspaceFrames)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const { commitLayout } = useLayoutCommitter()
  const fittedDomains = useRef('')
  const fitAfterReset = useRef(false)

  const resizeNode = useCallback(
    (nodeId: string, size: WorkspaceSize) => {
      if (nodeId.startsWith('workspace-domain:')) {
        setDomainSize(nodeId.slice('workspace-domain:'.length), size)
        return
      }
      const node = getNode(nodeId)
      if (!node || node.type !== 'group') return
      const update = workspaceLayoutUpdate(node, size)
      if (update) commitLayout(update.domainId, update.updates)
    },
    [commitLayout, getNode, setDomainSize],
  )

  // One click does both: focus the domain AND act on what was clicked. Requiring a
  // first click just to "enter" a domain made every selection a double click.
  const activate = useCallback(
    (domainId: string, ref?: string) => {
      if (useUI.getState().domainId !== domainId) setDomain(domainId)
      if (ref) useUI.getState().selectClass(ref)
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

  const nodeActions = useMemo<WorkspaceNodeActions>(
    () => ({ activateDomain: activate, resizeNode, toggleModule: toggleWorkspaceModule }),
    [activate, resizeNode, toggleWorkspaceModule],
  )

  const projection = useMemo(
    () =>
      composeWorkspaceCanvas(domains, {
        activeDomainId,
        catalog,
        contentOffsets: domainContentOffsets,
        domainPositions,
        domainSizes,
        externalPositions,
      }),
    [
      activeDomainId,
      catalog,
      domainContentOffsets,
      domainPositions,
      domainSizes,
      domains,
      externalPositions,
    ],
  )
  const [nodes, setNodes] = useState<Node[]>(projection.nodes)
  const [edges, setEdges] = useState<Edge[]>(projection.edges)

  useEffect(() => {
    ensureDomainPositions(projection.domainPositions)
    ensureExternalPositions(projection.externalPositions)
    ensureDomainContentOffsets(projection.contentOffsets)
    setNodes(projection.nodes)
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((change) => change.type !== 'remove'),
          current,
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

      const update = workspaceLayoutUpdate(node)
      if (update) commitLayout(update.domainId, update.updates)
    },
    [commitLayout, setDomainPosition],
  )

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const ownerDomainId = edge.data?.ownerDomainId as string | undefined
        const edgeClass = edge.data?.edgeClass as string | undefined
        const isSelected =
          !!edgeClass && ownerDomainId === activeDomainId && selected === `class.${edgeClass}`
        if (!isSelected) return edge
        const accent = 'var(--color-primary)'
        return {
          ...edge,
          className: cn(edge.className, 'is-selected'),
          data: { ...edge.data, selected: true },
          style: { ...edge.style, stroke: accent, strokeWidth: 3 },
          markerEnd:
            typeof edge.markerEnd === 'object'
              ? { ...edge.markerEnd, color: accent }
              : edge.markerEnd,
        }
      }),
    [activeDomainId, edges, selected],
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
          nodes={nodes}
          edges={routedEdges}
          nodeTypes={workspaceNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, node) => {
            if (node.id.startsWith('workspace-domain:')) {
              activate(node.id.slice('workspace-domain:'.length))
              return
            }
            const target = localNodeRef(node.id)
            if (!target) return
            if (target.localId.startsWith('class.')) activate(target.domainId, target.localId)
            else if (target.localId.startsWith('grp-'))
              activate(target.domainId, `module.${target.localId.slice('grp-'.length)}`)
          }}
          onEdgeClick={(_, edge) => {
            const ownerDomainId = edge.data?.ownerDomainId as string | undefined
            const edgeClass = edge.data?.edgeClass as string | undefined
            if (ownerDomainId && edgeClass) activate(ownerDomainId, `class.${edgeClass}`)
          }}
          onPaneClick={() => useUI.getState().setFocus(null)}
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
              onClick={() => {
                fitAfterReset.current = true
                resetWorkspaceFrames()
              }}
              title="Reset and auto-pack workspace regions"
            >
              <LayoutGrid className="h-4 w-4 text-foreground" />
            </ControlButton>
          </Controls>
          <MiniMap
            pannable
            zoomable
            style={{ width: 168, height: 112 }}
            nodeColor={(node) =>
              node.type === 'classNode'
                ? moduleTint((node.data as ClassNodeData).hue, scheme).mark
                : node.type === 'workspaceDomain'
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

          <Panel position="top-right">
            <CanvasToolbar>
              <CanvasToggle
                icon={<AppWindow />}
                label="Views"
                count={viewsCount}
                pressed={panelOverlay === 'views'}
                title="Views across selected domains"
                onClick={() => setPanelOverlay(panelOverlay === 'views' ? null : 'views')}
              />
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
