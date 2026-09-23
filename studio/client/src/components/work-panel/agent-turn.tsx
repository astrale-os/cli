import type { AgentEvent, AgentRun } from '@shared/types'

import { Copy, Loader2, LogIn, MessageSquare } from 'lucide-react'

import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { isRunActive } from '@/lib/agent'
import { relativeTime } from '@/lib/format'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { AgentErrorChip } from './agent-error'
import { MessageImages } from './images'

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
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    const event = run.events[index]!
    if (event.kind === 'tool')
      return [event.tool, event.target && compactTarget(event.target)].filter(Boolean).join(' · ')
    if (event.kind === 'thinking') return 'Thinking…'
  }
  return 'Working…'
}

const isProse = (event: AgentEvent) => event.kind === 'message'

export interface AgentAuthFailure {
  title: string
  command: string
}

/**
 * ACP providers currently return authentication failures as unstructured text.
 * Keep that implementation detail out of the conversation while retaining a
 * deliberately narrow match: an unrelated 401 from a tool must remain visible.
 */
export function agentAuthFailure(run: AgentRun): AgentAuthFailure | undefined {
  if (!run.error || (run.harness !== 'claude' && run.harness !== 'codex')) return undefined
  const error = run.error.toLowerCase()
  const authenticationFailure =
    /failed to authenticate|authentication (?:failed|required)|not (?:logged|signed) in|login required/.test(
      error,
    ) ||
    (/oauth|auth token|credentials/.test(error) &&
      /expired|refresh|missing|invalid|unauthorized/.test(error))
  if (!authenticationFailure) return undefined

  return run.harness === 'codex'
    ? { title: 'Your Codex session has expired', command: 'codex login' }
    : { title: 'Your Claude Code session has expired', command: 'claude auth login' }
}

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
export function AgentTurn({
  run,
  onResume,
  onRetry,
}: {
  run: AgentRun
  onResume?: () => void
  onRetry?: () => void
}) {
  const messages = run.events.filter(isProse)
  const active = isRunActive(run)
  const answered = answeredThreads(run)
  const setPanelTab = useUI((state) => state.setPanelTab)
  const authFailure = agentAuthFailure(run)
  const images = run.attachments ?? []

  return (
    <div className="space-y-2.5">
      {images.length > 0 && <MessageImages chatId={run.chatId} attachments={images} />}
      {run.instruction ? (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px] leading-relaxed">
            {run.instruction}
          </div>
        </div>
      ) : images.length ? null : (
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
            {!active && run.error && !authFailure && <AgentErrorChip run={run} onRetry={onRetry} />}
            {!active && authFailure && (
              <AuthFailureNotice failure={authFailure} onRetry={onRetry} />
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

/** A turn the agent could not run because its CLI is signed out: how to sign back in. */
function AuthFailureNotice({
  failure,
  onRetry,
}: {
  failure: AgentAuthFailure
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="space-y-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3"
    >
      <div className="flex items-start gap-2">
        <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{failure.title}</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Sign in again from a terminal. Your conversation is saved, so you can retry this turn
            without losing your work.
          </p>
        </div>
      </div>
      <code className="block rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] text-foreground">
        {failure.command}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(failure.command)}
        >
          <Copy />
          Copy command
        </Button>
        {onRetry && (
          <Button type="button" size="xs" onClick={onRetry}>
            I’ve signed in — retry
          </Button>
        )}
      </div>
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
