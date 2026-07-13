import type { StudioCore, StudioCoreNode, StudioSchemaBundle } from '@shared/types'

/**
 * core-view.tsx — the "Core" canvas mode. Renders a domain's genesis (`defineCore`)
 * node/edge graph: the left panel is a path-hierarchy tree, the canvas a ReactFlow
 * visualization (one card per genesis node, structural parent→child links + the
 * typed core edges), and the right panel a read-only detail of the selected node.
 * Read-only + commentable — the studio's "comment to request a change" model.
 */
import {
  Background,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
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
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderTree,
  Network,
  Spline,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Commentable } from '@/components/commentable'
import { Button } from '@/components/ui/button'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { elkLayout } from './elk-layout'
import { edgeTypes, separateParallelEdges } from './floating-edge'
import { moduleHue } from './modules'
import { NodeCommentPin } from './node-comment-pin'
import { SchemaIcon } from './schema-icon'

// ── shared helpers ─────────────────────────────────────────────────────────

const nodeAnchor = (path: string) => `core.node.${path}`
const lastSeg = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** A node's human label: its `name`/`title` field, else the last path segment. */
function displayName(n: { path: string; data: Record<string, unknown> }): string {
  const v = n.data.name ?? n.data.title
  return typeof v === 'string' && v ? v : lastSeg(n.path)
}

/** Stable hue per className (so a class is the same colour across the canvas + tree). */
function hueMapOf(core: StudioCore): Map<string, number> {
  const names = [...new Set(core.nodes.map((n) => n.className))].sort()
  return new Map(names.map((name, i) => [name, moduleHue(i)]))
}

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(fmtVal).join(', ')
  return JSON.stringify(v)
}

/** Up to `max` data fields for a compact card preview, skipping the title field. */
function previewFields(
  n: { path: string; data: Record<string, unknown> },
  max = 2,
): [string, string][] {
  const title = displayName(n)
  return Object.entries(n.data)
    .filter(([, v]) => fmtVal(v) !== title)
    .slice(0, max)
    .map(([k, v]) => [k, fmtVal(v)] as [string, string])
}

function classIcon(bundle: StudioSchemaBundle, className: string): string | undefined {
  return bundle.ir?.classes?.[className]?.icon
}

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

interface CoreNodeData extends Record<string, unknown> {
  path: string
  className: string
  title: string
  hue: number
  icon?: string
  fields: [string, string][]
  selected: boolean
}

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
      <NodeCommentPin
        anchorRef={nodeAnchor(d.path)}
        kind="section"
        excerpt={`${d.title} (${d.className})`}
      />
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

// ── structure (nodes + edges, pre-layout) ───────────────────────────────────

function buildCoreGraph(
  core: StudioCore,
  bundle: StudioSchemaBundle,
  hues: Map<string, number>,
): { nodes: Node[]; edges: Edge[] } {
  const ids = new Set(core.nodes.map((n) => nodeAnchor(n.path)))
  const nodes: Node[] = core.nodes.map((n) => {
    const fields = previewFields(n)
    return {
      id: nodeAnchor(n.path),
      type: 'coreNode',
      position: { x: 0, y: 0 },
      data: {
        path: n.path,
        className: n.className,
        title: displayName(n),
        hue: hues.get(n.className) ?? 264,
        icon: classIcon(bundle, n.className),
        fields,
        selected: false,
      } satisfies CoreNodeData,
      style: { width: 184, height: 50 + fields.length * 15 },
    }
  })

  const edges: Edge[] = []
  // structural parent → child (subtle dashed) so the hierarchy reads on the canvas
  for (const n of core.nodes) {
    if (!n.parent) continue
    const source = nodeAnchor(n.parent)
    const target = nodeAnchor(n.path)
    if (!ids.has(source) || !ids.has(target)) continue
    edges.push({
      id: `core.struct.${n.path}`,
      source,
      target,
      type: 'tree',
      data: { structural: true },
      style: { stroke: 'oklch(0.5 0.02 264)', strokeWidth: 1.4, strokeDasharray: '4 4' },
    })
  }
  // typed core edges (solid, coloured, labelled) — the genesis wiring
  for (const e of core.edges) {
    const source = nodeAnchor(e.from)
    const target = nodeAnchor(e.to)
    if (!ids.has(source) || !ids.has(target)) continue
    const color = 'oklch(0.72 0.16 35)'
    edges.push({
      id: `core.edge.${e.from}__${e.edgeName}__${e.to}`,
      source,
      target,
      type: 'floating',
      data: { label: e.edgeName },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: 2 },
    })
  }
  return { nodes, edges }
}

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
      showStructure ? nodes : nodes.filter((n) => (n.data as CoreNodeData).className !== 'Folder'),
    [nodes, showStructure],
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
      onNodeClick={(_, n) => onSelect((n.data as CoreNodeData).path)}
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

// ── left panel: the path-hierarchy tree ─────────────────────────────────────

interface CoreTreeNode {
  node: StudioCoreNode
  children: CoreTreeNode[]
}

