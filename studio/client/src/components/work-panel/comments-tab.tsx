import type { Comment } from '@shared/types'

import { CheckCheck, MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { Chip, EmptyState } from '@/components/studio-kit'
import { ThreadView } from '@/components/thread'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

function anchorLabel(ref: string): string {
  if (ref === 'section.schema') return 'Schema canvas'
  if (ref.startsWith('view.')) return `View · ${ref.slice('view.'.length)}`
  if (ref.startsWith('module.')) return `Module · ${ref.slice('module.'.length)}`
  if (ref.startsWith('class.')) return `Class · ${ref.slice('class.'.length)}`
  if (ref.startsWith('edge.')) return `Edge · ${ref.slice('edge.'.length)}`
  if (ref.startsWith('section.')) return ref.slice('section.'.length).replace(/\./g, ' · ')
  return ref
}

/**
 * The comments half of the work panel. A thread is a note pinned somewhere in the
 * domain, so the list is also a way to navigate: opening one takes the main view
 * to what it points at and highlights it.
 */
export function CommentsTab({ domainId }: { domainId: string }) {
  const { data: store, isLoading } = useComments(domainId)
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const revealAnchor = useUI((state) => state.revealAnchor)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading comments…
      </div>
    )
  }

  const comments = store?.comments ?? []
  const open = comments.filter((c) => c.status === 'open')
  const closed = comments.filter((c) => c.status === 'closed')
  const shown = tab === 'open' ? open : closed
  const reveal = (comment: Comment) => {
    const next = openId === comment.id ? null : comment.id
    setOpenId(next)
    const ref = comment.anchorRefs[0]?.ref
    if (next && ref) revealAnchor(ref)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b px-2 py-1.5">
        <span className="mr-auto pl-1 text-[11px] text-muted-foreground">
          {shown.length} {tab === 'open' ? 'open' : 'resolved'}
        </span>
        <button
          type="button"
          aria-pressed={tab === 'closed'}
          title={
            tab === 'open'
              ? `Show resolved threads (${closed.length})`
              : `Show open threads (${open.length})`
          }
          onClick={() => setTab(tab === 'open' ? 'closed' : 'open')}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md transition-colors',
            tab === 'closed'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <CheckCheck className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title={tab === 'open' ? 'No open threads' : 'No resolved threads yet'}
            hint={tab === 'open' ? 'Press C, then click anything to pin a note.' : undefined}
          />
        ) : (
          <div className="divide-y">
            {shown.map((c) => (
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
