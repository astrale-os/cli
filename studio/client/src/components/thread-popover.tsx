import type { AnchorRef, Comment } from '@shared/contracts/workspace'

import { Lock, X } from 'lucide-react'
import { useState } from 'react'

import { readOnlyNotice } from '@/lib/read-only'

import { NewComment, ThreadView } from './thread'
import { Button } from './ui/button'

/**
 * The body rendered inside a comment Popover: what this anchor's threads say,
 * and a way to add one. A fresh anchor opens straight into the composer; an
 * anchor that already has threads shows them, with the composer one click away.
 * A read-only Domain takes no comment: the composer's place says so (`readOnlyNotice`).
 */
export function ThreadPopover({
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
  const [composing, setComposing] = useState(false)
  const hasThreads = threads.length > 0
  const readOnly = readOnlyNotice(domainId, 'comment')

  return (
    <div className="flex max-h-[calc(var(--radix-popover-content-available-height)-1.5rem)] min-h-0 flex-col gap-2.5 text-sm">
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {hasThreads ? (
            `${threads.length} comment${threads.length === 1 ? '' : 's'}`
          ) : readOnly ? (
            <>
              <Lock className="h-3 w-3" /> Read-only
            </>
          ) : (
            'New comment'
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hasThreads && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {threads.map((comment) => (
            <ThreadView key={comment.id} domainId={domainId} comment={comment} />
          ))}
        </div>
      )}

      {readOnly ? (
        <p data-read-only-notice="" className="text-[12.5px] leading-snug text-muted-foreground">
          {readOnly}
        </p>
      ) : !hasThreads || composing ? (
        <NewComment
          domainId={domainId}
          anchor={anchor}
          excerpt={excerpt}
          autoFocus
          onDone={() => {
            setComposing(false)
            if (!hasThreads) onClose()
          }}
          onCancel={hasThreads ? () => setComposing(false) : undefined}
        />
      ) : (
        <Button size="xs" variant="ghost" className="self-start" onClick={() => setComposing(true)}>
          Add a comment
        </Button>
      )}
    </div>
  )
}
