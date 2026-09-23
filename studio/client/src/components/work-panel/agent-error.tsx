import type { AgentEvent, AgentRun } from '@shared/types'
import type { ReactNode } from 'react'

import { ChevronRight, CircleAlert, Copy, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Wrappers that name the transport, never the cause - a headline reads past them. */
const NOISE_PREFIX = /^(?:internal error|error|agent error|uncaught exception)\s*:\s*/i
const HEADLINE_BUDGET = 140

/** The deepest human message a JSON payload carries (`{"error":{"message":"Overloaded"}}`). */
function jsonMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['error', 'details', 'data']) {
    const nested = jsonMessage(record[key])
    if (nested) return nested
  }
  return typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : undefined
}

/** Providers inline their JSON error bodies; the headline keeps the words, not the braces. */
function readableJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return text
  try {
    const message = jsonMessage(JSON.parse(text.slice(start, end + 1)))
    if (!message) return text
    const before = text.slice(0, start).replace(/[\s:\-·]+$/, '')
    return before ? `${before} · ${message}` : message
  } catch {
    return text
  }
}

/**
 * The one line a failed turn shows in the conversation. A raw failure is a message,
 * then JSON-RPC data, then a stderr tail - all of it matters when investigating,
 * none of it belongs between two chat bubbles. The first meaningful line does.
 */
export function errorHeadline(error: string): string {
  const first =
    error
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  let text = first
  while (NOISE_PREFIX.test(text)) text = text.replace(NOISE_PREFIX, '')
  text = text.replace(/\s*\(JSON-RPC -?\d+\)$/, '')
  text = readableJson(text)
  if (!text) text = first || 'Unknown error'
  text = text.charAt(0).toUpperCase() + text.slice(1)
  return text.length > HEADLINE_BUDGET ? `${text.slice(0, HEADLINE_BUDGET - 1)}…` : text
}

/** What led up to the failure: the last steps, without what is already on screen. */
export function trailingActivity(run: AgentRun, limit = 8): AgentEvent[] {
  return run.events
    .filter(
      (event) => event.kind !== 'message' && !(event.kind === 'error' && event.text === run.error),
    )
    .slice(-limit)
}

function duration(run: AgentRun): string | undefined {
  if (!run.finishedAt) return undefined
  const ms = Date.parse(run.finishedAt) - Date.parse(run.createdAt)
  if (!Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

function eventLine(event: AgentEvent): string {
  if (event.kind === 'tool')
    return [event.tool, event.target].filter(Boolean).join(' · ') || event.text
  return event.text
}

/** Every fact the details view shows, in reading order; empty values are left out. */
export function errorContext(run: AgentRun): [label: string, value: string][] {
  const rows: [string, string | undefined][] = [
    ['Agent', run.harness],
    ['Model', run.prompt?.model ?? 'harness default'],
    ['Effort', run.prompt?.effort],
    ['Status', run.status],
    ['Started', new Date(run.createdAt).toLocaleString()],
    ['Duration', duration(run)],
    ['Conversation', run.resumed ? 'resumed' : 'new'],
    ['Session', run.sessionId ?? run.prompt?.sessionId],
    ['Turn', run.id],
    ['Chat', run.chatId],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

/** A plain-text report, ready for an issue, a search or another agent. */
export function errorDiagnostic(run: AgentRun): string {
  const activity = trailingActivity(run)
  return [
    `Agent turn failed: ${errorHeadline(run.error ?? '')}`,
    '',
    ...errorContext(run).map(([label, value]) => `${label}: ${value}`),
    '',
    'Error:',
    run.error ?? '(none)',
    ...(activity.length
      ? [
          '',
          'Last activity:',
          ...activity.map((event) => `[${event.ts}] ${event.kind}: ${eventLine(event)}`),
        ]
      : []),
    ...(run.instruction ? ['', 'Instruction:', run.instruction] : []),
  ].join('\n')
}

/**
 * A failed turn, at two depths. In the conversation: one quiet chip with the cause,
 * readable at a glance and never taller than a line. One click deeper: the whole
 * failure - raw error, the run's context, the steps that led to it - with a copy
 * that carries all of it, so investigating never starts by re-running the turn.
 */
export function AgentErrorChip({ run, onRetry }: { run: AgentRun; onRetry?: () => void }) {
  const [open, setOpen] = useState(false)
  const error = run.error ?? ''
  const headline = errorHeadline(error)
  const activity = trailingActivity(run)
  const context = errorContext(run)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(errorDiagnostic(run))
      toast.success('Diagnostic copied')
    } catch {
      toast.error('Copy failed - select the text and copy it manually')
    }
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="See what went wrong"
          data-testid="agent-error-chip"
          className="group inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/[0.06] py-1 pl-2 pr-1.5 text-[12px] transition-colors hover:border-destructive/35 hover:bg-destructive/10"
        >
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="shrink-0 font-medium text-destructive">Failed</span>
          <span className="min-w-0 truncate text-muted-foreground">{headline}</span>
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
        {onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onRetry}
            title="Run this turn again"
            className="shrink-0 text-muted-foreground"
          >
            <RotateCcw />
            Retry
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl gap-5" data-testid="agent-error-modal">
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
              The turn failed
            </DialogTitle>
            <p className="break-words text-[13px] text-muted-foreground">{headline}</p>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-5 overflow-y-auto">
            <DetailSection title="Error">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                {error || '(no message)'}
              </pre>
            </DetailSection>

            <DetailSection title="Context">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                {context.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate font-mono text-[11.5px]" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </DetailSection>

            {activity.length > 0 && (
              <DetailSection title="Last activity">
                <ol className="space-y-1 font-mono text-[11.5px]">
                  {activity.map((event) => {
                    const line = eventLine(event)
                    return (
                      <li key={event.id} className="flex min-w-0 gap-2">
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(event.ts).toLocaleTimeString()}
                        </span>
                        <span
                          className={
                            event.kind === 'error'
                              ? 'shrink-0 text-destructive'
                              : 'shrink-0 text-muted-foreground'
                          }
                        >
                          {event.kind}
                        </span>
                        <span className="min-w-0 truncate" title={line}>
                          {line}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </DetailSection>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              <Copy />
              Copy diagnostic
            </Button>
            {onRetry && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  onRetry()
                }}
              >
                <RotateCcw />
                Retry
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** One block of the details view, under its small uppercase heading. */
function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}
