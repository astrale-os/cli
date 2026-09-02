import type { AnchorRef } from '@shared/types'

import { MessageSquarePlus } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { hasUnsentDraft } from '@/lib/comment-drafts'
import { useUI } from '@/lib/store'
import { anchorKey } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { useAnchorThreads } from './anchor'
import { CommentPin } from './comment-pin'
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
  domainId,
}: {
  anchor: AnchorRef
  excerpt: string
  children: ReactNode
  className?: string
  domainId: string
}) {
  const myId = useId()
  const ownerDomainId = domainId
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const openKey = anchorKey(ownerDomainId, anchor.ref)
  const open = openRef === openKey && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const { openThreads, orphaned } = useAnchorThreads(anchor.ref, ownerDomainId)

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(o) => setOpenAnchor(o ? openKey : null, o ? myId : null)}
    >
      <PopoverAnchor asChild>
        <span
          data-anchor-ref={anchor.ref}
          data-domain-id={ownerDomainId}
          data-commentable=""
          className={cn('group relative block', className)}
        >
          {children}

          {/* hover-revealed comment chip (top-right) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpenAnchor(open ? null : openKey, myId)
            }}
            title={`Comment on ${anchor.ref}`}
            className={cn(
              'absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-primary',
              open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
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
              onClick={() => setOpenAnchor(open ? null : openKey, myId)}
              className="absolute -right-1.5 -top-1.5 z-10"
            />
          )}
        </span>
      </PopoverAnchor>

      <PopoverContent
        // an outside click closes the popover — unless a reply is half-written, in
        // which case the header's × is the deliberate way out
        onInteractOutside={(event) => {
          if (hasUnsentDraft(ownerDomainId, anchor.ref, openThreads)) event.preventDefault()
        }}
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <ThreadPopover
          domainId={ownerDomainId}
          anchor={anchor}
          excerpt={excerpt}
          threads={openThreads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
