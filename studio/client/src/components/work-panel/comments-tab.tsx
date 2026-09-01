import type { Comment } from '@shared/types'

import { MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { Chip, EmptyState } from '@/components/studio-kit'
import { ThreadView } from '@/components/thread'
import { anchorLabel, openCommentThreads } from '@/lib/comments'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The comments half of the work panel. A thread is a note pinned somewhere in the
 * domain, so the list is also a way to navigate: opening one takes the main view
 * to what it points at and highlights it.
 */
export function CommentsTab({ domainId }: { domainId: string }) {
  const { data: store, isLoading } = useComments(domainId)
  const [openId, setOpenId] = useState<string | null>(null)
  const revealAnchor = useUI((state) => state.revealAnchor)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading comments…
      </div>
    )
  }

  const comments = openCommentThreads(store?.comments)
  const reveal = (comment: Comment) => {
    const next = openId === comment.id ? null : comment.id
    setOpenId(next)
    const ref = comment.anchorRefs[0]?.ref
    if (next && ref) revealAnchor(ref)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No open threads"
            hint="Press C, then click anything to pin a note."
          />
        ) : (
          <div className="divide-y">
            {comments.map((c) => (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => reveal(c)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent',
                    openId === c.id && 'bg-accent',
                  )}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {(c.thread.at(-1)?.text ?? c.thread[0]?.text ?? '').trim() || 'Empty thread'}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="truncate text-[11px] text-muted-foreground">
                        {anchorLabel(c.anchorRefs[0]?.ref ?? '')}
                      </span>
                      {c.orphaned && <Chip tone="danger">orphaned</Chip>}
                      {c.thread.at(-1)?.role === 'author' && <Chip tone="primary">agent</Chip>}
                    </span>
                  </span>
                </button>
                {openId === c.id && (
                  <div className="px-3 pb-3 pt-1">
                    <ThreadView domainId={domainId} comment={c} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
