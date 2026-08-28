import type { AnchorKind } from '@shared/types'

import { MessageSquare } from 'lucide-react'
import { useId } from 'react'

import { useAnchorThreads } from '@/components/anchor'
import { hasUnsentDraft } from '@/components/thread'
import { ThreadPopover } from '@/components/thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * A persistent comment pin shown on a canvas node that has open threads; click → opens
 * the thread. Shared by the schema graph and the core (genesis) view so both file
 * comments through the same global `openAnchorRef` single-open machinery.
 */
export function NodeCommentPin({
  domainId,
  anchorRef,
  kind,
  excerpt,
  className,
}: {
  domainId?: string
  anchorRef: string
  kind: AnchorKind
  excerpt: string
  className?: string
}) {
  const { threads, openThreads, orphaned } = useAnchorThreads(anchorRef, domainId)
  const myId = useId()
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const openKey = domainId ? `${domainId}::${anchorRef}` : anchorRef
  const open = openRef === openKey && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
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
          title="View comments"
          onClick={(e) => {
            e.stopPropagation()
            setOpenAnchor(open ? null : openKey, myId)
          }}
          className={cn(
            'nodrag nopan absolute -right-1.5 -top-1.5 z-30 flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-semibold ring-2 ring-card',
            orphaned
              ? 'bg-destructive text-white hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
            className,
          )}
        >
          <MessageSquare className="h-2.5 w-2.5" />
          {openThreads.length}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        className="w-80"
        onInteractOutside={(event) => {
          if (hasUnsentDraft(anchorRef, threads)) event.preventDefault()
        }}
      >
        <ThreadPopover
          domainId={domainId}
          anchor={{ ref: anchorRef, kind }}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
