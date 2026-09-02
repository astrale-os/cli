/**
 * structure.ts — the two layers the canvas draws over the graph itself.
 *
 * Comment pins: threads anchored to `section.schema`, grouped by where they were
 * dropped, plus the ones with no coordinates (they collect on the toolbar instead).
 * Focus: which nodes and edges a click reaches, so the rest can recede.
 */
import type { AnchorRef, Comment } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import { openCommentThreads } from '@/lib/comments'

export interface CanvasCommentNodeData extends Record<string, unknown> {
  comments: Comment[]
  anchor: AnchorRef
  excerpt: string
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

/** Every path a relationship class is drawn as, inside the domain that declares it. A class
 * can fan out into several — one per pair of endpoint classes it resolves to. */
export function relationshipEdgeIds(edges: Edge[], domainId: string, name: string): string[] {
  return edges
    .filter((edge) => edge.data?.edgeClass === name && edge.data?.ownerDomainId === domainId)
    .map((edge) => edge.id)
}

/**
 * The rendered paths a relationship selection lights up, and the cards they run between.
 *
 * Which paths those are depends on how the relationship was picked: clicking ONE line means
 * that line, while NAMING the relationship (⌘K, the rail, a comment's anchor) means every
 * line it is drawn as. Both arrive here as physical edge ids — the schema class alone could
 * not tell the two readings apart.
 */
export function selectedRelationshipContext(edgeIds: readonly string[], edges: Edge[]) {
  if (edgeIds.length === 0) return null
  const wanted = new Set(edgeIds)
  const found = new Set<string>()
  const nodeIds = new Set<string>()
  for (const edge of edges) {
    if (!wanted.has(edge.id)) continue
    found.add(edge.id)
    nodeIds.add(edge.source)
    nodeIds.add(edge.target)
  }
  return found.size > 0 ? { edgeIds: found, nodeIds } : null
}
