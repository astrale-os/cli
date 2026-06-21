import type { AnchorKind } from '@shared/types'

import { MessageSquare } from 'lucide-react'
import { useId } from 'react'

import { useAnchorThreads } from '@/components/anchor'
import { ThreadPopover } from '@/components/thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * A persistent comment pin shown on a canvas node that has threads; click → opens
 * the thread. Shared by the schema graph and the core (genesis) view so both file
 * comments through the same global `openAnchorRef` single-open machinery.
 */
export function NodeCommentPin({
  anchorRef,
  kind,
  excerpt,
  className,
}: {
  anchorRef: string
  kind: AnchorKind
  excerpt: string
  className?: string
}) {
  const { threads, status, orphaned } = useAnchorThreads(anchorRef)
  const myId = useId()
  const openRef = useUI((s) => s.openAnchorRef)
  const openId = useUI((s) => s.openAnchorId)
  const open = openRef === anchorRef && (openId === null || openId === myId)
  const setOpenAnchor = useUI((s) => s.setOpenAnchor)
  if (threads.length === 0) return null
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(o) => setOpenAnchor(o ? anchorRef : null, o ? myId : null)}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          title="View comments"
          onClick={(e) => {
            e.stopPropagation()
            setOpenAnchor(open ? null : anchorRef, myId)
          }}
          className={cn(
            'nodrag nopan absolute right-1 top-1 z-30 flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-bold shadow-md ring-2 ring-card hover:brightness-110',
            orphaned
              ? 'bg-destructive text-white'
              : status === 'open'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            className,
          )}
        >
          <MessageSquare className="h-2.5 w-2.5" />
          {threads.length}
        </button>
      </PopoverAnchor>
      <PopoverContent side="top" align="end" className="w-80">
        <ThreadPopover
          anchor={{ ref: anchorRef, kind }}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpenAnchor(null)}
        />
      </PopoverContent>
    </Popover>
  )
}
