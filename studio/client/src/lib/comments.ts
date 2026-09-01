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
