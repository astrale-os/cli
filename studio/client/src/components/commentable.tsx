import type { AnchorRef } from '@shared/types'

import { MessageSquarePlus } from 'lucide-react'
import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { AnchorThreadsContent, useAnchorPopover, useAnchorThreads } from './anchor'
import { CommentPin } from './comment-pin'
import { Popover, PopoverAnchor } from './ui/popover'

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
  domainId,
}: {
  anchor: AnchorRef
  excerpt: string
  children: ReactNode
  className?: string
  domainId: string
}) {
  const popover = useAnchorPopover(domainId, anchor.ref)
  const { openThreads, orphaned } = useAnchorThreads(anchor.ref, domainId)

  return (
    <Popover modal={false} open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverAnchor asChild>
        <span
          data-anchor-ref={anchor.ref}
          data-domain-id={domainId}
          data-commentable=""
          className={cn('group relative block', className)}
        >
          {children}

          {/* hover-revealed comment chip (top-right) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              popover.toggle()
            }}
            title={`Comment on ${anchor.ref}`}
            className={cn(
              'absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-primary',
              popover.open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
            )}
          >
            <MessageSquarePlus className="h-3 w-3" />
          </button>

          {/* persistent pin while threads remain open */}
          {openThreads.length > 0 && (
            <CommentPin
              count={openThreads.length}
              status="open"
              orphaned={orphaned}
              onClick={popover.toggle}
              className="absolute -right-1.5 -top-1.5 z-10"
            />
          )}
        </span>
      </PopoverAnchor>

      <AnchorThreadsContent
        domainId={domainId}
        anchor={anchor}
        excerpt={excerpt}
        threads={openThreads}
        onClose={popover.close}
      />
    </Popover>
  )
}
