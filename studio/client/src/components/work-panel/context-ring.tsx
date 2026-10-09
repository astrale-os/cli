/**
 * context-ring.tsx - how full the conversation is, as one small ring.
 *
 * The ring is the context window: the arc is what the conversation already
 * occupies, the faint track what is left. It stays quiet while there is room and
 * only raises its voice as the window fills - amber past `WARN`, red past `FULL`.
 * The numbers behind it are one hover away.
 *
 * What it measures is the agent's own report over ACP (`usage_update`), so it is
 * as fresh as the agent's last word: it moves during a turn, and between turns
 * stays where the last one left it.
 */
import type { AgentContextUsage } from '@shared/types'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

/** Past this share of the window the ring turns amber. */
export const WARN = 0.6
/** Past this one it turns red: the agent is about to compact or run out. */
export const FULL = 0.85

export type ContextLevel = 'unknown' | 'roomy' | 'filling' | 'full'

/** The share of the window in use, between 0 and 1. */
export function contextRatio(context: AgentContextUsage): number {
  return Math.min(1, Math.max(0, context.used / context.size))
}

export function contextLevel(context: AgentContextUsage | undefined): ContextLevel {
  if (!context) return 'unknown'
  const ratio = contextRatio(context)
  if (ratio >= FULL) return 'full'
  if (ratio >= WARN) return 'filling'
  return 'roomy'
}

/** A percentage as the ring says it: whole numbers, and never "0%" for a window with something in it. */
export function contextPercent(context: AgentContextUsage): string {
  const percent = contextRatio(context) * 100
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}

/** A token count at a glance: 950, 12.4k, 200k, 1M. */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens))
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000
    return `${thousands < 100 ? Number(thousands.toFixed(1)) : Math.round(thousands)}k`
  }
  const millions = tokens / 1_000_000
  return `${Number(millions.toFixed(millions < 10 ? 2 : 1))}M`
}

const TONE: Record<ContextLevel, string> = {
  unknown: 'text-muted-foreground',
  roomy: 'text-success',
  filling: 'text-warning',
  full: 'text-destructive',
}

const BAR: Record<ContextLevel, string> = {
  unknown: 'bg-muted-foreground',
  roomy: 'bg-success',
  filling: 'bg-warning',
  full: 'bg-destructive',
}

const NOTE: Record<ContextLevel, string> = {
  unknown: 'Appears once the agent reports it, during its first reply.',
  roomy: 'Plenty of room left in this conversation.',
  filling: 'Filling up. Near the limit the agent compacts older messages.',
  full: 'Nearly full. The agent will compact soon - open a new chat to start fresh.',
}

/** Ring geometry in its own 16-unit box: a 2-unit stroke on a 6-unit radius. */
const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ContextRing({
  context,
  className,
}: {
  context?: AgentContextUsage
  className?: string
}) {
  const level = contextLevel(context)
  const ratio = context ? contextRatio(context) : 0
  const percent = context ? contextPercent(context) : undefined
  const label = percent ? `Context ${percent} full` : 'Context usage not reported yet'
  // a sliver of arc for a window with anything in it, so the ring never reads as empty
  const arc = context && context.used > 0 ? Math.max(ratio, 0.03) : 0

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          // focusable, so the details are a Tab away and not only a hover
          tabIndex={0}
          role="img"
          aria-label={label}
          data-context-level={level}
          className={cn(
            'flex h-7 min-w-7 shrink-0 cursor-default items-center justify-center gap-1 rounded-md px-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            TONE[level],
            className,
          )}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90" aria-hidden>
            <circle
              cx="8"
              cy="8"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-20"
            />
            {arc > 0 && (
              <circle
                cx="8"
                cy="8"
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - arc)}
                className="transition-[stroke-dashoffset] duration-500 ease-out"
              />
            )}
          </svg>
          {/* with room to spare the ring says enough; filling up, it says how much */}
          {(level === 'filling' || level === 'full') && (
            <span className="text-[11px] font-medium tabular-nums">{percent}</span>
          )}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-64 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium">Context window</span>
          <span className={cn('text-[12px] font-semibold tabular-nums', TONE[level])}>
            {percent ?? '-'}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', BAR[level])}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        {context && (
          <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">Used</dt>
            <dd className="text-right tabular-nums">{formatTokens(context.used)} tokens</dd>
            <dt className="text-muted-foreground">Free</dt>
            <dd className="text-right tabular-nums">
              {formatTokens(Math.max(0, context.size - context.used))} tokens
            </dd>
            <dt className="text-muted-foreground">Window</dt>
            <dd className="text-right tabular-nums">{formatTokens(context.size)} tokens</dd>
          </dl>
        )}
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">{NOTE[level]}</p>
      </HoverCardContent>
    </HoverCard>
  )
}
