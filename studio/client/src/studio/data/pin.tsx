/**
 * Pinning a verdict: beside each verdict Access decides, a menu adds it to one of the
 * dataset's Scenarios, or to a new one, as a step that expects it as it stands. A verdict that
 * can't tell is not pinned: no step can expect it. A Scenario that already asks the same is
 * marked, and not offered twice.
 */

import type { Scenario, ScenarioStep } from '@shared/contracts/scenarios'

import { ListPlus, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { Verdict } from './access'
import type { DatasetModel } from './model'

import { sameAsk, stepOfVerdict } from './scenarios'

/** What pinning needs from the level: the dataset's Scenarios, and who the verdicts are decided as. */
export interface Pinning {
  readonly model: DatasetModel
  /** the dataset's Scenarios, by name */
  readonly scenarios: readonly Scenario[]
  /** the identity Rules reads as */
  readonly as: string
  /** Adds the step to `into`, or to a new Scenario when none is named. */
  readonly onPin: (step: ScenarioStep, into: Scenario | undefined) => void
  readonly newId: () => string
}

export function PinButton({ verdict, pinning }: { verdict: Verdict; pinning: Pinning }) {
  const [open, setOpen] = useState(false)
  const { model, scenarios, as } = pinning
  const ask = useMemo(() => stepOfVerdict(model, verdict, as, '@ask'), [as, model, verdict])
  const holders = useMemo(
    () =>
      ask ? scenarios.filter((scenario) => scenario.steps.some((one) => sameAsk(one, ask))) : [],
    [ask, scenarios],
  )
  if (!ask) return null
  const held = holders.length > 0
  const pin = (into: Scenario | undefined) => {
    setOpen(false)
    pinning.onPin({ ...ask, id: pinning.newId() }, into)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-verdict-pin={verdict.id}
          data-held={held ? '' : undefined}
          title={
            held
              ? `Held as a step by ${holders.map((one) => one.name).join(', ')}: pin it elsewhere`
              : 'Pin it to a Scenario, as a step that expects it'
          }
          aria-label="Pin to a Scenario"
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            held ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <ListPlus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        role="menu"
        data-pin-menu={verdict.id}
        className="max-h-80 w-72 overflow-y-auto p-1"
      >
        <p className="px-2 pb-1 pt-1.5 text-[12px] leading-snug text-muted-foreground">
          Pin as a step that expects it {verdict.outcome}
        </p>
        {scenarios.map((scenario) => {
          const holds = holders.includes(scenario)
          return (
            <button
              key={scenario.id}
              type="button"
              role="menuitem"
              disabled={holds}
              data-pin-scenario={scenario.id}
              onClick={() => pin(scenario)}
              className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{scenario.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {holds
                  ? 'holds it'
                  : `${scenario.steps.length} ${scenario.steps.length === 1 ? 'step' : 'steps'}`}
              </span>
            </button>
          )
        })}
        {scenarios.length > 0 && <div className="my-1 h-px bg-border" />}
        <button
          type="button"
          role="menuitem"
          data-pin-new=""
          onClick={() => pin(undefined)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          New Scenario with this step
        </button>
      </PopoverContent>
    </Popover>
  )
}
