import type { AgentEvent, AgentRun } from '@shared/types'

import { Loader2, MessageSquare, TriangleAlert } from 'lucide-react'

import { Markdown } from '@/components/markdown'
import { relativeTime } from '@/lib/format'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/** The panel is narrow, and CSS truncation eats the END of a string — the only
 *  part of a path or URL that says anything. Long targets keep their tail. */
const TARGET_BUDGET = 44

export function compactTarget(target: string): string {
  if (target.length <= TARGET_BUDGET) return target
  const segments = target.split('/').filter(Boolean)
  for (let take = 3; take >= 1; take -= 1) {
    if (segments.length <= take) break
    const tail = `…/${segments.slice(-take).join('/')}`
    if (tail.length <= TARGET_BUDGET) return tail
  }
  return `…${target.slice(1 - TARGET_BUDGET)}`
}

/**
 * What the agent is doing right now, in one line — never the whole event log, and
 * never a raw status string ("session started" tells a reader nothing).
 */
export function activityLabel(run: AgentRun): string {
  for (const event of [...run.events].reverse()) {
    if (event.kind === 'tool')
      return [event.tool, event.target && compactTarget(event.target)].filter(Boolean).join(' · ')
    if (event.kind === 'thinking') return 'Thinking…'
  }
  return 'Working…'
}

const isProse = (event: AgentEvent) => event.kind === 'message'

/** How many comment threads this turn answered in place. */
export function answeredThreads(run: AgentRun): number {
  const replied = new Set(
    run.events
      .filter((event) => event.kind === 'reply')
      .map((event) => event.commentId ?? event.id),
  )
  return Math.max(replied.size, run.liveReplies ?? 0)
}

/**
 * One exchange: what you asked, then what came back. The steps in between stay
 * out of the way — a turn is only legible once it is a message, not a log.
 */
export function AgentTurn({ run, onResume }: { run: AgentRun; onResume?: () => void }) {
  const messages = run.events.filter(isProse)
  const active = run.status === 'running' || run.status === 'queued'
  const answered = answeredThreads(run)
  const setPanelTab = useUI((state) => state.setPanelTab)

  return (
    <div className="space-y-2.5">
      {run.instruction ? (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px] leading-relaxed">
            {run.instruction}
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            {run.summary}
          </span>
        </div>
      )}

      {(messages.length > 0 || active || run.error) && (
        <div className="flex">
          <div className="min-w-0 flex-1 space-y-2 text-[13px]">
            {messages.map((message) => (
              <Markdown key={message.id} text={message.text} />
            ))}
            {active && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                <span className="truncate">{activityLabel(run)}</span>
              </div>
            )}
            {!active && run.error && (
              <div className="flex items-start gap-1.5 text-[12px] text-destructive">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{run.error}</span>
              </div>
            )}
            {run.status === 'interrupted' && onResume && (
              <button
                type="button"
                onClick={onResume}
                className="text-[12px] font-medium text-primary transition-opacity hover:opacity-80"
              >
                Continue
              </button>
            )}
            {/* The count, never the replies themselves: a turn that answered threads says
                so from the moment the first reply lands — reading them is one click away. */}
            {answered > 0 && (
              <button
                type="button"
                onClick={() => setPanelTab('comments')}
                className="inline-flex items-center gap-1.5 text-left text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                <MessageSquare className="h-3 w-3 shrink-0" />
                Answered {answered} comment {answered === 1 ? 'thread' : 'threads'}
              </button>
            )}
            {!active && messages.length === 0 && !run.error && answered === 0 && (
              <p className="text-[12px] text-muted-foreground">
                {run.status === 'canceled' ? 'Stopped.' : 'Done — no message.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A turn separator that also dates the exchange, shown between distant turns. */
export function TurnDivider({ at, className }: { at: string; className?: string }) {
  return (
    <div className={cn('py-1 text-center text-[11px] text-muted-foreground', className)}>
      {relativeTime(at)}
    </div>
  )
}
