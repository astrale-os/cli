/**
 * chat-effort.tsx — how hard this conversation thinks, beside what it thinks with.
 *
 * A meter, not a menu: reasoning is a dial you nudge, and the composer has room
 * for a glyph, not for the word "reasoning" and a value. Filled bars are the
 * level, the faint ones are the headroom above it, and the whole ladder is the
 * one the AGENT itself reports over ACP for the model this chat runs — Claude
 * and Codex do not name the same rungs, and a model with no reasoning at all
 * (Haiku) reports none, so the control simply is not there.
 *
 * The pick belongs to the chat, like its model: tabs think at their own depth.
 */
import type { AgentEffort, ChatInfo, HarnessEffortOption, HarnessStatus } from '@shared/types'

import { effectiveAgentEffort } from '@shared/agent-effort'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatMutations } from '@/lib/chats'
import { useLoadout } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const EFFORT_LABELS: Record<AgentEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
  ultra: 'Ultra',
  ultracode: 'Ultracode',
}

/** Ascending bars, tallest last — the meter reads as signal strength. */
function EffortBars({
  level,
  total,
  className,
}: {
  level: number
  total: number
  className?: string
}) {
  return (
    <span aria-hidden className={cn('flex items-end gap-[1.5px]', className)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          style={{ height: `${4 + Math.round(((index + 1) * 8) / total)}px` }}
          className={cn(
            'w-[2px] rounded-[1px] bg-current transition-opacity',
            index <= level ? 'opacity-100' : 'opacity-25',
          )}
        />
      ))}
    </span>
  )
}

export function ChatEffortPicker({ chat, harness }: { chat?: ChatInfo; harness?: HarnessStatus }) {
  const [open, setOpen] = useState(false)
  const { data: loadout } = useLoadout(chat?.id)
  const { update } = useChatMutations()

  if (!chat) return null
  // Until the ACP probe lands, the agent's declared ladder stands in for the
  // model's own — near enough to render, and replaced the moment the truth
  // arrives. `efforts: []` IS the truth: this model does not reason on request.
  const levels = loadout?.efforts ?? fallbackLadder(harness, chat.harness)
  if (levels.length === 0) return null

  // An unpinned chat is not "on nothing": it runs whatever the agent is set to,
  // which is exactly what the probe reports. Until one of the two says a level,
  // there is nothing honest to fill the meter with — so it waits rather than
  // showing an empty one.
  const running = effectiveAgentEffort(
    levels.map((option) => option.id),
    chat.effort ?? loadout?.effort,
  )
  if (!running) return null
  const level = levels.findIndex((option) => option.id === running)
  const label = EFFORT_LABELS[running]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Reasoning — ${label}. Click to change.`}
          aria-label={`Reasoning: ${label}`}
          className="flex h-5 shrink-0 items-center rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <EffortBars level={level} total={levels.length} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-52 p-1">
        <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reasoning
        </p>
        {levels.map((option, index) => (
          <button
            key={option.id}
            type="button"
            title={option.description}
            aria-current={option.id === running ? 'true' : undefined}
            onClick={() => {
              setOpen(false)
              update.mutate({ chatId: chat.id, effort: option.id })
            }}
            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <EffortBars
              level={index}
              total={levels.length}
              className={option.id === running ? 'text-foreground' : 'text-muted-foreground'}
            />
            <span className="min-w-0 flex-1 truncate text-[13px]">{option.label}</span>
            <Check
              className={cn(
                'h-3 w-3 shrink-0',
                option.id === running ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** What this agent says it can do, before any model narrows it down. */
function fallbackLadder(
  harness: HarnessStatus | undefined,
  harnessId: string,
): HarnessEffortOption[] {
  const known = harness?.harnesses?.find((entry) => entry.id === harnessId)
  return (known?.capabilities.effortLevels ?? []).map((id) => ({ id, label: EFFORT_LABELS[id] }))
}
