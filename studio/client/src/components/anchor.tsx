import type { AnchorRef, Comment } from '@shared/types'

import { type ReactNode, useCallback, useId } from 'react'

import { hasUnsentDraft } from '@/lib/comment-drafts'
import { openCommentThreads } from '@/lib/comments'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorKey } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { CommentPin } from './comment-pin'
import { ThreadPopover } from './thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/** Open threads for an anchor, which are the only ones represented in the interface. */
export function useAnchorThreads(
  ref: string,
  ownerDomainId: string,
): {
  openThreads: Comment[]
  orphaned: boolean
} {
  const { data } = useComments(ownerDomainId)
  const threads = (data?.comments ?? []).filter((c) => c.anchorRefs.some((r) => r.ref === ref))
  const openThreads = openCommentThreads(threads)
  const orphaned = openThreads.some((c) => c.orphaned)
  return { openThreads, orphaned }
}

/**
 * Marks the element a revealed thread actually points at. Opening a comment on
 * `class.Order.property.total` opens Order — this is what then says which row was
 * meant: the element brings itself into view and wears the same outline comment mode
 * uses when it targets something, so "this is the element" always reads the same.
 * Spread on the surface itself where a wrapper would disturb the layout; otherwise
 * reach for `RevealedAnchor`.
 */
export function useRevealedAnchor(anchorRef: string) {
  const revealed = useUI((s) => s.revealedRef === anchorRef)
  // a callback ref, so a surface already on screen scrolls the moment it becomes the
  // revealed one — not only when it mounts with the panel
  const bringIntoView = useCallback(
    (node: HTMLElement | null) => {
      if (node && revealed) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [revealed],
  )
  return { ref: bringIntoView, 'data-revealed': revealed ? '' : undefined } as const
}

/** `useRevealedAnchor` as a wrapper, for list rows and cards that stack vertically. */
export function RevealedAnchor({
  anchorRef,
  children,
}: {
  anchorRef: string
  children: ReactNode
}) {
  const revealed = useRevealedAnchor(anchorRef)
  return <div {...revealed}>{children}</div>
}

/**
 * A view affordance for existing comments on an anchorable element: when the
 * anchor has open threads it shows a CommentPin that opens the ThreadPopover. There is
 * NO "add" button — starting a comment is done via comment mode (press C), which
 * resolves the element from its data-anchor-ref. Renders nothing when there are
 * no open threads. Resolved threads are omitted from the interface. Open state is
 * shared globally via store.openAnchorRef.
 */
export function AnchorButton({
  anchorRef,
  excerpt,
  className,
  domainId,
}: {
  anchorRef: AnchorRef
  excerpt: string
  className?: string
  domainId: string
}) {
  const myId = useId()
  const ownerDomainId = domainId
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const openKey = anchorKey(ownerDomainId, anchorRef.ref)
  const open = openRef === openKey && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const { openThreads, orphaned } = useAnchorThreads(anchorRef.ref, ownerDomainId)

  if (openThreads.length === 0) return null

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(o) => setOpenAnchor(o ? openKey : null, o ? myId : null)}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          data-anchor-ref={anchorRef.ref}
          data-domain-id={ownerDomainId}
          aria-label={`Comments on ${anchorRef.ref}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpenAnchor(open ? null : openKey, myId)
          }}
          className={cn('inline-flex shrink-0 align-middle', className)}
        >
          <CommentPin count={openThreads.length} status="open" orphaned={orphaned} />
        </button>
      </PopoverAnchor>

      <PopoverContent
        // an outside click closes the popover — unless a reply is half-written, in
        // which case the header's × is the deliberate way out
        onInteractOutside={(event) => {
          if (hasUnsentDraft(ownerDomainId, anchorRef.ref, openThreads)) event.preventDefault()
        }}
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <ThreadPopover
          domainId={ownerDomainId}
          anchor={anchorRef}
          excerpt={excerpt}
          threads={openThreads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
