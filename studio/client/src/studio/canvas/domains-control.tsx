/**
 * Which Domains a Structure canvas draws, and how: the open Domain always, each other one hidden,
 * reached (the Classes the open Domain's relationships accept, in its frame) or whole (an area of
 * its own). A Domain whose Schema the Studio cannot read is never offered whole: its reached
 * Classes are all that is known of it here.
 */

import type { DomainShare } from '@shared/contracts/workspace'

import { Globe, House } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { CanvasToolbar } from '../../schema-studio/canvas-toolbar'

export type DrawnAs = DomainShare | 'reached'

/** One other Domain the canvas can draw, and how it draws it now. */
export interface DomainChoice {
  origin: string
  label: string
  /** a Domain of the Workspace, or one outside it the open Domain depends on */
  place: 'workspace' | 'outside'
  drawn: DrawnAs
  /** why it cannot be drawn whole, when it cannot */
  noWhole?: string
  /** drawn whole while its Schema is still being read */
  reading?: boolean
  /** what the reader should know of how it is drawn: why it is not drawn as asked */
  note?: string
}

const WAYS: readonly { value: DrawnAs; label: string; hint: string }[] = [
  {
    value: 'hidden',
    label: 'Hidden',
    hint: 'None of its Classes: each relationship that reaches it ends on one card for the Domain',
  },
  {
    value: 'reached',
    label: 'Reached',
    hint: 'The Classes the open Domain’s relationships accept, in its frame',
  },
  { value: 'whole', label: 'Whole', hint: 'Every Class it declares, in an area of its own' },
]

export function DomainsControl({
  home,
  choices,
  onChoose,
}: {
  home: { label: string; version?: string }
  choices: readonly DomainChoice[]
  onChoose: (origin: string, drawn: DrawnAs) => void
}) {
  const [open, setOpen] = useState(false)
  const whole = choices.filter((choice) => choice.drawn === 'whole').length
  const inside = choices.filter((choice) => choice.place === 'workspace')
  const outside = choices.filter((choice) => choice.place === 'outside')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CanvasToolbar>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Domains"
            data-testid="domains-control"
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
              open || whole > 0
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Globe />
            Domains
            {whole > 0 && (
              <span className="tabular-nums" data-domains-whole={whole}>
                {whole + 1}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </CanvasToolbar>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[360px] overflow-y-auto p-0"
        data-testid="domains-popover"
      >
        <div className="space-y-1 border-b px-3.5 pb-3 pt-3">
          <p className="text-[13px] font-semibold">Domains on this canvas</p>
          <div className="flex items-center gap-1.5 text-[12.5px]" data-domain-home="">
            <House aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{home.label}</span>
            {home.version && (
              <span className="font-mono text-[11px] text-muted-foreground">{home.version}</span>
            )}
            <span className="ml-auto text-[11.5px] text-muted-foreground">open, always drawn</span>
          </div>
        </div>
        {choices.length === 0 ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">
            {home.label} depends on no other Domain, and the Workspace holds no other.
          </p>
        ) : (
          <div className="space-y-3 px-3.5 pb-3.5 pt-3">
            <ChoiceList title="In the Workspace" choices={inside} onChoose={onChoose} />
            <ChoiceList title="Outside the Workspace" choices={outside} onChoose={onChoose} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ChoiceList({
  title,
  choices,
  onChoose,
}: {
  title: string
  choices: readonly DomainChoice[]
  onChoose: (origin: string, drawn: DrawnAs) => void
}) {
  if (choices.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {choices.map((choice) => (
          <li key={choice.origin} data-domain-row={choice.origin} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium" title={choice.origin}>
                  {choice.label}
                </p>
                <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {choice.reading ? 'reading its Schema…' : choice.origin}
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label={`How ${choice.label} is drawn`}
                className="grid shrink-0 grid-cols-3 gap-0.5 rounded-md bg-muted/45 p-0.5"
              >
                {WAYS.map((way) => {
                  const refused = way.value === 'whole' ? choice.noWhole : undefined
                  return (
                    <button
                      key={way.value}
                      type="button"
                      role="radio"
                      aria-checked={choice.drawn === way.value}
                      disabled={refused !== undefined}
                      title={refused ?? way.hint}
                      data-domain-choice={choice.origin}
                      data-drawn={way.value}
                      onClick={() => onChoose(choice.origin, way.value)}
                      className={cn(
                        'rounded px-2 py-0.5 text-center text-[11px] font-medium transition-colors',
                        choice.drawn === way.value
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground enabled:hover:text-foreground',
                        refused !== undefined && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      {way.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {(choice.note ?? choice.noWhole) && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {choice.note ?? choice.noWhole}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
