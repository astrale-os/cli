/**
 * How a fact that is not known says so: still being read (and for how long), the Studio server
 * gave no answer, or the registry answered with a status. Each says why, shows the CLI's own
 * words, and offers the read again.
 */

import type { RemoteFailure } from '@shared/contracts/versions'

import { REGISTRY_READ_LIMIT_MS, REGISTRY_STEP_LIMITS_MS } from '@shared/contracts/versions'
import { RotateCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { durationWords, readingClock, useElapsed } from '@/lib/elapsed'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

import type { Fact } from './facts'

import { failureWords } from './words'

/** A retry that shows it is running, and never runs twice at once. */
export function RetryButton({
  onRetry,
  label = 'Read again',
  className,
}: {
  onRetry: () => Promise<unknown> | void
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={busy}
      className={className}
      data-workspace-retry=""
      onClick={async () => {
        setBusy(true)
        try {
          await onRetry()
        } finally {
          setBusy(false)
        }
      }}
    >
      <RotateCw className={cn(busy && 'animate-spin')} />
      {busy ? 'Reading…' : label}
    </Button>
  )
}

/** A remote fact the registry did not give: why, the CLI's words, and the read again. */
export function RemoteNotice({
  failure,
  what,
  onRetry,
}: {
  failure: Pick<RemoteFailure, 'status' | 'message'> & { code?: string; readAt?: string }
  /** the fact, as in "the Publications of shell.astrale.ai" */
  what: string
  onRetry?: () => Promise<unknown> | void
}) {
  const words = failureWords(failure, what)
  return (
    <div
      role="status"
      data-remote-status={failure.status}
      className={cn(
        'space-y-1.5 rounded-md border px-3 py-2.5 text-[13px] leading-relaxed',
        failure.status === 'not-found'
          ? 'border-border bg-muted/40'
          : 'border-warning/30 bg-warning/8',
      )}
    >
      <p className="font-medium">{words.headline}</p>
      <p className="text-muted-foreground">{words.remedy}</p>
      <p className="break-words text-[12px] text-muted-foreground">
        <span className="text-foreground/80">{failure.message}</span>
        {failure.code && <span className="ml-1.5 font-mono text-[11px]">{failure.code}</span>}
        {failure.readAt && <span className="ml-1.5">· read {relativeTime(failure.readAt)}</span>}
      </p>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  )
}

/** The Studio server itself gave no answer. */
export function ServerNotice({
  message,
  what,
  onRetry,
}: {
  message: string
  what: string
  onRetry?: () => Promise<unknown> | void
}) {
  return (
    <div
      role="status"
      data-remote-status="server-error"
      className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/6 px-3 py-2.5 text-[13px] leading-relaxed"
    >
      <p className="font-medium">The Studio server gave no answer for {what}.</p>
      <p className="break-words text-[12px] text-muted-foreground">{message}</p>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  )
}

const durationOf = (step: keyof typeof REGISTRY_STEP_LIMITS_MS) =>
  durationWords(REGISTRY_STEP_LIMITS_MS[step])

/**
 * A fact still being read, in a line that says which. A read given a limit also says how long it
 * has run; past the limit it says it hit it and offers the read again, and an answer that comes
 * later still replaces it.
 */
export function Reading({
  children,
  limitMs,
  what,
  onRetry,
  skeleton = true,
}: {
  children: ReactNode
  limitMs?: number
  /** the fact, as in "the Publications of shell.astrale.ai" */
  what?: string
  onRetry?: () => Promise<unknown> | void
  skeleton?: boolean
}) {
  const elapsed = useElapsed(limitMs ?? 0)
  const clock = limitMs === undefined ? undefined : readingClock(elapsed, limitMs)
  if (clock?.overdue)
    return (
      <div
        role="status"
        data-remote-status="overdue"
        className="space-y-1.5 rounded-md border border-warning/30 bg-warning/8 px-3 py-2.5 text-[13px] leading-relaxed"
      >
        <p className="font-medium">
          No answer for {what ?? 'this read'} in {clock.limit}, the longest a registry read is
          given.
        </p>
        <p className="text-muted-foreground">
          Each step has its own limit: an index read {durationOf('index')}, a bundle download{' '}
          {durationOf('bundle')}, a judgement {durationOf('judgement')}. An answer that comes later
          still shows here.
        </p>
        {onRetry && <RetryButton onRetry={onRetry} />}
      </div>
    )
  return (
    <div role="status" aria-live="polite" className="space-y-1.5" data-workspace-reading="">
      <p className="text-[13px] text-muted-foreground">
        {children}
        {clock?.elapsed && (
          <span className="ml-1.5 tabular-nums" data-reading-elapsed="">
            {clock.elapsed}
          </span>
        )}
      </p>
      {skeleton && <Skeleton className="block h-3 w-3/4" />}
      {skeleton && <Skeleton className="block h-3 w-1/2" />}
    </div>
  )
}

/**
 * One registry-backed fact as the panel shows it: its content once read, otherwise its state.
 * `idle` is a fact the cost guard left unread; it says so and offers the read. While it is read,
 * it says for how long, up to `REGISTRY_READ_LIMIT_MS`.
 */
export function FactView<T>({
  fact,
  what,
  reading,
  onRetry,
  idle,
  children,
}: {
  fact: Fact<T>
  what: string
  reading: ReactNode
  onRetry?: () => Promise<unknown> | void
  idle?: ReactNode
  children: (value: T, refreshing: boolean) => ReactNode
}) {
  switch (fact.status) {
    case 'idle':
      return <>{idle ?? <p className="text-[13px] text-muted-foreground">Not read yet.</p>}</>
    case 'loading':
      return (
        <Reading limitMs={REGISTRY_READ_LIMIT_MS} what={what} onRetry={onRetry}>
          {reading}
        </Reading>
      )
    case 'error':
      return <ServerNotice message={fact.message} what={what} onRetry={onRetry} />
    case 'ready':
      return <>{children(fact.value, fact.refreshing)}</>
  }
}
