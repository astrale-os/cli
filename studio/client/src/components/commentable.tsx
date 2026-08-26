import type { AnchorRef } from '@shared/types'

import { MessageSquarePlus } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { useAnchorThreads } from './anchor'
import { CommentPin } from './comment-pin'
import { hasUnsentDraft } from './thread'
import { ThreadPopover } from './thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/**
 * Wraps ANY element (card, row, section…) to make it commentable. Shows a
 * hover comment chip in the top-right corner and a CommentPin when the anchor
 * already has threads, both opening the same non-modal popover. Open state is
 * shared globally via store.openAnchorRef.
 */
export function Commentable({
  anchor,
  excerpt,
  children,
  className,
}: {
  anchor: AnchorRef
  excerpt: string
  children: ReactNode
  className?: string
}) {
  const myId = useId()
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const open = openRef === anchor.ref && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const { threads, status, orphaned } = useAnchorThreads(anchor.ref)

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(o) => setOpenAnchor(o ? anchor.ref : null, o ? myId : null)}
    >
      <PopoverAnchor asChild>
        <span
          data-anchor-ref={anchor.ref}
          data-commentable=""
          className={cn('group relative block', className)}
        >
          {children}

          {/* hover-revealed comment chip (top-right) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpenAnchor(open ? null : anchor.ref, myId)
            }}
            title={`Comment on ${anchor.ref}`}
            className={cn(
              'absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-primary',
              open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
            )}
          >
            <MessageSquarePlus className="h-3 w-3" />
          </button>

          {/* persistent pin when threads exist */}
          {threads.length > 0 && (
            <CommentPin
              count={threads.length}
              status={status}
              orphaned={orphaned}
              onClick={() => setOpenAnchor(open ? null : anchor.ref, myId)}
              className="absolute -right-1.5 -top-1.5 z-10"
            />
          )}
        </span>
      </PopoverAnchor>

      <PopoverContent
        // an outside click closes the popover — unless a reply is half-written, in
        // which case the header's × is the deliberate way out
        onInteractOutside={(event) => {
          if (hasUnsentDraft(anchor.ref, threads)) event.preventDefault()
        }}
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <ThreadPopover
          anchor={anchor}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
