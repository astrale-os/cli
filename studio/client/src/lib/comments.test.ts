import type { Comment } from '@shared/types'

import { expect, test } from 'bun:test'

import { openCommentThreads } from './comments'

function comment(id: string, status: Comment['status']): Comment {
  return {
    id,
    anchors: [],
    anchorRefs: [],
    status,
    thread: [],
    createdAt: '2026-08-28T00:00:00.000Z',
    kind: 'comment',
  }
}

test('comment indicators only count open threads', () => {
  const comments = [comment('open', 'open'), comment('resolved', 'closed')]

  expect(openCommentThreads(comments).map(({ id }) => id)).toEqual(['open'])
  expect(openCommentThreads([comment('resolved', 'closed')])).toEqual([])
})
