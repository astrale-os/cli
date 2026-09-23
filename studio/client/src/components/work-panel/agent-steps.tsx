import type { AgentEvent, AgentRun } from '@shared/types'

import {
  Brain,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { RunElapsed } from '@/components/agent-activity'
import { Markdown } from '@/components/markdown'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isRunActive } from '@/lib/agent'
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
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    const event = run.events[index]!
    if (event.kind === 'tool')
      return [event.tool, event.target && compactTarget(event.target)].filter(Boolean).join(' · ')
    if (event.kind === 'thinking') return 'Thinking…'
  }
  return 'Working…'
}

/** One line of the work behind a turn, in the order it happened. */
export type AgentStep =
  | { kind: 'note'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: string; detail?: string }
  | { kind: 'thinking'; id: string }

export interface TurnParts {
  /** the narration, tools and thinking that led to the answer */
  steps: AgentStep[]
  /** what the turn says to the reader once it is over */
  answer: AgentEvent[]
}

/**
 * Splits a turn into its answer and the work behind it. A message the agent wrote
 * before another tool call is narration ("I read the schema…"), not an answer, so
 * only the prose after the last tool counts. Until the turn ends nothing is final:
 * the next event may be another tool.
 */
export function splitTurn(run: AgentRun): TurnParts {
  const { events } = run
  const answerIds = new Set<string>()
  if (!isRunActive(run)) {
    const lastTool = events.findLastIndex((event) => event.kind === 'tool')
    for (const event of events.slice(lastTool + 1))
      if (event.kind === 'message') answerIds.add(event.id)
    // ended on a tool, an error or a stop: the last thing it said is still its answer
    const lastMessage = events.findLast((event) => event.kind === 'message')
    if (answerIds.size === 0 && lastMessage) answerIds.add(lastMessage.id)
  }

  const steps: AgentStep[] = []
  for (const event of events) {
    if (event.kind === 'message' && !answerIds.has(event.id))
      steps.push({ kind: 'note', id: event.id, text: event.text })
    else if (event.kind === 'tool') {
      const tool = event.tool || event.text || 'Tool'
      const detail = event.target
        ? compactTarget(event.target)
        : event.text && event.text !== tool
          ? event.text
          : undefined
      steps.push({ kind: 'tool', id: event.id, tool, detail })
    }
    // thinking streams in fragments: one line per stretch, not one per fragment
    else if (event.kind === 'thinking' && steps.at(-1)?.kind !== 'thinking')
      steps.push({ kind: 'thinking', id: event.id })
  }

  return { steps, answer: events.filter((event) => answerIds.has(event.id)) }
}

/** The narration the agent last gave, flattened to one line for the header. */
export function latestNote(steps: AgentStep[]): string | undefined {
  const note = steps.findLast((step) => step.kind === 'note')
  if (note?.kind !== 'note') return undefined
  return note.text
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/[`*_]/g, '')
    .trim()
}

function toolIcon(tool: string): LucideIcon {
  const name = tool.toLowerCase()
  if (/edit|write|delete|move|patch/.test(name)) return Pencil
  if (/grep|glob|search|find/.test(name)) return Search
  if (/bash|exec|shell|terminal|command/.test(name)) return Terminal
  if (/fetch|web|http/.test(name)) return Globe
  if (/read|view|cat/.test(name)) return FileText
  return Wrench
}

function StepRow({ step }: { step: AgentStep }) {
  if (step.kind === 'note')
    return <Markdown text={step.text} className="py-0.5 text-[12px] text-foreground/75" />
  if (step.kind === 'thinking')
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Brain className="h-3 w-3 shrink-0" />
        <span>Thinking</span>
      </div>
    )
  const Icon = toolIcon(step.tool)
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="shrink-0 text-foreground/70">{step.tool}</span>
      {step.detail && (
        <span className="truncate font-mono text-[11px]" title={step.detail}>
          {step.detail}
        </span>
      )}
    </div>
  )
}

/**
 * The work behind a turn, folded into one line. While the agent runs, the line
 * says what it is doing now; once it is done, how much it took. Either way a
 * click unfolds the steps and another folds them back. The component stays
 * mounted across the end of the turn, so a list opened while it ran stays open.
 */
export function AgentSteps({ run, steps }: { run: AgentRun; steps: AgentStep[] }) {
  const [open, setOpen] = useState(false)
  const active = isRunActive(run)
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // follow new steps like a terminal does, unless the reader scrolled up to look back
  useLayoutEffect(() => {
    const element = list.current
    if (open && element && pinned.current) element.scrollTop = element.scrollHeight
  }, [open, steps.length])

  if (!active && steps.length === 0) return null

  const tools = steps.filter((step) => step.kind === 'tool').length
  // a turn of pure narration still says how much there is to unfold
  const count = tools || steps.length
  const note = active ? latestNote(steps) : undefined
  const current = activityLabel(run)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 rounded-md text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        {active ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        )}
        {active ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            {note && <span className="truncate text-foreground/80">{note}</span>}
            <span className={cn('truncate', note && 'shrink-[2] text-[11px]')}>{current}</span>
          </span>
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span>
              {count} {count === 1 ? 'step' : 'steps'}
            </span>
            <span aria-hidden>·</span>
            <RunElapsed run={run} />
          </span>
        )}
        {active && (
          <ChevronRight className="ml-auto h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={list}
          data-testid="agent-steps"
          onScroll={(event) => {
            const element = event.currentTarget
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          }}
          className="mt-1.5 max-h-60 space-y-1 overflow-y-auto border-l border-border pl-3 text-[12px]"
        >
          {steps.length === 0 ? (
            <p className="text-muted-foreground">Nothing reported yet.</p>
          ) : (
            steps.map((step) => <StepRow key={step.id} step={step} />)
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
