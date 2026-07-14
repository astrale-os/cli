import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
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
import { type Geometry, sizeOfNode } from '../geometry'
import { schemaNodeTypes } from '../graph'
import { useLayoutCommitter } from '../layout-commit'
import {
  composeWorkspaceCanvas,
  type WorkspaceDomainNodeData,
  type WorkspaceDomainProjection,
  type WorkspaceNodeGeometryData,
} from './projection'
import { useSchemaWorkspace } from './store'

function WorkspaceDomainNode({ data }: NodeProps) {
  const domain = data as WorkspaceDomainNodeData
  return (
    <div
      data-domain-id={domain.domainId}
      className={cn(
        'relative h-full w-full rounded-[22px] border-2 bg-card/[0.035] shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] transition-colors',
        domain.active
          ? 'border-sky-400/55 bg-sky-400/[0.045]'
          : 'border-border/55 hover:border-border',
      )}
    >
      <div className="absolute inset-x-0 top-0 flex h-12 items-center gap-2 border-b border-border/35 px-4">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            domain.active
              ? 'bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.8)]'
              : 'bg-muted-foreground/35',
          )}
        />
        <span className="truncate text-[13px] font-extrabold tracking-tight">{domain.origin}</span>
        <span className="ml-auto rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
          {domain.memberCount}
        </span>
      </div>
    </div>
  )
}

const workspaceNodeTypes = { ...schemaNodeTypes, workspaceDomain: WorkspaceDomainNode }

function localNodeRef(id: string): { domainId: string; localId: string } | null {
  if (!id.startsWith('workspace:')) return null
  const [, encodedDomainId, ...rest] = id.split(':')
  if (!encodedDomainId || rest.length === 0) return null
  return { domainId: decodeURIComponent(encodedDomainId), localId: rest.join(':') }
}

function workspaceGeometry(node: Node): WorkspaceNodeGeometryData | null {
  return (node.data?.workspaceGeometry as WorkspaceNodeGeometryData | undefined) ?? null
}

function localPosition(node: Node, geometry: WorkspaceNodeGeometryData) {
  return {
    x: Math.round(node.position.x - geometry.offset.x),
    y: Math.round(node.position.y - geometry.offset.y),
  }
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
  const { fitView, getNodes } = useReactFlow()
  const { data: catalog } = useCatalog()
  const activeDomainId = useUI((state) => state.domainId) ?? domains[0]?.input.summary.id ?? ''
  const selected = useUI((state) => state.selectedClass)
  const setDomain = useUI((state) => state.setDomain)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const domainPositions = useSchemaWorkspace((state) => state.domainPositions)
  const domainContentOffsets = useSchemaWorkspace((state) => state.domainContentOffsets)
  const setDomainPosition = useSchemaWorkspace((state) => state.setDomainPosition)
  const ensureDomainContentOffsets = useSchemaWorkspace((state) => state.ensureDomainContentOffsets)
  const resetDomainPositions = useSchemaWorkspace((state) => state.resetDomainPositions)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const { commitLayout } = useLayoutCommitter()
  const fittedDomains = useRef('')

  const projection = useMemo(() => {
    const composed = composeWorkspaceCanvas(
      domains,
      activeDomainId,
      domainPositions,
      catalog,
      domainContentOffsets,
    )
    return {
      ...composed,
      nodes: composed.nodes.map((node) =>
        node.type === 'group' || node.type === 'moduleNode'
          ? {
              ...node,
              data: {
                ...node.data,
                onToggleModule: (domainId: string, path: string) => toggleModule(domainId, path),
              },
            }
          : node,
      ),
    }
  }, [activeDomainId, catalog, domainContentOffsets, domainPositions, domains, toggleModule])
  const [nodes, setNodes] = useState<Node[]>(projection.nodes)
  const [edges, setEdges] = useState<Edge[]>(() => separateParallelEdges(projection.edges))

  useEffect(() => {
    ensureDomainContentOffsets(projection.contentOffsets)
    setNodes(projection.nodes)
    setEdges(separateParallelEdges(projection.edges))
    const domainKey = domains.map((domain) => domain.input.summary.id).join('|')
    if (fittedDomains.current === domainKey) return
    fittedDomains.current = domainKey
    const frame = requestAnimationFrame(() => fitView({ padding: 0.12, duration: 420 }))
    return () => cancelAnimationFrame(frame)
  }, [domains, ensureDomainContentOffsets, fitView, projection])

  const activate = useCallback(
    (domainId: string, ref?: string) => {
      if (useUI.getState().domainId !== domainId) setDomain(domainId)
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

      const geometry = workspaceGeometry(node)
      if (!geometry) return
      const updates: Geometry = {
        [geometry.localId]: {
          ...localPosition(node, geometry),
          ...sizeOfNode(node),
        },
      }

      if (node.parentId) {
        const all = getNodes()
        const parent = all.find((candidate) => candidate.id === node.parentId)
        const parentGeometry = parent ? workspaceGeometry(parent) : null
        if (parent && parentGeometry) {
          let width =
            parent.measured?.width ??
            (typeof parent.style?.width === 'number' ? parent.style.width : 200)
          let height =
            parent.measured?.height ??
            (typeof parent.style?.height === 'number' ? parent.style.height : 120)
          for (const sibling of all) {
            if (sibling.parentId !== node.parentId) continue
            width = Math.max(width, sibling.position.x + (sibling.measured?.width ?? 160))
            height = Math.max(height, sibling.position.y + (sibling.measured?.height ?? 88))
          }
          updates[parentGeometry.localId] = {
            ...localPosition(parent, parentGeometry),
            w: Math.round(width),
            h: Math.round(height),
          }
        }
      }

      commitLayout(geometry.domainId, updates)
    },
    [commitLayout, getNodes, setDomainPosition],
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
            resetDomainPositions()
            requestAnimationFrame(() => fitView({ padding: 0.12, duration: 420 }))
          }}
          title="Auto-pack domain regions"
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
  )
}
