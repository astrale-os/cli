import type { Comment } from '@shared/types'

/** Comment indicators represent work that is still active, not resolved history. */
export function openCommentThreads(comments: readonly Comment[] | undefined): Comment[] {
  return (comments ?? []).filter((comment) => comment.status === 'open')
}
