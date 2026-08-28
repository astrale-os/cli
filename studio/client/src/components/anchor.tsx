import type { AnchorRef, Comment } from '@shared/types'

import { useId } from 'react'

import { openCommentThreads } from '@/lib/comments'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { CommentPin } from './comment-pin'
import { hasUnsentDraft } from './thread'
import { ThreadPopover } from './thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/** All threads for an anchor plus the open subset represented by its indicator. */
export function useAnchorThreads(
  ref: string,
  ownerDomainId?: string,
): {
  threads: Comment[]
  openThreads: Comment[]
  orphaned: boolean
} {
  const activeDomainId = useUI((s) => s.domainId)
  const { data } = useComments(ownerDomainId ?? activeDomainId)
  const threads = (data?.comments ?? []).filter((c) => c.anchorRefs.some((r) => r.ref === ref))
  const openThreads = openCommentThreads(threads)
  const orphaned = openThreads.some((c) => c.orphaned)
  return { threads, openThreads, orphaned }
}

/**
 * A view affordance for existing comments on an anchorable element: when the
 * anchor has open threads it shows a CommentPin that opens the ThreadPopover. There is
 * NO "add" button — starting a comment is done via comment mode (press C), which
 * resolves the element from its data-anchor-ref. Renders nothing when there are
 * no open threads. Resolved history remains available in the comments panel. Open
 * state is shared globally via store.openAnchorRef.
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
  domainId?: string
}) {
  const myId = useId()
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const openKey = domainId ? `${domainId}::${anchorRef.ref}` : anchorRef.ref
  const open = openRef === openKey && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  const { threads, openThreads, orphaned } = useAnchorThreads(anchorRef.ref, domainId)

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
          data-domain-id={domainId}
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
          if (hasUnsentDraft(anchorRef.ref, threads)) event.preventDefault()
        }}
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <ThreadPopover
          domainId={domainId}
          anchor={anchorRef}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Legacy shim: the global composer dialog is gone; popovers are anchored now. */
export const CommentComposer = () => null
