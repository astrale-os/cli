/**
 * handoff-chip.tsx — the first thing a forked chat shows: where it came from.
 *
 * A chat opened from another agent starts with no turns of its own, but it is
 * not empty — it carries a summary of the conversation it continues. The
 * provenance opens the source tab; the chevron reveals the summary the new
 * agent receives. Once delivered, that summary is part of the conversation and
 * can no longer be removed.
 *
 * The source is named the way its tab is — its agent's mark, in that tab's
 * colour — so "where this came from" is one glance back at the strip.
 */
import type { ChatOrigin } from '@shared/types'

import { ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { HarnessLogo } from '@/components/harness-logo'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'

import type { ChatTone } from './chat-tone'

export function HandoffChip({
  origin,
  harnessLabel,
  tone,
  onOpenSource,
  onForget,
}: {
  origin: ChatOrigin
  harnessLabel: string
  tone: ChatTone
  onOpenSource?: () => void
  onForget?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!origin.summary) return null

  return (
    <div className="rounded-lg border bg-muted/40">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} transferred context`}
          title={`${open ? 'Hide' : 'Show'} transferred context`}
          className="ml-1.5 grid h-7 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={onOpenSource}
          disabled={!onOpenSource}
          aria-label={`Open ${harnessLabel} source chat`}
          title={
            onOpenSource ? `Open the ${harnessLabel} source chat` : 'The source chat is closed'
          }
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors enabled:hover:text-foreground disabled:cursor-default"
        >
          <span className="shrink-0">Continued from</span>
          <HarnessLogo harness={origin.harness} className={cn('h-3 w-3', tone.mark)} />
          <span className="truncate">{harnessLabel}</span>
        </button>
        {origin.pendingHandoff && onForget ? (
          <button
            type="button"
            onClick={onForget}
            title="Delete this context before it is sent with your first message"
            aria-label="Delete transferred context before sending"
            className="mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {open && (
        <div className="border-t px-2.5 py-2 text-[12px] leading-relaxed">
          <Markdown text={origin.summary} />
        </div>
      )}
    </div>
  )
}
