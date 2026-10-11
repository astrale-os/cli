import type { Comment } from '@shared/types'

import { anchorKey } from './targets'

/** Comment indicators represent work that is still active, not resolved history. */
export function openCommentThreads(comments: readonly Comment[] | undefined): Comment[] {
  return (comments ?? []).filter((comment) => comment.status === 'open')
}

/**
 * The open threads the agent still owes an answer for — the ones its next turn will
 * pick up. A thread whose last word is already the agent's is waiting on the USER,
 * so it does not count. Mirrors the server's `awaitingThreads` (agent/run/preparation.ts),
 * which decides what a turn actually carries.
 */
export function threadsAwaitingAgent(comments: readonly Comment[] | undefined): Comment[] {
  return openCommentThreads(comments).filter((comment) => comment.thread.at(-1)?.role !== 'author')
}

/** A thread's anchor said in a few words: `Class · Invoice`, `View · overview`. */
export function anchorLabel(ref: string): string {
  if (ref === 'section.schema') return 'Schema canvas'
  if (ref.startsWith('view.')) return `View · ${ref.slice('view.'.length)}`
  if (ref.startsWith('module.')) return `Module · ${ref.slice('module.'.length)}`
  if (ref.startsWith('class.')) return `Class · ${ref.slice('class.'.length)}`
  if (ref.startsWith('edge.')) return `Edge · ${ref.slice('edge.'.length)}`
  if (ref.startsWith('section.')) return ref.slice('section.'.length).replace(/\./g, ' · ')
  return ref
}

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
