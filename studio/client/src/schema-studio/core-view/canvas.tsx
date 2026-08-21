import type { StudioCore, StudioSchemaBundle } from '@shared/types'

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
} from '@xyflow/react'
import { Box, Boxes, FolderClosed, FolderTree, Network, Spline } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { elkLayout } from '../elk-layout'
import { edgeTypes, separateParallelEdges } from '../floating-edge'
import { NodeCommentPin } from '../node-comment-pin'
import { SchemaIcon } from '../schema-icon'
import { type CoreNodeData, buildCoreGraph, hueMapOf, nodeAnchor } from './model'

// ── the toggle (mounted on both the schema canvas and the core canvas) ──────

/** Switch the schema canvas between the schema graph and the core (genesis) view.
 *  `count` (core element total: nodes + edges) renders a badge mirroring the
 *  Domains/Views/Integrations buttons — shown only in the "Core" state. */
export function CoreModeToggle({ count }: { count?: number }) {
  const mode = useUI((s) => s.canvasMode)
  const setMode = useUI((s) => s.setCanvasMode)
  const core = mode === 'core'
  return (
    <Button
      size="xs"
      variant={core ? 'default' : 'outline'}
      onClick={() => setMode(core ? 'schema' : 'core')}
      aria-pressed={core}
      title={core ? 'Back to the schema graph' : 'Show core (genesis) data'}
    >
      {core ? <Network className="h-3.5 w-3.5" /> : <Boxes className="h-3.5 w-3.5" />}
      {core ? 'Schema' : 'Core'}
      {!core && count !== undefined && (
        <span className="rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Button>
  )
}

// ── canvas node ─────────────────────────────────────────────────────────────

function CoreNodeCard({ data }: NodeProps) {
  const d = data as CoreNodeData
  const isFolder = d.className === 'Folder'
  return (
    <div
      className={cn(
        'relative rounded-lg border bg-card shadow-sm w-[184px] transition-shadow',
        d.selected ? 'ring-2 ring-primary' : 'hover:shadow-md',
      )}
      style={{ borderLeft: `3px solid oklch(0.72 0.15 ${d.hue})` }}
    >
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
          <span style={{ color: `oklch(0.82 0.14 ${d.hue})` }} className="shrink-0">
            {d.icon ? (
              <SchemaIcon svg={d.icon} className="h-5 w-5" />
            ) : isFolder ? (
              <FolderClosed className="h-5 w-5" />
            ) : (
              <Box className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold truncate leading-tight">{d.title}</div>
            <div className="text-[10px] font-mono text-muted-foreground/70 truncate leading-tight">
              {d.className}
            </div>
          </div>
        </div>
        {d.fields.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {d.fields.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1 text-[10px] leading-tight">
                <span className="font-mono text-muted-foreground/60 shrink-0">{k}</span>
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
  const { fitView } = useReactFlow()
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const hues = useMemo(() => hueMapOf(core), [core])
  const structure = useMemo(() => buildCoreGraph(core, bundle, hues), [core, bundle, hues])

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  useEffect(() => {
    let cancelled = false
    elkLayout(structure.nodes, structure.edges).then((laid) => {
      if (cancelled) return
      setNodes(laid)
      setEdges(separateParallelEdges(structure.edges))
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }))
    })
    return () => {
      cancelled = true
    }
  }, [structure, fitView])

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

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
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
        setOpenAnchor(null)
      }}
      minZoom={0.15}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={18} size={1} color="oklch(0.3 0.01 270)" />
      <Controls
        className="!bg-card !border !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!fill-foreground"
        showInteractive={false}
      />
      <MiniMap
        pannable
        zoomable
        className="!bg-card !border !border-border"
        nodeColor={(n) => `oklch(0.6 0.13 ${(n.data as CoreNodeData).hue})`}
        nodeStrokeWidth={0}
        maskColor="oklch(0.17 0.01 270 / 0.7)"
      />
      <Panel position="top-right" className="flex gap-1.5">
        <Button
          size="xs"
          variant={showStructure ? 'default' : 'outline'}
          onClick={() => setShowStructure((v) => !v)}
          aria-pressed={showStructure}
          title="Folders & the parent→child tree — toggle to focus on the semantic graph alone"
        >
          <FolderTree className="h-3.5 w-3.5" /> Structure
        </Button>
        <Button
          size="xs"
          variant={showSemantics ? 'default' : 'outline'}
          onClick={() => setShowSemantics((v) => !v)}
          aria-pressed={showSemantics}
          title="Typed (semantic) edges — toggle to focus on the tree/organization alone"
        >
          <Spline className="h-3.5 w-3.5" /> Semantics
        </Button>
        <CoreModeToggle />
      </Panel>
    </ReactFlow>
  )
}
