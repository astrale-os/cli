import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { SmartEdgeProvider } from '@tisoap/react-flow-smart-edge'
import {
  Background,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { Box, FolderClosed, FolderTree, Spline } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { hasAnyUnsentDraft } from '@/components/thread'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { CanvasIconToggle, CanvasToolbar } from '../canvas-toolbar'
import { dismissMenusOnCanvasPress } from '../dismiss'
import { EdgeMarkerDefs } from '../edge-markers'
import { assignFloatingEdgePorts, SMART_EDGE_PROVIDER_OPTIONS } from '../edge-routing'
import { elkLayout } from '../elk-layout'
import { viewportForNodes } from '../fit'
import { edgeTypes } from '../floating-edge'
import { NodeCommentPin } from '../node-comment-pin'
import { moduleTint } from '../palette'
import { SchemaIcon } from '../schema-icon'
import { type CoreNodeData, buildCoreGraph, hueMapOf, nodeAnchor } from './model'

// ── canvas node ─────────────────────────────────────────────────────────────

function CoreNodeCard({ data }: NodeProps) {
  const d = data as CoreNodeData
  const isFolder = d.className === 'Folder'
  return (
    <div
      className={cn(
        'relative w-[200px] overflow-hidden rounded-md border bg-card transition-[border-color,box-shadow]',
        d.selected
          ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_16%,transparent)]'
          : 'hover:border-muted-foreground/40',
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: moduleTint(d.hue).mark }}
      />
      {!d.virtual && (
        <NodeCommentPin
          anchorRef={nodeAnchor(d.path)}
          kind="section"
          excerpt={`${d.title} (${d.className})`}
        />
      )}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span style={{ color: moduleTint(d.hue).mark }} className="shrink-0">
            {d.icon ? (
              <SchemaIcon svg={d.icon} className="h-5 w-5" />
            ) : isFolder ? (
              <FolderClosed className="h-5 w-5" />
            ) : (
              <Box className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-tight">{d.title}</div>
            <div className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
              {d.className}
            </div>
          </div>
        </div>
        {d.fields.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {d.fields.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1 text-[10px] leading-tight">
                <span className="shrink-0 font-mono text-muted-foreground">{k}</span>
                <span className="truncate text-foreground/80">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

const nodeTypes = { coreNode: CoreNodeCard }

// ── canvas ──────────────────────────────────────────────────────────────────

export function CoreView({
  core,
  bundle,
  selectedPath,
  onSelect,
}: {
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const { setViewport } = useReactFlow()
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const panZoomReady = useStore((state) => state.panZoom !== null)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const hues = useMemo(() => hueMapOf(core), [core])
  const structure = useMemo(() => buildCoreGraph(core, bundle, hues), [core, bundle, hues])

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  const [laidOut, setLaidOut] = useState(0)
  useEffect(() => {
    let cancelled = false
    elkLayout(structure.nodes, structure.edges).then((laid) => {
      if (cancelled) return
      setNodes(laid)
      setEdges(structure.edges)
      setLaidOut((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [structure])

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const fitDone = useRef(0)
  useEffect(() => {
    if (laidOut === 0 || laidOut === fitDone.current || !panZoomReady) return
    const viewport = viewportForNodes(nodesRef.current, paneWidth, paneHeight)
    if (!viewport) return
    fitDone.current = laidOut
    setViewport(viewport)
  }, [laidOut, paneWidth, paneHeight, panZoomReady, setViewport])

  const onNodesChange = useCallback(
    (c: NodeChange[]) => setNodes((nds) => applyNodeChanges(c, nds)),
    [],
  )
  const onEdgesChange = useCallback(
    (c: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(c, eds)),
    [],
  )

  // the structural tree (folders + parent→child elbows) and the typed (semantic)
  // edges toggle independently, so either layer can be isolated.
  const [showStructure, setShowStructure] = useState(true)
  const [showSemantics, setShowSemantics] = useState(true)

  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => {
        const data = node.data as CoreNodeData
        if (!showStructure && data.className === 'Folder') return false
        if (!showSemantics && data.virtual) return false
        return true
      }),
    [nodes, showSemantics, showStructure],
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])

  // inject the selection flag without re-running layout
  const displayNodes = useMemo(
    () =>
      visibleNodes.map((n) => {
        const sel = (n.data as CoreNodeData).path === selectedPath
        return (n.data as CoreNodeData).selected === sel
          ? n
          : { ...n, data: { ...n.data, selected: sel } }
      }),
    [visibleNodes, selectedPath],
  )
  const displayEdges = useMemo(
    () =>
      edges.filter((e) => {
        if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false
        return e.type === 'tree' ? showStructure : showSemantics
      }),
    [edges, visibleIds, showStructure, showSemantics],
  )
  const routedEdges = useMemo(
    () => assignFloatingEdgePorts(displayNodes, displayEdges),
    [displayNodes, displayEdges],
  )

  return (
    <SmartEdgeProvider nodes={displayNodes} options={SMART_EDGE_PROVIDER_OPTIONS}>
      <ReactFlow
        onPointerDownCapture={dismissMenusOnCanvasPress}
        nodes={displayNodes}
        edges={routedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => {
          const data = n.data as CoreNodeData
          if (!data.virtual) onSelect(data.path)
        }}
        onPaneClick={() => {
          onSelect(null)
          if (!hasAnyUnsentDraft()) setOpenAnchor(null)
        }}
        minZoom={0.15}
        nodesConnectable={false}
        // React Flow derives an edge's z-index from its endpoints, and a SELECTED node is
        // lifted to 1000 — which dragged that node's edges over the label layer and struck
        // every one of their labels through. Our nodes never overlap, so the lift buys
        // nothing and edges stay below the labels they belong to.
        elevateNodesOnSelect={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-input)" />
        <EdgeMarkerDefs />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          style={{ width: 168, height: 112 }}
          nodeColor={(n) => moduleTint((n.data as CoreNodeData).hue).mark}
          nodeStrokeWidth={0}
        />
        <Panel position="top-right">
          <CanvasToolbar>
            <CanvasIconToggle
              icon={<FolderTree />}
              label="Structure"
              hint="folders and the parent→child tree"
              pressed={showStructure}
              onClick={() => setShowStructure((v) => !v)}
            />
            <CanvasIconToggle
              icon={<Spline />}
              label="Semantics"
              hint="typed edges between core nodes"
              pressed={showSemantics}
              onClick={() => setShowSemantics((v) => !v)}
            />
          </CanvasToolbar>
        </Panel>
      </ReactFlow>
    </SmartEdgeProvider>
  )
}
