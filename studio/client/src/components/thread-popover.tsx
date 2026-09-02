import type { AnchorRef, Comment } from '@shared/types'

import { X } from 'lucide-react'
import { useState } from 'react'

import { NewComment, ThreadView } from './thread'
import { Button } from './ui/button'

/**
 * The body rendered inside a comment Popover: what this anchor's threads say,
 * and a way to add one. A fresh anchor opens straight into the composer; an
 * anchor that already has threads shows them, with the composer one click away.
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
  const ownerDomainId = domainId
  const [composing, setComposing] = useState(false)
  const hasThreads = threads.length > 0

  return (
    <div className="flex max-h-[calc(var(--radix-popover-content-available-height)-1.5rem)] min-h-0 flex-col gap-2.5 text-sm">
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-auto text-xs font-medium text-muted-foreground">
          {hasThreads
            ? `${threads.length} comment${threads.length === 1 ? '' : 's'}`
            : 'New comment'}
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
            <ThreadView key={comment.id} domainId={ownerDomainId} comment={comment} />
          ))}
        </div>
      )}

      {!hasThreads || composing ? (
        <NewComment
          domainId={ownerDomainId}
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