function buildCoreTree(core: StudioCore): CoreTreeNode[] {
  const paths = new Set(core.nodes.map((n) => n.path))
  const byParent = new Map<string, StudioCoreNode[]>()
  const roots: StudioCoreNode[] = []
  for (const n of core.nodes) {
    if (n.parent && paths.has(n.parent)) {
      const arr = byParent.get(n.parent) ?? []
      arr.push(n)
      byParent.set(n.parent, arr)
    } else {
      roots.push(n)
    }
  }
  const build = (n: StudioCoreNode): CoreTreeNode => ({
    node: n,
    children: (byParent.get(n.path) ?? []).map(build),
  })
  return roots.map(build)
}

function CoreRow({
  item,
  depth,
  bundle,
  hues,
  selectedPath,
  onSelect,
}: {
  item: CoreTreeNode
  depth: number
  bundle: StudioSchemaBundle
  hues: Map<string, number>
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  const n = item.node
  const hasKids = item.children.length > 0
  const active = selectedPath === n.path
  const hue = hues.get(n.className) ?? 264
  const icon = classIcon(bundle, n.className)
  const isFolder = n.className === 'Folder'
  return (
    <div>
      <div
        className={cn(
          'group/row flex items-center gap-0.5 pr-2 rounded-md hover:bg-accent/50',
          active && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-white/5"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Commentable
          anchor={{ ref: nodeAnchor(n.path), kind: 'section' }}
          excerpt={`${displayName(n)} (${n.className})`}
          className="flex-1 min-w-0"
        >
          <button
            type="button"
            onClick={() => onSelect(n.path)}
            className="flex w-full items-center gap-1.5 py-1 text-left min-w-0"
          >
            <span style={{ color: `oklch(0.8 0.13 ${hue})` }} className="shrink-0">
              {icon ? (
                <SchemaIcon svg={icon} className="h-4 w-4" />
              ) : isFolder ? (
                <FolderClosed className="h-3.5 w-3.5" />
              ) : (
                <Box className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="truncate font-bold">{displayName(n)}</span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/50 shrink-0">
              {n.className}
            </span>
          </button>
        </Commentable>
      </div>
      {open && hasKids && (
        <div>
          {item.children.map((c) => (
            <CoreRow
              key={c.node.path}
              item={c}
              depth={depth + 1}
              bundle={bundle}
              hues={hues}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CoreTree({
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
  const hues = useMemo(() => hueMapOf(core), [core])
  const tree = useMemo(() => buildCoreTree(core), [core])

  return (
    <div className="text-sm py-2">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" /> Core
        <span className="ml-auto tabular-nums text-muted-foreground/50">{core.nodes.length}</span>
      </div>
      {tree.length === 0 ? (
        <p className="px-3 pt-2 text-[12px] text-muted-foreground/60">
          {core.error ? core.error.message : 'This domain defines no core (genesis) data.'}
        </p>
      ) : (
        tree.map((c) => (
          <CoreRow
            key={c.node.path}
            item={c}
            depth={0}
            bundle={bundle}
            hues={hues}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}

// ── right panel: the selected node's detail ─────────────────────────────────

export function CoreDetail({
  core,
  bundle,
  selectedPath,
}: {
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
}) {
  const node = useMemo(
    () => core.nodes.find((n) => n.path === selectedPath) ?? null,
    [core, selectedPath],
  )
  const hues = useMemo(() => hueMapOf(core), [core])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground/70">
        Select a core node to see what's set on it.
      </div>
    )
  }

  const hue = hues.get(node.className) ?? 264
  const icon = classIcon(bundle, node.className)
  const isFolder = node.className === 'Folder'
  const entries = Object.entries(node.data)
  const relatedEdges = core.edges.filter((e) => e.from === node.path || e.to === node.path)

  return (
    <div className="h-full overflow-y-auto">
      <Commentable
        anchor={{ ref: nodeAnchor(node.path), kind: 'section' }}
        excerpt={`${displayName(node)} (${node.className})`}
        className="block"
      >
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <span style={{ color: `oklch(0.82 0.14 ${hue})` }} className="shrink-0">
            {icon ? (
              <SchemaIcon svg={icon} className="h-7 w-7" />
            ) : isFolder ? (
              <FolderClosed className="h-6 w-6" />
            ) : (
              <Box className="h-6 w-6" />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-base font-extrabold truncate">{displayName(node)}</div>
            <div className="text-[11px] font-mono text-muted-foreground/70">{node.className}</div>
          </div>
        </div>
      </Commentable>

      <div className="px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Path
        </div>
        <div className="mt-1 break-all font-mono text-[11px] text-foreground/80">{node.path}</div>
      </div>

      <div className="px-4 pb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Data
        </div>
        {entries.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-foreground/60">No fields set.</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {entries.map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col gap-0.5 rounded-md border bg-card/40 px-2.5 py-1.5"
              >
                <span className="font-mono text-[11px] text-muted-foreground/70">{k}</span>
                <span className="break-words text-[13px] text-foreground/90">{fmtVal(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {relatedEdges.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Edges
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {relatedEdges.map((e, i) => {
              const outgoing = e.from === node.path
              const other = outgoing ? e.to : e.from
              return (
                <div key={`${e.edgeName}-${i}`} className="flex items-center gap-1.5 text-[12px]">
                  <Spline className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="font-mono text-amber-300">{e.edgeName}</span>
                  <span className="text-muted-foreground/60">{outgoing ? '→' : '←'}</span>
                  <span className="truncate text-foreground/80" title={other}>
                    {lastSeg(other)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
