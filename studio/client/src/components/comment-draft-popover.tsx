import { useUI } from '@/lib/store'

import { useAnchorThreads } from './anchor'
import { hasUnsentDraft } from './thread'
import { ThreadPopover } from './thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/**
 * The floating comment composer driven by comment mode. When `commentDraft` is set
 * (the user clicked a target while in comment mode) this opens a non-modal popover
 * anchored at the click point with the composer for that target. Ask mode does NOT
 * use this — it opens an ephemeral, persistent AskCard (see ask-popover.tsx) instead.
 */
export function CommentDraftPopover() {
  const draft = useUI((s) => s.commentDraft)
  const setCommentDraft = useUI((s) => s.setCommentDraft)
  const { threads } = useAnchorThreads(draft?.anchor.ref ?? '__none__', draft?.domainId)

  if (!draft) return null

  return (
    <Popover
      key={`${draft.anchor.ref}:${draft.x}:${draft.y}`}
      modal={false}
      open
      onOpenChange={(o) => {
        if (!o) setCommentDraft(null)
      }}
    >
      <PopoverAnchor asChild>
        <div
          aria-hidden
          className="pointer-events-none fixed"
          style={{ left: draft.x, top: draft.y, width: 1, height: 1 }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-80"
        // nothing typed yet → an outside click just dismisses it; once there IS a
        // draft, only the × (or submitting) closes it, so nothing is lost by accident
        onInteractOutside={(event) => {
          if (hasUnsentDraft(draft.anchor.ref, threads)) event.preventDefault()
        }}
      >
        <ThreadPopover
          domainId={draft.domainId}
          anchor={draft.anchor}
          excerpt={draft.excerpt}
          threads={threads}
          onClose={() => setCommentDraft(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
