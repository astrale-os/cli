import type { Comment } from '@shared/types'

import { anchorKey } from './targets'

/**
 * Unsent text deliberately survives a popover closing, but remains client-only.
 * Keys include the owning domain so identical schema refs and comment ids cannot
 * interfere across workspace frames.
 */
const drafts = new Map<string, string>()

export function newCommentDraftKey(domainId: string, ref: string): string {
  return `new::${anchorKey(domainId, ref)}`
}

export function replyDraftKey(domainId: string, commentId: string): string {
  return `reply::${anchorKey(domainId, commentId)}`
}

export function readCommentDraft(key: string): string {
  return drafts.get(key) ?? ''
}

export function writeCommentDraft(key: string, value: string): void {
  if (value) drafts.set(key, value)
  else drafts.delete(key)
}

export function clearCommentDraft(key: string): void {
  drafts.delete(key)
}

export function hasAnyUnsentDraft(): boolean {
  for (const value of drafts.values()) if (value.trim()) return true
  return false
}

/** Is there unsent text in this domain-qualified composer or one of its replies? */
export function hasUnsentDraft(
  domainId: string,
  anchorRef: string,
  threads: Pick<Comment, 'id'>[],
): boolean {
  if (readCommentDraft(newCommentDraftKey(domainId, anchorRef)).trim()) return true
  return threads.some((thread) => readCommentDraft(replyDraftKey(domainId, thread.id)).trim())
}
