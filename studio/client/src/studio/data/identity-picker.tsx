/**
 * Who Access reads the dataset as: one of its identities, or anyone. It floats over the
 * map's lower left and says, per Class, how many Nodes the choice reads out of how many; while
 * the read is still being decided it says how far it is. While a Policy is selected, its pairs
 * mark the map and the choice's marks stand aside; it says so, and the choice stays to be made.
 * Each identity and each Class wears its Class's icon and hue; what is read and what can't be
 * told, the tones of a verdict's outcome (`OUTCOME_MARKS`).
 */

import { ANYONE } from '@shared/contracts/scenarios'
import { Check, ChevronsUpDown, Loader2, UserRound } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { Identity, Reads } from './access'
import type { DatasetModel } from './model'

import { TONE_COLOR, TONE_TEXT } from '../canvas/tones'
import { ClassGlyph } from '../inspector/marks'
import { classLinkOf, OUTCOME_MARKS } from './marks'

export function IdentityPicker({
  model,
  identities,
  identity,
  label,
  anyone,
  reads,
  setAside,
  onPick,
  onSelectClass,
  bottom,
}: {
  /** the dataset read: what each identity and each Class is a Node of */
  model: DatasetModel
  identities: readonly Identity[]
  /** the current choice */
  identity: string
  label: string
  /** whether the Bundle lets the dataset be read as anyone */
  anyone: boolean
  reads?: Reads
  /** the Policy whose pairs mark the map instead, while it is selected */
  setAside?: string
  onPick: (identity: string) => void
  onSelectClass: (target: string) => void
  /** how far above the map's lower edge it floats, in pixels: clear of a dock over the map */
  bottom?: number
}) {
  const [open, setOpen] = useState(false)
  const choices: { id: string; label: string; detail?: string }[] = [
    ...identities.map((one) => ({
      id: one.id,
      label: one.label,
      ...(one.className ? { detail: `${one.className} · ${one.id}` } : {}),
    })),
    ...(anyone ? [{ id: ANYONE, label: 'anyone', detail: 'no identity the dataset holds' }] : []),
  ]
  const decided = reads ? reads.total.total - reads.pending : 0

  return (
    <div
      data-testid="data-identity"
      {...(setAside ? { 'data-set-aside': '' } : {})}
      style={bottom === undefined ? undefined : { bottom }}
      className="pointer-events-auto absolute bottom-3 left-3 z-10 w-[min(26rem,calc(100%-1.5rem))] rounded-lg border bg-card/95 px-3 py-2.5 text-[13px] shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Read as</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="data-identity-trigger"
              className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            role="menu"
            className="max-h-80 w-72 overflow-y-auto p-1"
          >
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="menuitemradio"
                aria-checked={choice.id === identity}
                data-identity={choice.id}
                onClick={() => {
                  setOpen(false)
                  onPick(choice.id)
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Check
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0',
                    choice.id !== identity && 'invisible',
                  )}
                />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    {model.classOf.get(choice.id) && (
                      <ClassGlyph link={classLinkOf(model.classOf.get(choice.id)!)} />
                    )}
                    <span className="truncate">{choice.label}</span>
                  </span>
                  {choice.detail && (
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {choice.detail}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {reads && reads.pending > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Deciding {decided} of {reads.total.total} Nodes
          </span>
        ) : reads ? (
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
            reads {reads.total.allowed} of {reads.total.total} Nodes
          </span>
        ) : null}
      </div>
      {setAside && (
        <p
          data-identity-set-aside=""
          className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground"
        >
          Set aside while {setAside} is selected: the map marks who it admits to what.
        </p>
      )}
      {identities.length === 0 && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          This dataset holds no identity: no Node of it is of a Class that is or extends Kernel
          Identity.{anyone ? ' It is read as anyone.' : ''}
        </p>
      )}
      {reads && reads.pending === 0 && (
        <ul data-testid="data-read-summary" className="mt-2 space-y-0.5">
          {reads.classes.map((each) => (
            <li key={each.target}>
              <button
                type="button"
                data-class={each.target}
                onClick={() => onSelectClass(each.target)}
                className="flex w-full items-baseline gap-2 rounded-sm text-left text-[12px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5 self-center">
                  {model.classByTarget.get(each.target) && (
                    <ClassGlyph link={classLinkOf(model.classByTarget.get(each.target)!)} />
                  )}
                  <span className="truncate">{each.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {each.allowed} of {each.total}
                  {each.unknown > 0 && (
                    <span className={TONE_TEXT[OUTCOME_MARKS.unknown.tone]}>
                      {' '}
                      · {each.unknown} {OUTCOME_MARKS.unknown.word.toLowerCase()}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="relative h-1.5 w-16 shrink-0 self-center overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-full opacity-70"
                    style={{
                      background: TONE_COLOR[OUTCOME_MARKS.allowed.tone],
                      width: `${each.total === 0 ? 0 : (each.allowed / each.total) * 100}%`,
                    }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
