import type {
  AnchorRef,
  Comment,
  DomainCatalogEntry,
  IrInterface,
  LayoutState,
  NodePosition,
  StudioSchemaBundle,
} from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import {
  Background,
  ControlButton,
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
  useStore,
} from '@xyflow/react'
import {
  AppWindow,
  Box,
  ChevronDown,
  ChevronRight,
  Globe,
  LayoutGrid,
  MessageSquare,
  Plug,
  Shapes,
  UserRound,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ThreadPopover } from '@/components/thread-popover'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { api, qk } from '@/lib/api'
import { useAnatomy, useCatalog, useComments, useCore, useViewsModel } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import './focus.css'
import { CoreModeToggle } from './core-view'
import { elkLayout } from './elk-layout'
import { type ExternalDomain, crossDomainEdges, externalDomains } from './external'
import { edgeTypes } from './floating-edge'
import { type FileModule, domainInterfacesOf, fileModules, moduleOfClass } from './modules'
import { NodeCommentPin } from './node-comment-pin'
import { SchemaIcon } from './schema-icon'

type SchemaCoreRole = 'container' | 'identity' | 'function'

interface ClassNodeData extends Record<string, unknown> {
  name: string
  props: number
  methods: number
  interfaces: string[]
  coreRole?: SchemaCoreRole | null
  hue: number
  icon?: string
}
interface GroupNodeData extends Record<string, unknown> {
  label: string
  path: string
  hue: number
  interfaces: string[]
  collapsed: boolean
  classCount: number
}
interface CanvasCommentNodeData extends Record<string, unknown> {
  comments: Comment[]
  anchor: AnchorRef
  excerpt: string
}

// ── custom nodes ──

