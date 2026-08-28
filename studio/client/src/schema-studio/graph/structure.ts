import type {
  AnchorRef,
  Comment,
  DomainCatalogEntry,
  NodePosition,
  StudioSchemaBundle,
} from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import { openCommentThreads } from '@/lib/comments'

import { edgeMarkers, formatCardinality } from '../edge-markers'
import {
  type CrossDomainEdge,
  type ExternalDomain,
  externalMemberNodeId,
  localEndpointTargets,
} from '../external'
import { moduleOfClass } from '../modules'
import { type Hidden, edgeVisible } from '../visibility'

export interface CanvasCommentNodeData extends Record<string, unknown> {
  comments: Comment[]
  anchor: AnchorRef
  excerpt: string
}

// ── layout: a rectangle around THIS domain's internal nodes; imported domains sit outside it ──
export function buildExternalLayout(
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
  const MEMBER_H = 44
  const MEMBER_GAP = 8
  const extX = rx + rw + 96
  const extNodes: Node[] = []
  let y = ry + 24
  for (const d of domains) {
    const entry = byOrigin.get(d.origin)
    const boxH = HEADER + d.members.length * (MEMBER_H + MEMBER_GAP) + 8
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
        id: externalMemberNodeId(d.origin, member.name),
        type: 'extMember',
        parentId: gid,
        extent: 'parent',
        draggable: false,
        position: { x: 12, y: HEADER + j * (MEMBER_H + MEMBER_GAP) },
        data: { name: member.name, kind: d.kind },
        style: { width: 192, height: MEMBER_H },
      })
    })
    y += boxH + 40
  }
  return { extNodes }
}

/** The internal rectangle, derived LIVE from the current module positions so it auto-resizes on drag. */
export function deriveRegion(nodes: Node[], label: string): Node | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    // internal module boxes (classes are their children) + the view pills that hang
    // off them — both belong to THIS domain, so the rectangle has to hold them.
    if (!n.id.startsWith('grp-') && n.type !== 'viewNode') continue
    const w = (n.style?.width as number) ?? 200
    const h = (n.style?.height as number) ?? 120
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  if (!Number.isFinite(minX)) return null
  const PAD = 56
  const width = maxX - minX + 2 * PAD
  const height = maxY - minY + 2 * PAD
  return {
    id: 'region',
    type: 'internalRegion',
    position: { x: minX - PAD, y: minY - PAD },
    draggable: false,
    selectable: false,
    zIndex: -1,
    data: { label },
    style: { width, height },
    // This node is DERIVED (never in `nodes` state), so its measurement can never
    // round-trip through onNodesChange. Declaring it keeps React Flow's
    // `nodesInitialized` true — the flag every queued fitView waits on.
    measured: { width, height },
  }
}

export function buildCrossEdges(
  cross: CrossDomainEdge[],
  visible: Set<string>,
  ids: Set<string>,
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
  showInheritedEdges: boolean,
): Edge[] {
  const ir = bundle.ir
  if (!ir) return []
  const out: Edge[] = []
  for (const e of cross) {
    if (!visible.has(e.origin)) continue
    const target = externalMemberNodeId(e.origin, e.to)
    if (!ids.has(target)) continue
    const localEndpoint = e.fromRef ? { types: [e.from], refs: [e.fromRef] } : { types: [e.from] }
    for (const local of localEndpointTargets(ir, localEndpoint)) {
      if (
        !edgeVisible(
          {
            edgeName: e.edge,
            aClass: local.className,
            bClass: '',
          },
          hidden,
          showInheritedEdges,
        )
      )
        continue
      const source = collapsed.has(moduleOfClass(bundle, local.className))
        ? `grp-${moduleOfClass(bundle, local.className)}`
        : `class.${local.className}`
      if (!ids.has(source)) continue
      const color = 'var(--edge-cross)'
      const markers = edgeMarkers()
      out.push({
        id: `edge-${e.edge}__${source}__${target}`,
        source,
        target,
        type: 'floating',
        data: {
          label: e.edge,
          edgeClass: e.edge,
          sourceEnd: { cardinality: formatCardinality(e.fromCard) },
          targetEnd: { cardinality: formatCardinality(e.toCard) },
        },
        markerStart: markers.markerStart,
        markerEnd: markers.markerEnd,
        style: {
          stroke: color,
          strokeWidth: 2,
        },
      })
    }
  }
  return out
}

function canvasPoint(a: AnchorRef | undefined): { x: number; y: number } | null {
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null
  return { x: a.x as number, y: a.y as number }
}

export function schemaCanvasCommentGroups(
  comments: Comment[] | undefined,
): { key: string; anchor: AnchorRef; comments: Comment[] }[] {
  const byKey = new Map<string, { key: string; anchor: AnchorRef; comments: Comment[] }>()
  for (const comment of openCommentThreads(comments)) {
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

export function schemaCanvasFallbackComments(comments: Comment[] | undefined): Comment[] {
  return openCommentThreads(comments).filter((comment) => {
    const anchor = comment.anchorRefs.find((a) => a.ref === 'section.schema')
    return !!anchor && !canvasPoint(anchor)
  })
}

export function commentNodes(
  groups: { key: string; anchor: AnchorRef; comments: Comment[] }[],
): Node[] {
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
      // derived like `region` — declare the size so it never blocks nodesInitialized
      measured: { width: 24, height: 24 },
      zIndex: 40,
    }
  })
}

export function neighborSet(activeId: string, edges: Edge[]) {
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

/** The exact two rendered endpoints of a clicked edge. Relationship classes can fan out into
 * several paths, so the physical edge id—not only its schema class—must drive this highlight. */
export function selectedRelationshipContext(edgeId: string | null, edges: Edge[]) {
  if (!edgeId) return null
  const edge = edges.find((candidate) => candidate.id === edgeId)
  if (!edge) return null
  return { edgeId: edge.id, nodeIds: new Set([edge.source, edge.target]) }
}
