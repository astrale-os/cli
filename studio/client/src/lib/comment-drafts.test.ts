import { expect, test } from 'bun:test'

import { hasUnsentDraft, newCommentDraftKey, replyDraftKey, writeCommentDraft } from './comments'

test('new comment drafts are isolated by domain even when refs are identical', () => {
  const billingKey = newCommentDraftKey('billing', 'class.Invoice')
  writeCommentDraft(billingKey, 'Keep this thought')

  expect(hasUnsentDraft('billing', 'class.Invoice', [])).toBe(true)
  expect(hasUnsentDraft('archive', 'class.Invoice', [])).toBe(false)

  writeCommentDraft(billingKey, '')
})

test('reply drafts are isolated by their owning domain', () => {
  const billingKey = replyDraftKey('billing', 'comment-1')
  writeCommentDraft(billingKey, 'A reply')

  expect(hasUnsentDraft('billing', 'class.Invoice', [{ id: 'comment-1' }])).toBe(true)
  expect(hasUnsentDraft('archive', 'class.Invoice', [{ id: 'comment-1' }])).toBe(false)

  writeCommentDraft(billingKey, '')
})
