import type { Comment } from '@shared/types'

import { Loader2, MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { Chip, EmptyState } from '@/components/studio-kit'
import { ThreadView } from '@/components/thread'
import { anchorLabel, openCommentThreads } from '@/lib/comments'
import { useWorkspaceComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useCanvasDomains } from '@/schema-studio/workspace/canvas-selection'

/**
 * The comments half of the work panel. A thread is a note pinned somewhere in the
 * domain, so the list is also a way to navigate: opening one takes the main view
 * to what it points at and highlights it.
 */
export function CommentsTab() {
  const { data: groups, isLoading, pending } = useWorkspaceComments({ foreground: true })
  const [openId, setOpenId] = useState<string | null>(null)
  const revealAnchor = useUI((state) => state.revealAnchor)
  const canvas = useCanvasDomains()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading comments…
      </div>
    )
  }

  const commentGroups = groups
    .map(({ domain, store }) => ({ domain, comments: openCommentThreads(store?.comments) }))
    .filter((group) => group.comments.length > 0)
  const commentCount = commentGroups.reduce((total, group) => total + group.comments.length, 0)
  const waitingFor = groups.filter((group) => group.loading).map((group) => group.domain.origin)
  const reveal = (domainId: string, comment: Comment) => {
    const key = `${domainId}:${comment.id}`
    const next = openId === key ? null : key
    setOpenId(next)
    const ref = comment.anchorRefs[0]?.ref
    if (next && ref) {
      if (!canvas.visible.has(domainId)) canvas.toggleOnCanvas(domainId)
      revealAnchor(ref, domainId)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {commentCount === 0 && pending > 0 ? (
          <div
            role="status"
            className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading comments…</span>
            <span className="max-w-full truncate text-[11px]" title={waitingFor.join(', ')}>
              {waitingFor.slice(0, 3).join(', ')}
              {waitingFor.length > 3 ? ` and ${waitingFor.length - 3} more` : ''}
            </span>
          </div>
        ) : commentCount === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No open threads"
            hint="Press C, then choose a domain element to pin a note."
          />
        ) : (
          <div>
            {commentGroups.map(({ domain, comments }) => (
              <section
                key={domain.id}
                data-testid={`comments-domain-${domain.id}`}
                className="border-b last:border-b-0"
              >
                <header className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur-sm">
                  <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold text-muted-foreground">
                    {domain.origin}
                  </h3>
                  <span
                    aria-label={`${comments.length} open thread${comments.length === 1 ? '' : 's'}`}
                    className="grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
                  >
                    {comments.length}
                  </span>
                </header>
                <div className="divide-y">
                  {comments.map((comment) => {
                    const key = `${domain.id}:${comment.id}`
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => reveal(domain.id, comment)}
                          className={cn(
                            'flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent',
                            openId === key && 'bg-accent',
                          )}
                        >
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px]">
                              {(
                                comment.thread.at(-1)?.text ??
                                comment.thread[0]?.text ??
                                ''
                              ).trim() || 'Empty thread'}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5">
                              <span className="truncate text-[11px] text-muted-foreground">
                                {anchorLabel(comment.anchorRefs[0]?.ref ?? '')}
                              </span>
                              {comment.orphaned && <Chip tone="danger">orphaned</Chip>}
                              {comment.thread.at(-1)?.role === 'author' && (
                                <Chip tone="primary">agent</Chip>
                              )}
                            </span>
                          </span>
                        </button>
                        {openId === key && (
                          <div className="px-3 pb-3 pt-1">
                            <ThreadView domainId={domain.id} comment={comment} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
            {pending > 0 && (
              <div
                role="status"
                className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin" /> Checking {pending} more domain
                {pending === 1 ? '' : 's'}…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
