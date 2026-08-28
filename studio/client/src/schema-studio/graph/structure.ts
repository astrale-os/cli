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

/** The exact two rendered endpoints of a clicked edge. Relationship classes can fan out into
 * several paths, so the physical edge id—not only its schema class—must drive this highlight. */
export function selectedRelationshipContext(edgeId: string | null, edges: Edge[]) {
  if (!edgeId) return null
  const edge = edges.find((candidate) => candidate.id === edgeId)
  if (!edge) return null
  return { edgeId: edge.id, nodeIds: new Set([edge.source, edge.target]) }
}
