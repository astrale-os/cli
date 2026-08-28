import { expect, test } from 'bun:test'

import {
  clearCommentDraft,
  hasUnsentDraft,
  newCommentDraftKey,
  replyDraftKey,
  writeCommentDraft,
} from './comment-drafts'

test('new comment drafts are isolated by domain even when refs are identical', () => {
  const billingKey = newCommentDraftKey('billing', 'class.Invoice')
  writeCommentDraft(billingKey, 'Keep this thought')

  expect(hasUnsentDraft('billing', 'class.Invoice', [])).toBe(true)
  expect(hasUnsentDraft('archive', 'class.Invoice', [])).toBe(false)

  clearCommentDraft(billingKey)
})

test('reply drafts are isolated by their owning domain', () => {
  const billingKey = replyDraftKey('billing', 'comment-1')
  writeCommentDraft(billingKey, 'A reply')

  expect(hasUnsentDraft('billing', 'class.Invoice', [{ id: 'comment-1' }])).toBe(true)
  expect(hasUnsentDraft('archive', 'class.Invoice', [{ id: 'comment-1' }])).toBe(false)

  clearCommentDraft(billingKey)
})
