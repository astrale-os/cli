import type { Comment } from '@shared/types'

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
