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
import { Box, Group, Spline } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { hasAnyUnsentDraft } from '@/lib/comment-drafts'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { CanvasIconToggle, CanvasToolbar } from '../canvas-toolbar'
import { dismissMenusOnCanvasPress } from '../dismiss'
import { EdgeMarkerDefs } from '../edge-markers'
import { assignFloatingEdgePorts, SMART_EDGE_PROVIDER_OPTIONS } from '../edge-routing'
import { elkLayout } from '../elk-layout'
import { viewportForNodes } from '../fit'
import { type EdgeFocus, edgeTypes } from '../floating-edge'
import { neighborSet } from '../graph/structure'
import { NodeCommentPin } from '../node-comment-pin'
import { DOCK_CLEARANCE, moduleTint } from '../palette'
import { SchemaIcon } from '../schema-icon'
import { clusterByClass } from './cluster'
import {
  type CoreGraphOptions,
  type CoreNodeData,
  type CoreSpotlight,
  type SpotlightTone,
  buildCoreGraph,
  hueMapOf,
  nodeAnchor,
} from './model'

// ── canvas node ─────────────────────────────────────────────────────────────

const MARK_TONE: Record<SpotlightTone, string> = {
  focus: 'bg-primary/15 text-primary',
  pass: 'bg-success/15 text-success',
  fail: 'bg-destructive/15 text-destructive',
}

function CoreNodeCard({ data }: NodeProps) {
  const d = data as CoreNodeData
  const tint = moduleTint(d.hue)
  return (
    <div
      className={cn(
        'relative w-[200px] overflow-hidden rounded-md border bg-card transition-[border-color,box-shadow]',
        d.selected
          ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_16%,transparent)]'
          : 'hover:border-muted-foreground/40',
      )}
      // the spotlight rings a lifted card in its own hue (see focus.css)
      style={{ '--node-tint': tint.mark } as CSSProperties}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tint.mark }} />
      {!d.virtual && d.commentable !== false && (
        <NodeCommentPin
          domainId={d.domainId}
          anchorRef={nodeAnchor(d.path)}
          kind="section"
          excerpt={`${d.title} (${d.className})`}
        />
      )}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span style={{ color: tint.mark }} className="shrink-0">
            {d.icon ? <SchemaIcon svg={d.icon} className="h-5 w-5" /> : <Box className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight">{d.title}</div>
            <div className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
              {d.className}
            </div>
          </div>
          {d.mark && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider',
                MARK_TONE[d.tone ?? 'focus'],
              )}
            >
              {d.mark}
            </span>
          )}
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

const LIT_STROKE: Record<SpotlightTone, string | undefined> = {
  focus: undefined,
  pass: 'var(--color-success)',
  fail: 'var(--color-destructive)',
}

/** Two readings of the same cards: laid along their edges, or gathered by class. */
export type CoreLayout = 'flow' | 'class'

// ── canvas ──────────────────────────────────────────────────────────────────

