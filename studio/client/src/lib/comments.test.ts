import type { Comment, ThreadRole } from '@shared/types'

import { expect, test } from 'bun:test'

import { openCommentThreads, threadsAwaitingAgent } from './comments'

function comment(id: string, status: Comment['status'], lastRole?: ThreadRole): Comment {
  return {
    id,
    anchors: [],
    anchorRefs: [],
    status,
    thread: lastRole ? [{ id: `${id}-1`, role: lastRole, type: 'text', text: 'hello' }] : [],
    createdAt: '2026-08-28T00:00:00.000Z',
    kind: 'comment',
  }
}

test('comment indicators only count open threads', () => {
  const comments = [comment('open', 'open'), comment('resolved', 'closed')]

  expect(openCommentThreads(comments).map(({ id }) => id)).toEqual(['open'])
  expect(openCommentThreads([comment('resolved', 'closed')])).toEqual([])
})

test('a thread the agent already answered is waiting on the user, not on the agent', () => {
  const comments = [
    comment('asked', 'open', 'user'),
    comment('answered', 'open', 'author'),
    comment('resolved', 'closed', 'user'),
  ]

  expect(threadsAwaitingAgent(comments).map(({ id }) => id)).toEqual(['asked'])
})