function ClassNode({ id, data }: NodeProps) {
  const d = data as ClassNodeData
  const selectClass = useUI((s) => s.selectClass)
  const selected = useUI((s) => s.selectedClass === `class.${d.name}`)
  // semantic zoom (level-of-detail): collapse to a title chip when zoomed out
  const zoom = useStore((s) => s.transform[2])
  const compact = zoom < 0.5
  const coreRoleClass = d.coreRole
    ? (
        {
          container: 'schema-core-container',
          identity: 'schema-core-identity',
          function: 'schema-core-function',
        } satisfies Record<SchemaCoreRole, string>
      )[d.coreRole]
    : undefined
  return (
    <div
      data-core-role={d.coreRole ?? undefined}
      className={cn(
        'relative rounded-lg border bg-card shadow-sm w-[160px] transition-shadow',
        coreRoleClass,
        selected ? 'ring-2 ring-primary' : 'hover:shadow-md',
      )}
      style={{ borderLeft: `3px solid oklch(0.72 0.15 ${d.hue})` }}
    >
      {d.coreRole === 'identity' && (
        <span title="Identity" className="schema-core-identity-icon">
          <UserRound className="h-3 w-3" />
        </span>
      )}
      <NodeCommentPin
        anchorRef={`class.${d.name}`}
        kind="schema"
        excerpt={d.name}
        className={d.coreRole === 'identity' ? 'top-6' : undefined}
      />
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          {d.coreRole === 'function' ? (
            <span className="shrink-0 schema-core-function-icon">
              <Zap className="h-5 w-5" />
            </span>
          ) : d.icon ? (
            <span style={{ color: `oklch(0.82 0.14 ${d.hue})` }} className="shrink-0">
              <SchemaIcon svg={d.icon} className="h-6 w-6" />
            </span>
          ) : (
            <span
              className="h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ background: `oklch(0.7 0.15 ${d.hue})` }}
            />
          )}
          <span className="text-sm font-extrabold truncate">{d.name}</span>
        </div>
        {!compact && d.interfaces.length > 0 && (
          <div className="rf-meta mt-1.5">
            {d.interfaces.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {d.interfaces.map((i) => (
                  <button
                    key={i}
                    type="button"
                    title={`interface ${i}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectClass(`interface.${i}`)
                    }}
                    className="inline-flex items-center gap-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 px-1 py-0.5 text-[9px] font-mono hover:bg-fuchsia-500/25"
                  >
                    <Shapes className="h-2.5 w-2.5" />
                    {i}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData
  const selectClass = useUI((s) => s.selectClass)
  const toggleModule = useUI((s) => s.toggleModule)
  const selected = useUI((s) => s.selectedClass === `module.${d.path}`)
  return (
    <div
      className={cn(
        'relative w-full h-full rounded-xl border transition-shadow',
        selected ? 'ring-2 ring-primary' : d.collapsed && 'hover:shadow-md cursor-pointer',
      )}
      style={{
        borderColor: `oklch(0.55 0.1 ${d.hue} / 0.45)`,
        background: `oklch(0.5 0.12 ${d.hue} / ${d.collapsed ? 0.12 : 0.07})`,
      }}
    >
      <NodeCommentPin anchorRef={`module.${d.path}`} kind="section" excerpt={d.label} />
      {/* hidden handles so React Flow can anchor (rerouted) edges to a collapsed module box */}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <div
        className="flex items-center gap-1 px-1.5 py-1.5 text-[13px]"
        style={{ color: `oklch(0.85 0.12 ${d.hue})` }}
      >
        <button
          type="button"
          title={d.collapsed ? 'Show classes' : 'Hide classes'}
          onClick={(e) => {
            e.stopPropagation()
            toggleModule(d.path)
          }}
          className="rounded p-0.5 hover:bg-white/10 shrink-0"
        >
          {d.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="font-extrabold truncate">{d.label}</span>
        {d.collapsed ? (
          <span className="ml-auto text-[10px] opacity-60 shrink-0 pr-1">{d.classCount}</span>
        ) : (
          d.interfaces.map((i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectClass(`interface.${i}`)
              }}
              className="inline-flex items-center gap-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 px-1 py-0.5 text-[9px] hover:bg-fuchsia-500/25 shrink-0"
            >
              <Shapes className="h-2.5 w-2.5" />
              {i}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── external (cross-domain) nodes ──

function ExtDomainNode({ data }: NodeProps) {
  const d = data as { name: string; origin: string; kind: 'kernel' | 'external'; icon?: string }
  const hue = d.kind === 'kernel' ? 285 : 158
  return (
    <div
      className="w-full h-full rounded-xl border border-dashed"
      style={{
        borderColor: `oklch(0.6 0.1 ${hue} / 0.55)`,
        background: `oklch(0.5 0.1 ${hue} / 0.06)`,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{ color: `oklch(0.84 0.11 ${hue})` }}
      >
        <span className="shrink-0">
          {d.icon ? <SchemaIcon svg={d.icon} className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
        </span>
        <span className="text-[13px] font-extrabold truncate">{d.name}</span>
        <span className="ml-auto text-[9px] uppercase tracking-wider opacity-60 shrink-0">
          {d.kind}
        </span>
      </div>
    </div>
  )
}

function ExtMemberNode({ data }: NodeProps) {
  const d = data as { name: string; kind: 'kernel' | 'external'; definition: 'interface' | 'class' }
  const hue = d.kind === 'kernel' ? 285 : 158
  const Icon = d.definition === 'interface' ? Shapes : Box
  return (
    <div
      className="w-full h-full rounded-lg border bg-card flex items-center gap-1.5 px-2 shadow-sm"
      style={{ borderLeft: `3px solid oklch(0.72 0.14 ${hue})` }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Icon className="h-4 w-4 shrink-0" style={{ color: `oklch(0.78 0.13 ${hue})` }} />
      <span className="text-[12px] font-extrabold truncate">{d.name}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

/** The big rectangle delimiting THIS domain — everything inside belongs to it; imported domains sit outside. */
function InternalRegionNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div
      className="relative w-full h-full rounded-2xl border-2 border-dashed"
      style={{
        borderColor: 'oklch(0.62 0.04 264 / 0.38)',
        background: 'oklch(0.6 0.03 264 / 0.025)',
      }}
    >
      <span
        className="absolute -top-2.5 left-5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55 whitespace-nowrap"
        style={{ background: 'var(--color-canvas)' }}
      >
        {d.label}
      </span>
    </div>
  )
}

function CanvasCommentNode({ data }: NodeProps) {
  const d = data as CanvasCommentNodeData
  return (
    <CanvasCommentPin
      threads={d.comments}
      anchor={d.anchor}
      excerpt={d.excerpt}
      className="nodrag nopan"
    />
  )
}

const nodeTypes = {
  classNode: ClassNode,
  group: GroupNode,
  moduleNode: GroupNode,
  extDomain: ExtDomainNode,
  extMember: ExtMemberNode,
  internalRegion: InternalRegionNode,
  canvasComment: CanvasCommentNode,
}

function CanvasCommentPin({
  threads,
  anchor,
  excerpt,
  className,
}: {
  threads: Comment[]
  anchor: AnchorRef
  excerpt: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (threads.length === 0) return null
  const status = threads.some((c) => c.status === 'open') ? 'open' : 'resolved'
  const orphaned = threads.some((c) => c.orphaned)
  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          title="Schema canvas comments"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={cn(
            'flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-bold shadow-md ring-2 ring-card transition-colors hover:brightness-110',
            status === 'open'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
            orphaned && 'bg-destructive text-white',
            className,
          )}
        >
          <MessageSquare className="h-3 w-3" />
          {threads.length}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        className="w-80"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <ThreadPopover
          anchor={anchor}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

// ── layout: a rectangle around THIS domain's internal nodes; imported domains sit outside it ──
function buildExternalLayout(
  internal: Node[],
  domains: ExternalDomain[],
  catalog: DomainCatalogEntry[] | undefined,
  saved: Record<string, NodePosition> | undefined,
) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of internal) {
    if (n.parentId) continue
    const pos = saved?.[n.id] ?? n.position
    const w = (n.style?.width as number) ?? 200
    const h = (n.style?.height as number) ?? 120
    minX = Math.min(minX, pos.x)
    maxX = Math.max(maxX, pos.x + w)
    minY = Math.min(minY, pos.y)
    maxY = Math.max(maxY, pos.y + h)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 400
    maxY = 400
  }

  // imported domains: a column just OUTSIDE the internal bounding box, to its right
  // (the dashed internal rectangle itself is derived live from the modules, so it
  //  auto-resizes when you drag one — see `regionNode` in SchemaGraph)
  const PAD = 56
  const rx = minX - PAD
  const ry = minY - PAD
  const rw = maxX - minX + 2 * PAD
  const byOrigin = new Map((catalog ?? []).map((e) => [e.origin, e]))
  const HEADER = 36
  const IFACE_H = 44
  const IFACE_GAP = 8
  const extX = rx + rw + 96
  const extNodes: Node[] = []
  let y = ry + 24
  for (const d of domains) {
    const entry = byOrigin.get(d.origin)
    const boxH = HEADER + d.members.length * (IFACE_H + IFACE_GAP) + 8
    const gid = `extdom.${d.origin}`
    extNodes.push({
      id: gid,
      type: 'extDomain',
      position: saved?.[gid] ?? { x: extX, y },
      draggable: true,
      selectable: false,
      data: {
        name: entry?.name ?? d.origin.split('.')[0],
        origin: d.origin,
        kind: d.kind,
        icon: entry?.icon,
      },
      style: { width: 216, height: boxH },
    })
    d.members.forEach((member, j) => {
      extNodes.push({
        id: `extmember.${d.origin}.${member.name}`,
        type: 'extMember',
        parentId: gid,
        extent: 'parent',
        draggable: false,
        position: { x: 12, y: HEADER + j * (IFACE_H + IFACE_GAP) },
        data: { name: member.name, kind: d.kind, definition: member.definition },
        style: { width: 192, height: IFACE_H },
      })
    })
    y += boxH + 40
  }
  return { extNodes }
}

/** The internal rectangle, derived LIVE from the current module positions so it auto-resizes on drag. */
function deriveRegion(nodes: Node[], label: string): Node | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    if (!n.id.startsWith('grp-')) continue // internal module boxes only (classes are their children)
    const w = (n.style?.width as number) ?? 200
    const h = (n.style?.height as number) ?? 120
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  if (!Number.isFinite(minX)) return null
  const PAD = 56
  return {
    id: 'region',
    type: 'internalRegion',
    position: { x: minX - PAD, y: minY - PAD },
    draggable: false,
    selectable: false,
    zIndex: -1,
    data: { label },
    style: { width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD },
  }
}

// ── geometry: positions/sizes keyed by node id, owned by the user (persisted) ──
// `applyGeom` paints a stored position onto a structural node; `toGeom` snapshots
// laid-out nodes; `packPending` places ONLY new nodes without moving the rest.
type Geom = Record<string, NodePosition>

const NEW_H = 88
const NEW_GAP = 24

// only expanded module containers persist a size. Prefer the LIVE measured size
// (ReactFlow grows it via `expandParent` when a class is dragged to the edge) so we
// capture the grown box; fall back to the structural style for not-yet-mounted nodes.
function sizeOf(n: Node): { w?: number; h?: number } {
  if (n.type !== 'group') return {}
  const w =
    (typeof n.measured?.width === 'number' ? n.measured.width : undefined) ??
    (typeof n.style?.width === 'number' ? n.style.width : undefined)
  const h =
    (typeof n.measured?.height === 'number' ? n.measured.height : undefined) ??
    (typeof n.style?.height === 'number' ? n.style.height : undefined)
  return w != null && h != null ? { w: Math.round(w), h: Math.round(h) } : {}
}

function applyGeom(n: Node, g: Geom): Node {
  const p = g[n.id]
  if (!p) return n
  const next: Node = { ...n, position: { x: p.x, y: p.y } }
  if (n.type === 'group' && p.w != null && p.h != null)
    next.style = { ...n.style, width: p.w, height: p.h }
  return next
}

function toGeom(nodes: Node[]): Geom {
  const g: Geom = {}
  for (const n of nodes)
    g[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y), ...sizeOf(n) }
  return g
}

// place the newly-appeared nodes (agent added a class / module) without touching
// anything already placed: new roots go in a column to the right of the bounding
// box; new children stack inside their module box. Returns geometry for new ids only.
function packPending(placed: { n: Node; g: Geom[string] }[], pending: Node[]): Geom {
  let maxX = 0
  let minY = Number.POSITIVE_INFINITY
  const childY = new Map<string, number>() // parentId → next relative y for a new child
  for (const { n, g } of placed) {
    if (n.parentId) {
      const below = g.y + ((n.style?.height as number) ?? NEW_H) + NEW_GAP
      childY.set(n.parentId, Math.max(childY.get(n.parentId) ?? 34, below))
    } else {
      maxX = Math.max(maxX, g.x + ((n.style?.width as number) ?? 200))
      minY = Math.min(minY, g.y)
    }
  }
  if (!Number.isFinite(minY)) minY = 0
  const trayX = maxX + 96
  let trayY = minY
  const out: Geom = {}
  for (const n of pending) {
    if (n.parentId) {
      const y = childY.get(n.parentId) ?? 34
      out[n.id] = { x: 14, y }
      childY.set(n.parentId, y + NEW_H + NEW_GAP)
    } else {
      out[n.id] = { x: trayX, y: trayY, ...sizeOf(n) }
      trayY += ((n.style?.height as number) ?? 120) + NEW_GAP
    }
  }
  return out
}

function buildCrossEdges(
  cross: { edge: string; from: string; origin: string; to: string }[],
  visible: Set<string>,
  ids: Set<string>,
  bundle: StudioSchemaBundle,
): Edge[] {
  const out: Edge[] = []
  for (const e of cross) {
    if (!visible.has(e.origin)) continue
    const target = `extmember.${e.origin}.${e.to}`
    if (!ids.has(target)) continue
    const source = ids.has(`class.${e.from}`)
      ? `class.${e.from}`
      : `grp-${moduleOfClass(bundle, e.from)}`
    if (!ids.has(source)) continue
    const color = 'oklch(0.72 0.16 35)' // cross-domain (same accent as cross-module edges)
    // id `edge-<name>` so it selects the real edge class in the detail pane, like any edge
    out.push({
      id: `edge-${e.edge}`,
      source,
      target,
      type: 'floating',
      data: { label: e.edge },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: 2 },
    })
  }
  return out
}

function canvasPoint(a: AnchorRef | undefined): { x: number; y: number } | null {
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null
  return { x: a.x as number, y: a.y as number }
}

function schemaCanvasCommentGroups(
  comments: Comment[] | undefined,
): { key: string; anchor: AnchorRef; comments: Comment[] }[] {
  const byKey = new Map<string, { key: string; anchor: AnchorRef; comments: Comment[] }>()
  for (const comment of comments ?? []) {
    const anchor = comment.anchorRefs.find((a) => a.ref === 'section.schema')
    if (!anchor) continue
    const pt = canvasPoint(anchor)
    if (!pt) continue
    const key = `${Math.round(pt.x / 12) * 12}:${Math.round(pt.y / 12) * 12}`
    const group = byKey.get(key)
    if (group) group.comments.push(comment)
    else byKey.set(key, { key, anchor, comments: [comment] })
  }
  return [...byKey.values()]
}

function schemaCanvasFallbackComments(comments: Comment[] | undefined): Comment[] {
  return (comments ?? []).filter((comment) => {
    const anchor = comment.anchorRefs.find((a) => a.ref === 'section.schema')
    return !!anchor && !canvasPoint(anchor)
  })
}

function commentNodes(groups: { key: string; anchor: AnchorRef; comments: Comment[] }[]): Node[] {
  return groups.map((g) => {
    const pt = canvasPoint(g.anchor) ?? { x: 0, y: 0 }
    return {
      id: `canvas-comment.${g.key}`,
      type: 'canvasComment',
      position: { x: pt.x, y: pt.y },
      draggable: false,
      selectable: false,
      data: {
        comments: g.comments,
        anchor: g.anchor,
        excerpt: 'Schema canvas',
      } satisfies CanvasCommentNodeData,
      style: { width: 24, height: 24 },
      zIndex: 40,
    }
  })
}

// ── structure (nodes + edges, no positions — ELK assigns them) ──

function singleLabel(fm: FileModule): string {
  const segs = fm.path.split('/')
  return segs.length === 2 && segs[0] === segs[1] ? segs[0] : fm.path
}

function schemaRefName(ref: unknown): string {
  return (
    String(ref ?? '')
      .split(/[.:/]/)
      .pop() ?? ''
  )
}

function schemaRefList(refs: unknown): string[] {
  return Array.isArray(refs) ? refs.map(String) : refs ? [String(refs)] : []
}

function schemaInterfaceMap(bundle: StudioSchemaBundle): Record<string, IrInterface> {
  const out: Record<string, IrInterface> = {}
  for (const source of [bundle.importedInterfaces, bundle.ir?.interfaces]) {
    for (const [name, def] of Object.entries(source ?? {})) out[schemaRefName(name)] = def
  }
  return out
}

function schemaCoreRole(refs: unknown, bundle: StudioSchemaBundle): SchemaCoreRole | null {
  const interfaces = schemaInterfaceMap(bundle)
  const seen = new Set<string>()
  const stack = schemaRefList(refs).map(schemaRefName)
  while (stack.length) {
    const name = stack.pop()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const def = interfaces[name] as
      | (IrInterface & { implements?: string[]; interfaces?: string[] })
      | undefined
    for (const parent of [
      ...schemaRefList(def?.extends),
      ...schemaRefList(def?.implements),
      ...schemaRefList(def?.interfaces),
    ])
      stack.push(schemaRefName(parent))
  }
  if (seen.has('Function')) return 'function'
  if (seen.has('Identity')) return 'identity'
  if (seen.has('Container')) return 'container'
  return null
}

function buildStructure(
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const ir = bundle.ir
  if (!ir) return { nodes: [], edges: [] }

  const mods = fileModules(bundle).filter((m) => m.classes.length > 0)
  const nodes: Node[] = []

  for (const fm of mods) {
    const gid = `grp-${fm.path}`
    const isCollapsed = collapsed.has(fm.path)
    nodes.push({
      // a collapsed module is a LEAF node ('moduleNode') so edges attach to it like a
      // class; an expanded module is a 'group' container holding its class children.
      id: gid,
      type: isCollapsed ? 'moduleNode' : 'group',
      position: { x: 0, y: 0 },
      selectable: true,
      data: {
        label: singleLabel(fm),
        path: fm.path,
        hue: fm.hue,
        interfaces: fm.interfaces,
        collapsed: isCollapsed,
        classCount: fm.classes.length,
      } satisfies GroupNodeData,
      style: isCollapsed ? { width: 200, height: 44 } : { width: 200, height: 120 },
    })
    if (isCollapsed) continue
    for (const cn of fm.classes) {
      nodes.push({
        id: `class.${cn}`,
        type: 'classNode',
        parentId: gid,
        // a class stays inside its module box; dragging it to the edge GROWS the box
        // (expandParent) rather than letting it escape. The grown size is snapshotted on
        // drag stop (onNodeDragStop) so it survives recompose/remount — no rollback.
        extent: 'parent',
        expandParent: true,
        position: { x: 0, y: 0 },
        data: {
          name: cn,
          props: Object.keys(ir.classes[cn]?.properties ?? {}).length,
          methods: Object.keys(ir.classes[cn]?.methods ?? {}).length,
          interfaces: domainInterfacesOf(bundle, cn),
          coreRole: schemaCoreRole(ir.classes[cn]?.implements ?? [], bundle),
          hue: fm.hue,
          icon: ir.classes[cn]?.icon,
        } satisfies ClassNodeData,
      })
    }
  }

  // a class is represented by its own node, or — when its module is collapsed — by the module box
  const rep = (cls: string) => {
    const mp = moduleOfClass(bundle, cls)
    return collapsed.has(mp) ? `grp-${mp}` : `class.${cls}`
  }

  // resolve an endpoint's declared types into concrete node-class targets, expanding
  // unions (several listed types) and interfaces (→ every class that implements them)
  const targetsOf = (ep?: { types?: string[] }) => {
    const out: { cls: string; viaInterface: boolean }[] = []
    const seen = new Set<string>()
    for (const t of ep?.types ?? []) {
      if (ir.classes[t]?.type === 'node') {
        if (!seen.has(t)) {
          seen.add(t)
          out.push({ cls: t, viaInterface: false })
        }
      } else if (ir.interfaces[t]) {
        for (const [cn, c] of Object.entries(ir.classes)) {
          if (c.type === 'node' && (c.implements ?? []).includes(t) && !seen.has(cn)) {
            seen.add(cn)
            out.push({ cls: cn, viaInterface: true })
          }
        }
      }
    }
    return out
  }

  const edges: Edge[] = []
  for (const e of Object.values(ir.classes)) {
    if (e.type !== 'edge') continue
    const aTargets = targetsOf(e.endpoints?.[0])
    const bTargets = targetsOf(e.endpoints?.[1])
    for (const a of aTargets) {
      for (const b of bTargets) {
        const sa = rep(a.cls)
        const sb = rep(b.cls)
        if (sa === sb) continue // self-link, or both ends collapsed into the same module box
        const cross = moduleOfClass(bundle, a.cls) !== moduleOfClass(bundle, b.cls)
        const poly = a.viaInterface || b.viaInterface // resolved via interface ⇒ dashed
        const color = cross ? 'oklch(0.72 0.16 35)' : 'oklch(0.62 0.07 264)'
        edges.push({
          id: `edge-${e.name}__${a.cls}__${b.cls}`,
          source: sa,
          target: sb,
          type: 'floating',
          data: { label: e.name, edgeClass: e.name, polymorphic: poly },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
          style: {
            stroke: color,
            strokeWidth: cross ? 2.4 : 1.8,
            ...(poly ? { strokeDasharray: '7 4' } : {}),
          },
        })
      }
    }
  }
  return { nodes, edges }
}

function neighborSet(activeId: string, edges: Edge[]) {
  const nodeIds = new Set<string>([activeId])
  const edgeIds = new Set<string>()
  for (const e of edges) {
    if (e.source === activeId) {
      nodeIds.add(e.target)
      edgeIds.add(e.id)
    } else if (e.target === activeId) {
      nodeIds.add(e.source)
      edgeIds.add(e.id)
    }
  }
  return { nodeIds, edgeIds }
}

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
  const hiddenDomains = useUI((s) => s.hiddenDomains)
  const { data: catalog } = useCatalog()
  const { data: commentStore } = useComments(domainId)

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [hoverId, setHoverId] = useState<string | null>(null)

  const structure = useMemo(
    () => buildStructure(bundle, new Set(collapsedModules)),
    [bundle.schemaHash, bundle, collapsedModules],
  )
  const allExternal = useMemo(() => externalDomains(bundle), [bundle])
  const crossE = useMemo(() => crossDomainEdges(bundle), [bundle])
  const hiddenKey = hiddenDomains.join(',')

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

  // commit positions: update the cache immediately, flush to disk debounced.
  const dirty = useRef<Geom>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const upd = dirty.current
    dirty.current = {}
    if (Object.keys(upd).length) api.setLayout(domainId, upd).catch(() => {})
  }, [domainId])
  const commit = useCallback(
    (updates: Geom) => {
      qc.setQueryData<LayoutState>(qk.layout(domainId), (prev) => ({
        schemaHash: prev?.schemaHash,
        positions: { ...(prev?.positions ?? {}), ...updates },
      }))
      Object.assign(dirty.current, updates)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, 500)
    },
    [qc, domainId, flush],
  )
  // don't lose a just-dragged position when the canvas unmounts (switching to core view)
  useEffect(() => () => flush(), [flush])

  // paint a set of positions onto the structure and append the external area.
  const compose = useCallback(
    (g: Geom) => {
      const internal = structure.nodes.map((n) => applyGeom(n, g))
      const visibleDomains = allExternal.filter((d) => !hiddenDomains.includes(d.origin))
      const { extNodes } = buildExternalLayout(internal, visibleDomains, catalog, g)
      const all = [...internal, ...extNodes]
      const ids = new Set(all.map((n) => n.id))
      setNodes(all)
      setEdges([
        ...structure.edges,
        ...buildCrossEdges(crossE, new Set(visibleDomains.map((d) => d.origin)), ids, bundle),
      ])
    },
    [structure, allExternal, hiddenDomains, catalog, crossE, bundle],
  )
  const firstFit = useCallback(() => {
    if (fitted.current) return
    fitted.current = true
    requestAnimationFrame(() => fitView({ padding: 0.18, duration: 400 }))
  }, [fitView])

  // Read the cache NON-reactively in the reconciler. A drag's own `commit` updates the
  // cache; if the reconciler depended on that, every drag would rebuild all nodes and
  // fight the live drag (the rollback). So it keys off STRUCTURE only (file edits,
  // collapse, new domains) + a one-shot "layout loaded" flag — never off a position change.
  const savedRef = useRef(saved)
  savedRef.current = saved
  const layoutReady = saved != null

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
        const g = toGeom(laid)
        compose(g)
        commit(g)
        firstFit()
      })
      return () => {
        cancelled = true
      }
    }
    // incremental: place only the new nodes, leave everything else exactly put
    const added = packPending(
      placed.map((n) => ({ n, g: cur[n.id] })),
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
      const updates: Geom = {
        [node.id]: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          ...sizeOf(node),
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
    const g = toGeom(laid)
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
    () => deriveRegion(nodes, bundle.overlay.origin),
    [nodes, bundle.overlay.origin],
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
      nodeTypes={nodeTypes}
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
        <CoreModeToggle count={coreCount} />
      </Panel>
    </ReactFlow>
  )
}
