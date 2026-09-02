/**
 * chat-model.tsx — the composer's model picker.
 *
 * One list, every agent: the models of the chat you are in, and the models of
 * the other one. That is deliberate — picking a model is how you pick an agent,
 * and the two questions are really one. What differs is the consequence, and the
 * picker says it plainly:
 *
 *   • a model of THIS chat's agent  → this conversation switches model
 *   • a model of ANOTHER agent      → a NEW chat opens on it, briefed on this one
 *
 * Never a jump to some existing tab of that agent: a chat cannot change agent,
 * and an older tab is a different conversation.
 *
 * Each agent is named by its mark, and every entry is a real model — a chat that
 * pins nothing already runs the agent's Studio default, so an extra "agent
 * default" row would only be a second name for a model already in the list.
 */
import type {
  AgentModelPreference,
  ChatInfo,
  HarnessModelCatalog,
  HarnessStatus,
} from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { HarnessLogo } from '@/components/harness-logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, qk } from '@/lib/api'
import { useChatMutations, useModelCatalog } from '@/lib/chats'
import { labelOf } from '@/lib/harnesses'
import { useLoadout, useSettings } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { brandTone } from './chat-tone'

export function ChatModelPicker({
  domainId,
  chat,
  harness,
}: {
  domainId: string
  chat?: ChatInfo
  harness?: HarnessStatus
}) {
  const [open, setOpen] = useState(false)
  // Warmed by the panel itself the moment a domain is on screen, so by the time
  // this renders the answer is normally already in the cache.
  const { data: catalog, isFetching } = useModelCatalog(domainId)
  const { data: loadout } = useLoadout(domainId, chat?.id)
  const { data: settings } = useSettings()
  const { update, switchHarness } = useChatMutations(domainId)
  const prefer = usePreferredModel(domainId)

  if (!chat) return null
  // Two ways to name the running model, and the catalog goes first ON PURPOSE: it
  // is one query for the whole domain, so it is still warm when you switch tab or
  // land on a fork, while the loadout is a per-chat ACP probe that takes seconds.
  // Reading the slower one first is what made a fresh tab flash the raw slug
  // (`gpt-5.6-luna`) before settling on its label (`GPT-5.6-Luna`).
  const known = catalog?.find((entry) => entry.harness === chat.harness)
  const running = chat.model ?? known?.defaultModel ?? loadout?.model ?? loadout?.nativeModel
  // No name, no control. The label's whole job is to say WHICH model, so with no
  // answer yet there is nothing to put there — a "default model" placeholder read
  // as the name of a model, and every agent's default is a different one. This is
  // also the only honest state for an agent this machine does not have: it reports
  // no model because it will run none, and the field beside it already says so.
  if (!running) return null
  const label =
    known?.models.find((model) => model.id === running)?.label ??
    loadout?.models?.find((model) => model.id === running)?.label ??
    running

  const domainDefault = catalog?.find((entry) => entry.harness === harness?.id)?.defaultModel
  const { shown, remembered } = starPlacement(harness, settings?.agentModel, domainDefault)

  // A process locked to one agent by --harness offers that agent's models, and
  // those of the tab you are in: every other row would open a chat this Studio
  // will not start.
  const offered = catalog?.filter(
    (entry) => !harness?.locked || entry.harness === chat.harness || entry.harness === harness.id,
  )

  const choose = (target: HarnessModelCatalog, model: string) => {
    setOpen(false)
    if (target.harness === chat.harness) update.mutate({ chatId: chat.id, model })
    else switchHarness.mutate({ chatId: chat.id, harness: target.harness, model })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* the model alone: which agent runs it is already said by the tab you are
            in, and the composer is the one place with no room to repeat it */}
        <button
          type="button"
          title={`${labelOf(harness, chat.harness)} — ${label}. Click to change model or agent.`}
          className="max-w-[170px] truncate rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {label}
        </button>
      </PopoverTrigger>
      {/* anchored on the trigger's right edge: the composer sits at the panel's
          bottom-right, and a start-aligned menu would hang outside it */}
      <PopoverContent align="end" side="top" className="max-h-[340px] w-64 overflow-auto p-1">
        {isFetching && !catalog && (
          <p className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Asking each agent for its models…
          </p>
        )}
        {offered?.map((entry) => (
          <HarnessGroup
            key={entry.harness}
            entry={entry}
            current={chat}
            preferred={shown?.harness === entry.harness ? shown.model : null}
            remembered={remembered?.harness === entry.harness ? remembered.model : null}
            onSelect={(model) => choose(entry, model)}
            onPrefer={(model) => prefer.mutate({ harness: entry.harness, model })}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Where the one star is DRAWN, and where it is being kept.
 *
 * The star is filled from the moment there is an answer, starred or not: with
 * nothing pinned a new chat still opens SOMEWHERE — the studio's agent, on that
 * agent's default model — and the list should say where.
 *
 * Which is also why it cannot sit on an agent this machine does not have: no new
 * chat opens there, so a star on it would be an offer to open Claude on a laptop
 * that only has Codex. `source === 'fallback'` is the server saying exactly that
 * (see server/agent/harness/selection.ts), and the star follows the agent Studio
 * actually runs.
 *
 * Nothing is overwritten, though — the setting still names the missing agent, and
 * the selection returns to it the day it is installed. `remembered` is that star,
 * so the picker can say it in the missing agent's own group rather than let it
 * look thrown away.
 */
export function starPlacement(
  harness: HarnessStatus | undefined,
  starred: AgentModelPreference | null | undefined,
  /** what a new chat on the RUNNING agent opens on, from the catalog */
  runningDefault: string | undefined,
): { shown: AgentModelPreference | null; remembered: AgentModelPreference | null } {
  const stranded = harness?.source === 'fallback'
  const honoured = stranded ? null : starred
  const running = harness && runningDefault ? { harness: harness.id, model: runningDefault } : null
  return {
    shown: honoured ?? running,
    remembered: (stranded && starred) || null,
  }
}

/**
 * Star THE model new conversations open on — one for the whole domain.
 *
 * Not one per agent, and not one per domain: a preferred model names its agent too,
 * so starring a Codex model is how the studio stops opening on Claude. Open chats are
 * untouched — a tab that pinned its own model keeps it, and one that pinned none moves
 * with the star.
 */
function usePreferredModel(domainId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { harness: string; model: string }) =>
      api.updateSettings({ agentModel: { harness: input.harness, model: input.model } }),
    // The catalog is a live ACP probe of every harness — too slow to block a star
    // on. Move the one row it certainly changed now, and let the refetch settle
    // the harness that just LOST the star (whose default Studio cannot compute here).
    onSuccess: (next, input) => {
      queryClient.setQueryData(qk.settings, next)
      queryClient.setQueryData<HarnessModelCatalog[]>(qk.models(domainId), (current) =>
        current?.map((entry) =>
          entry.harness === input.harness ? { ...entry, defaultModel: input.model } : entry,
        ),
      )
      queryClient.invalidateQueries({ queryKey: qk.models(domainId) })
      // the composer's label reads the loadout, and an unpinned chat just moved
      queryClient.invalidateQueries({ queryKey: qk.loadout(domainId) })
      // and the star names an agent, so the selection — and why it is that one —
      // just moved with it
      queryClient.invalidateQueries({ queryKey: qk.harness(domainId) })
    },
    onError: (error) => toast.error(`Could not set the preferred model — ${String(error)}`),
  })
}

function HarnessGroup({
  entry,
  current,
  preferred,
  remembered,
  onSelect,
  onPrefer,
}: {
  entry: HarnessModelCatalog
  current: ChatInfo
  /** the starred model when the domain's one star is on THIS agent */
  preferred: string | null
  /** the starred model this agent is holding while it is MISSING from this machine */
  remembered?: string | null
  onSelect: (model: string) => void
  onPrefer: (model: string) => void
}) {
  const isCurrent = entry.harness === current.harness
  // An unpinned chat is not "on nothing" — it runs this harness's default, and
  // the tick has to land on that row.
  const selected = isCurrent ? (current.model ?? entry.defaultModel ?? entry.nativeModel) : null
  return (
    <div className="pb-1">
      <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <HarnessLogo
          harness={entry.harness}
          className={cn('h-3 w-3', brandTone(entry.harness).mark)}
        />
        {entry.label}
      </p>
      {!entry.available && (
        <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground">
          {entry.detail ?? 'not available on this machine'}
        </p>
      )}
      {/* The star is drawn on the agent Studio actually opens on, so without this
          line yours would look thrown away the day you opened the workspace on a
          machine without this agent. It is kept, and it comes back on its own. */}
      {remembered && (
        <p className="flex items-start gap-1.5 px-2 pb-1 text-[11px] leading-snug text-muted-foreground">
          <Star className="mt-[3px] h-3 w-3 shrink-0 fill-current text-warning" />
          <span>
            <span className="text-foreground">{remembered}</span> stays starred — new chats come
            back to it once {entry.label} is installed here.
          </span>
        </p>
      )}
      {entry.available && (
        <>
          {entry.models.map((model) => (
            <ModelOption
              key={model.id}
              label={model.label}
              selected={selected === model.id}
              preferred={preferred === model.id}
              onSelect={() => onSelect(model.id)}
              onPrefer={() => onPrefer(model.id)}
            />
          ))}
          {entry.models.length === 0 && (
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              {entry.detail ?? 'reports no selectable model'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One model: ✓ is what THIS chat runs, ★ is what the NEXT one opens on.
 *
 * They answer different questions, so they are two controls on one row — and the
 * empty star only shows under the pointer, or the list would read as a column of
 * decisions rather than a list of models. Exactly one ★ is filled in the whole
 * list, across every agent: that is what "preferred model" means here.
 */
function ModelOption({
  label,
  selected,
  preferred,
  onSelect,
  onPrefer,
}: {
  label: string
  selected: boolean
  preferred: boolean
  onSelect: () => void
  onPrefer: () => void
}) {
  return (
    <div className="group/model flex items-center rounded transition-colors hover:bg-accent">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px]"
      >
        <Check className={cn('h-3 w-3 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onPrefer}
        disabled={preferred}
        aria-pressed={preferred}
        title={
          preferred
            ? 'New chats open on this model'
            : 'Open new chats on this model — and on its agent'
        }
        aria-label={`Prefer ${label} for new chats`}
        className={cn(
          'mr-1 grid h-5 w-5 shrink-0 place-items-center rounded transition-opacity',
          preferred
            ? 'text-warning'
            : 'text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/model:opacity-100',
        )}
      >
        <Star className={cn('h-3 w-3', preferred && 'fill-current')} />
      </button>
    </div>
  )
}
