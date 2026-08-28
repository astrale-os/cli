import type { AnchorRef, Comment } from '@shared/types'
import type { Edge } from '@xyflow/react'

import { expect, test } from 'bun:test'

import {
  commentNodes,
  schemaCanvasCommentGroups,
  schemaCanvasFallbackComments,
  selectedRelationshipContext,
} from './structure'

function comment(id: string, anchor: AnchorRef, status: Comment['status'] = 'open'): Comment {
  return {
    id,
    anchors: ['Schema canvas'],
    anchorRefs: [anchor],
    status,
    thread: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    kind: 'comment',
  }
}

test('groups nearby pinned canvas comments and keeps unpinned comments in the fallback', () => {
  const comments = [
    comment('first', { ref: 'section.schema', kind: 'section', x: 96, y: 120 }),
    comment('second', { ref: 'section.schema', kind: 'section', x: 100, y: 124 }),
    comment('fallback', { ref: 'section.schema', kind: 'section' }),
    comment('other-section', { ref: 'section.comments', kind: 'section', x: 96, y: 120 }),
  ]

  const groups = schemaCanvasCommentGroups(comments)
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ key: '96:120' })
  expect(groups[0]?.comments.map(({ id }) => id)).toEqual(['first', 'second'])
  expect(commentNodes(groups)[0]).toMatchObject({
    id: 'canvas-comment.96:120',
    position: { x: 96, y: 120 },
  })
  expect(schemaCanvasFallbackComments(comments).map(({ id }) => id)).toEqual(['fallback'])
})

test('resolved canvas comments do not create indicators', () => {
  const pinned = comment(
    'resolved-pinned',
    { ref: 'section.schema', kind: 'section', x: 96, y: 120 },
    'closed',
  )
  const fallback = comment(
    'resolved-fallback',
    { ref: 'section.schema', kind: 'section' },
    'closed',
  )

  expect(schemaCanvasCommentGroups([pinned])).toEqual([])
  expect(schemaCanvasFallbackComments([fallback])).toEqual([])
})

test('a clicked physical edge promotes exactly its own two endpoints', () => {
  const edges: Edge[] = [
    { id: 'edge-member-a', source: 'class.Team', target: 'class.Alice' },
    { id: 'edge-member-b', source: 'class.Team', target: 'class.Bob' },
  ]

  const context = selectedRelationshipContext('edge-member-b', edges)
  expect(context?.edgeId).toBe('edge-member-b')
  expect([...context!.nodeIds]).toEqual(['class.Team', 'class.Bob'])
  expect(selectedRelationshipContext('missing', edges)).toBeNull()
})
