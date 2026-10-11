import type { Comment, ThreadRole } from '@shared/types'

import { expect, test } from 'bun:test'

import {
  hasUnsentDraft,
  newCommentDraftKey,
  replyDraftKey,
  threadsAwaitingAgent,
  writeCommentDraft,
} from './comments'

function comment(id: string, status: Comment['status'], lastRole: ThreadRole): Comment {
  return {
    id,
    anchors: [],
    anchorRefs: [],
    status,
    thread: [{ id: `${id}-1`, role: lastRole, type: 'text', text: 'hello' }],
    createdAt: '2026-08-28T00:00:00.000Z',
    kind: 'comment',
  }
}

test('only open threads whose last word is the user’s are waiting on the agent', () => {
  const comments = [
    comment('asked', 'open', 'user'),
    comment('answered', 'open', 'author'),
    comment('resolved', 'closed', 'user'),
  ]
  expect(threadsAwaitingAgent(comments).map(({ id }) => id)).toEqual(['asked'])
})

test('an unsent comment or reply draft belongs to its own domain, even under the same ref', () => {
  for (const [key, thread] of [
    [newCommentDraftKey('billing', 'class.Invoice'), []],
    [replyDraftKey('billing', 'comment-1'), [{ id: 'comment-1' }]],
  ] as const) {
    writeCommentDraft(key, 'Keep this thought')
    expect(hasUnsentDraft('billing', 'class.Invoice', [...thread])).toBe(true)
    expect(hasUnsentDraft('archive', 'class.Invoice', [...thread])).toBe(false)
    writeCommentDraft(key, '')
  }
})
