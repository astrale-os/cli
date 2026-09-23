import type { AnchorRef, Comment } from '@shared/types'

import { useCallback, useId, useMemo } from 'react'

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
  const comments = data?.comments
  return useMemo(() => {
    const openThreads = openCommentThreads(
      comments?.filter((c) => c.anchorRefs.some((r) => r.ref === ref)),
    )
    return { openThreads, orphaned: openThreads.some((c) => c.orphaned) }
  }, [comments, ref])
}

/**
 * The shared open state of one anchor's thread popover. Open state lives globally in
 * store.openAnchorRef; `openAnchorId` narrows it to the one surface that opened it
 * when the same anchor is drawn more than once.
 */
export function useAnchorPopover(ownerDomainId: string, ref: string) {
  const myId = useId()
  const openKey = anchorKey(ownerDomainId, ref)
  // one boolean per surface, so opening one anchor does not re-render every other one
  const open = useUI(
    (s) => s.openAnchorRef === openKey && (s.openAnchorId === null || s.openAnchorId === myId),
  )
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  return {
    open,
    onOpenChange: (o: boolean) => setOpenAnchor(o ? openKey : null, o ? myId : null),
    toggle: () => setOpenAnchor(open ? null : openKey, myId),
    close: () => setOpenAnchor(null),
  }
}

/** The popover body both anchor surfaces open: the anchor's threads and a composer. */
export function AnchorThreadsContent({
  domainId,
  anchor,
  excerpt,
  threads,
  onClose,
}: {
  domainId: string
  anchor: AnchorRef
  excerpt: string
  threads: Comment[]
  onClose: () => void
}) {
  return (
    <PopoverContent
      // an outside click closes the popover — unless a reply is half-written, in
      // which case the header's × is the deliberate way out
      onInteractOutside={(event) => {
        if (hasUnsentDraft(domainId, anchor.ref, threads)) event.preventDefault()
      }}
      className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
    >
      <ThreadPopover
        domainId={domainId}
        anchor={anchor}
        excerpt={excerpt}
        threads={threads}
        onClose={onClose}
      />
    </PopoverContent>
  )
}

/**
 * Marks the element a revealed thread actually points at. Opening a comment on
 * `class.Order.property.total` opens Order — this is what then says which row was
 * meant: the element brings itself into view and wears the same outline comment mode
 * uses when it targets something, so "this is the element" always reads the same.
 * Spread on the surface itself, where a wrapper would disturb the layout.
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
  const popover = useAnchorPopover(domainId, anchorRef.ref)
  const { openThreads, orphaned } = useAnchorThreads(anchorRef.ref, domainId)

  if (openThreads.length === 0) return null

  return (
    <Popover modal={false} open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-anchor-ref={anchorRef.ref}
          data-domain-id={domainId}
          aria-label={`Comments on ${anchorRef.ref}`}
          onClick={(e) => {
            e.stopPropagation()
            popover.toggle()
          }}
          className={cn('inline-flex shrink-0 align-middle', className)}
        >
          <CommentPin count={openThreads.length} status="open" orphaned={orphaned} />
        </button>
      </PopoverAnchor>

      <AnchorThreadsContent
        domainId={domainId}
        anchor={anchorRef}
        excerpt={excerpt}
        threads={openThreads}
        onClose={popover.close}
      />
    </Popover>
  )
}