export function CoreView({
  domainId,
  core,
  bundle,
  selectedPath,
  onSelect,
  spotlight,
  onEdgeClick,
  compact = false,
  commentable = true,
}: {
  domainId: string
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
  onSelect: (path: string | null) => void
  /**
   * What to lift and fade. Absent, a selected card lifts its own neighbourhood; given, it
   * wins — a policy's proof outranks a click.
   */
  spotlight?: CoreSpotlight | null
  /** A typed edge was clicked, by its `StudioCore.edges` index. Absent, it unselects. */
  onEdgeClick?: (index: number) => void
  /** cards show their name and class only */
  compact?: boolean
  /** cards and the detail can take comments (genesis data can, demo data cannot) */
  commentable?: boolean
}) {
  const { setViewport } = useReactFlow()
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const panZoomReady = useStore((state) => state.panZoom !== null)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const panelSide = useUI((s) => s.panelSide)
  const hues = useMemo(() => hueMapOf(core), [core])
  const graphOptions = useMemo<CoreGraphOptions>(
    () => ({ compact, commentable }),
    [compact, commentable],
  )
  const structure = useMemo(
    () => buildCoreGraph(core, bundle, hues, domainId, graphOptions),
    [core, bundle, hues, domainId, graphOptions],
  )

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  // The automatic layout follows the edges; the other reading gathers the cards by class.
  // Switching either way starts from the structure again, so a hand-moved card is reset.
  const [layout, setLayout] = useState<CoreLayout>('flow')
  const [laidOut, setLaidOut] = useState(0)
  useEffect(() => {
    let cancelled = false
    const apply = (laid: Node[]) => {
      if (cancelled) return
      setNodes(laid)
      setEdges(structure.edges)
      setLaidOut((n) => n + 1)
    }
    if (layout === 'class') apply(clusterByClass(structure.nodes))
    else elkLayout(structure.nodes, structure.edges).then(apply)
    return () => {
      cancelled = true
    }
  }, [structure, layout])

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

  // Typed edges can be hidden to read the cards alone — a selected card still shows its own,
  // and so does a card being moved, until the next click says what to look at instead.
  const [showSemantics, setShowSemantics] = useState(true)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const visibleNodes = useMemo(
    () => (showSemantics ? nodes : nodes.filter((node) => !(node.data as CoreNodeData).virtual)),
    [nodes, showSemantics],
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])

  // ── focus + context ──
  // A policy's spotlight comes from outside; otherwise the selected card, when it is drawn,
  // lifts what it is wired to and fades the rest.
  const focusNodeId = selectedPath ? nodeAnchor(selectedPath) : null
  const sets = useMemo<CoreSpotlight | null>(() => {
    if (spotlight) return spotlight
    if (!focusNodeId || !visibleIds.has(focusNodeId)) return null
    return { ...neighborSet(focusNodeId, edges), tone: 'focus' }
  }, [spotlight, focusNodeId, visibleIds, edges])

  // inject selection + spotlight without re-running layout
  const displayNodes = useMemo(
    () =>
      visibleNodes.map((n) => {
        const data = n.data as CoreNodeData
        const selected = data.path === selectedPath
        const lit = !sets || sets.nodeIds.has(n.id)
        const mark = sets?.marks?.get(n.id)
        const tone = sets?.tone
        const className =
          cn(
            !lit && 'is-dimmed',
            lit && sets && tone === 'focus' && n.id !== focusNodeId && 'is-related',
            lit && tone === 'pass' && 'is-pass',
            lit && tone === 'fail' && 'is-fail',
          ) || undefined
        if (
          data.selected === selected &&
          data.mark === mark &&
          data.tone === tone &&
          n.className === className
        ) {
          return n
        }
        return { ...n, className, data: { ...data, selected, mark, tone } }
      }),
    [visibleNodes, selectedPath, sets, focusNodeId],
  )
  const displayEdges = useMemo(
    () =>
      edges
        .filter((e) => {
          if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false
          // semantics off: only what the selection, a proof or the moved card reaches is drawn
          return (
            showSemantics ||
            sets?.edgeIds.has(e.id) === true ||
            (draggedId !== null && (e.source === draggedId || e.target === draggedId))
          )
        })
        .map((e) => {
          if (!sets) return e
          const lit = sets.edgeIds.has(e.id)
          const focus: EdgeFocus = lit ? 'on' : 'dim'
          // labels render in React Flow's own portal, so the focus state rides in `data`
          const data = { ...e.data, focus }
          if (!lit) return { ...e, className: 'is-dimmed', data }
          const stroke = LIT_STROKE[sets.tone]
          return {
            ...e,
            className: undefined,
            data,
            style: { ...e.style, ...(stroke ? { stroke } : {}), strokeWidth: 2.6 },
            markerEnd:
              stroke && typeof e.markerEnd === 'object'
                ? { ...e.markerEnd, color: stroke }
                : e.markerEnd,
          }
        }),
    [edges, visibleIds, showSemantics, sets, draggedId],
  )
  const routedEdges = useMemo(
    () => assignFloatingEdgePorts(displayNodes, displayEdges),
    [displayNodes, displayEdges],
  )

  // the floating dock sits over the bottom of the view: keep the controls above it
  const lift = panelSide === 'bottom' ? { bottom: DOCK_CLEARANCE } : undefined

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
          // a virtual node stands for something outside this core and has no detail to
          // show — clicking it is clicking elsewhere, so it unselects like the pane does
          setDraggedId(null)
          const data = n.data as CoreNodeData
          onSelect(data.virtual ? null : data.path)
        }}
        onNodeDragStart={(_, n) => setDraggedId(n.id)}
        onPaneClick={() => {
          setDraggedId(null)
          onSelect(null)
          if (!hasAnyUnsentDraft()) setOpenAnchor(null)
        }}
        // a typed edge is something a policy can protect; anything else is pressing elsewhere
        onEdgeClick={(_, e) => {
          setDraggedId(null)
          const index = (e.data as { index?: unknown } | undefined)?.index
          if (onEdgeClick && typeof index === 'number') onEdgeClick(index)
          else onSelect(null)
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
        <Controls showInteractive={false} position="bottom-left" style={lift} />
        <MiniMap
          pannable
          zoomable
          style={{ width: 168, height: 112, ...lift }}
          nodeColor={(n) => moduleTint((n.data as CoreNodeData).hue).mark}
          nodeStrokeWidth={0}
        />
        <Panel position="top-right">
          <CanvasToolbar>
            <CanvasIconToggle
              icon={<Group />}
              label="By class"
              hint="gather the cards by class; off returns to the layout along the edges"
              pressed={layout === 'class'}
              onClick={() => setLayout((current) => (current === 'class' ? 'flow' : 'class'))}
            />
            <CanvasIconToggle
              icon={<Spline />}
              label="Semantics"
              hint="typed edges between cards — a selected card always shows its own"
              pressed={showSemantics}
              onClick={() => setShowSemantics((v) => !v)}
            />
          </CanvasToolbar>
        </Panel>
      </ReactFlow>
    </SmartEdgeProvider>
  )
}
