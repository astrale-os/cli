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
import { AppWindow, Layers3, LayoutGrid, Spline, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useCatalog } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { ClassNodeData } from '../projection'

import { ErdMarkerDefs } from '../cardinality-markers'
import { edgeTypes, separateParallelEdges } from '../floating-edge'
import { useLayoutCommitter } from '../layout-commit'
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
  const { fitView, getNode } = useReactFlow()
  const { data: catalog } = useCatalog()
  const activeDomainId = useUI((state) => state.domainId) ?? domains[0]?.input.summary.id ?? ''
  const selected = useUI((state) => state.selectedClass)
  const setDomain = useUI((state) => state.setDomain)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const domainPositions = useSchemaWorkspace((state) => state.domainPositions)
  const domainSizes = useSchemaWorkspace((state) => state.domainSizes)
  const domainContentOffsets = useSchemaWorkspace((state) => state.domainContentOffsets)
  const setDomainPosition = useSchemaWorkspace((state) => state.setDomainPosition)
  const setDomainSize = useSchemaWorkspace((state) => state.setDomainSize)
  const ensureDomainPositions = useSchemaWorkspace((state) => state.ensureDomainPositions)
  const ensureDomainContentOffsets = useSchemaWorkspace((state) => state.ensureDomainContentOffsets)
  const resetDomainFrames = useSchemaWorkspace((state) => state.resetDomainFrames)
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

  const toggleWorkspaceModule = useCallback(
    (domainId: string, path: string) => {
      if (useUI.getState().domainId !== domainId) {
        setDomain(domainId)
        return
      }
      toggleModule(domainId, path)
    },
    [setDomain, toggleModule],
  )

  const nodeActions = useMemo<WorkspaceNodeActions>(
    () => ({ resizeNode, toggleModule: toggleWorkspaceModule }),
    [resizeNode, toggleWorkspaceModule],
  )

  const projection = useMemo(
    () =>
      composeWorkspaceCanvas(
        domains,
        activeDomainId,
        domainPositions,
        catalog,
        domainContentOffsets,
        domainSizes,
      ),
    [activeDomainId, catalog, domainContentOffsets, domainPositions, domainSizes, domains],
  )
  const [nodes, setNodes] = useState<Node[]>(projection.nodes)
  const [edges, setEdges] = useState<Edge[]>(() => separateParallelEdges(projection.edges))

  useEffect(() => {
    ensureDomainPositions(projection.domainPositions)
    ensureDomainContentOffsets(projection.contentOffsets)
    setNodes(projection.nodes)
    setEdges(separateParallelEdges(projection.edges))
    if (fitAfterReset.current) {
      fitAfterReset.current = false
      const frame = requestAnimationFrame(() => fitView({ padding: 0.12, duration: 420 }))
      return () => cancelAnimationFrame(frame)
    }
    const domainKey = domains.map((domain) => domain.input.summary.id).join('|')
    if (fittedDomains.current === domainKey) return
    fittedDomains.current = domainKey
    const frame = requestAnimationFrame(() => fitView({ padding: 0.12, duration: 420 }))
    return () => cancelAnimationFrame(frame)
  }, [domains, ensureDomainContentOffsets, ensureDomainPositions, fitView, projection])

  const activate = useCallback(
    (domainId: string, ref?: string) => {
      if (useUI.getState().domainId !== domainId) {
        setDomain(domainId)
        return
      }
      if (ref) useUI.getState().selectClass(ref)
    },
    [setDomain],
  )

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

  return (
    <WorkspaceNodeActionsProvider actions={nodeActions}>
      <ReactFlow
        data-testid="workspace-schema-canvas"
        nodes={nodes}
        edges={displayEdges}
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
          else if (target.localId.startsWith('iface.'))
            activate(target.domainId, `interface.${target.localId.slice('iface.'.length)}`)
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
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="oklch(0.3 0.01 270)" />
        <ErdMarkerDefs />
        <Controls
          className="!border !border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button]:!fill-foreground"
          showInteractive={false}
        >
          <ControlButton
            onClick={() => {
              fitAfterReset.current = true
              resetDomainFrames()
            }}
            title="Reset and auto-pack domain regions"
          >
            <LayoutGrid className="h-4 w-4 text-foreground" />
          </ControlButton>
        </Controls>
        <MiniMap
          pannable
          zoomable
          className="!border !border-border !bg-card"
          nodeColor={(node) =>
            node.type === 'classNode'
              ? `oklch(0.6 0.13 ${(node.data as ClassNodeData).hue})`
              : node.type === 'interfaceNode'
                ? 'oklch(0.6 0.18 330)'
                : node.type === 'workspaceDomain'
                  ? 'oklch(0.52 0.08 225 / 0.45)'
                  : 'transparent'
          }
          nodeStrokeWidth={0}
          maskColor="oklch(0.17 0.01 270 / 0.72)"
        />

        {projection.diagnostics.length > 0 && (
          <Panel position="top-center" className="max-w-xl">
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-card/95 px-3 py-2 text-[11px] text-warning shadow-lg backdrop-blur">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{projection.diagnostics.join(' ')}</span>
            </div>
          </Panel>
        )}

        <Panel position="top-right" className="flex gap-1.5">
          <Button size="xs" variant="outline" disabled title="Selected workspace domains">
            <Layers3 className="h-3.5 w-3.5" /> Domains
            <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
              {domains.length}
            </span>
          </Button>
          <Button
            size="xs"
            variant={panelOverlay === 'views' ? 'default' : 'outline'}
            onClick={() => setPanelOverlay(panelOverlay === 'views' ? null : 'views')}
            title="Views across selected domains"
          >
            <AppWindow className="h-3.5 w-3.5" /> Views
            <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
              {viewsCount}
            </span>
          </Button>
          <Button
            size="xs"
            variant={inheritedOn ? 'default' : 'outline'}
            onClick={onToggleInherited}
            title="Toggle inherited edges in every selected domain"
          >
            <Spline className="h-3.5 w-3.5" /> Inherited
          </Button>
        </Panel>
      </ReactFlow>
    </WorkspaceNodeActionsProvider>
  )
}
