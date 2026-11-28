/**
 * The question the canvas answers, standing over it: which dataset is read and at what size, who
 * asks, and the Query open with one chip per slot. A chip says the value it holds and, when the
 * Studio picked it, why; opened, it lists the Nodes it can take with what asking with each gives.
 * With no Query open the bar says what the map then is: the dataset measured against its Schema.
 */

import type { DefinitionLink } from '@shared/contracts/schema'

import {
  ChevronDown,
  FlaskConical,
  Info,
  LayoutGrid,
  Ruler,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { Identity } from '../access'
import type { Candidate, ValueCandidate, Why } from './fill'
import type { Slot } from './question'

import { DATA_ACCENT, DATA_GLYPH } from '../accent'
import { whyWords } from './fill'
import { titleOf } from './question'
import { FACTORS } from './scale'
import { counted } from './scenes'

/** One count of an answer, in the order its tree reads: `3 Tickets`. */
export interface AnswerCount {
  readonly step: string
  readonly label: string
  readonly count: number
}

export interface QuestionBarProps {
  datasetName: string
  nodes: number
  edges: number
  factor: number
  onFactor: (factor: number) => void
  onDatasets: () => void
  identities: readonly Identity[]
  /** who asks, by Node path; none reads the dataset whole */
  as?: string
  onAs: (identity: string | undefined) => void
  /** while what the identity may read is still being decided: how far it is, in words */
  deciding?: string
  /** the Query open */
  definition?: DefinitionLink
  slots: readonly Slot[]
  values: Readonly<Record<string, readonly string[]>>
  picked: Readonly<Record<string, Why>>
  labelOf: (path: string) => string
  /** a slot's candidates, asked when its chip opens */
  candidatesOf: (slot: Slot) => Candidate[]
  /** the values a value slot can take, as the dataset holds them */
  valuesOf: (slot: Slot) => ValueCandidate[]
  onValue: (slot: string, values: readonly string[] | undefined) => void
  onClose: () => void
  counts: readonly AnswerCount[]
  /** Nodes reached and withheld from the identity */
  hidden: number
  /** what the answer leaves out of the Query's own meaning, each in a sentence */
  approximate: readonly string[]
  /** ends where a Node breaks what the end declares, while the dataset is read measured */
  breaches: number
}

const CHIP =
  'inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border bg-card px-2 text-[12.5px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

/** A plural as a count reads it: `Tickets`, `Identities`, `Classes`. */
export function plural(name: string, count: number): string {
  if (count === 1) return name
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`
  return `${name}s`
}

function Row({
  current,
  onPick,
  children,
  detail,
  title,
}: {
  current: boolean
  onPick: () => void
  children: ReactNode
  detail?: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={current}
      title={title}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent',
        current && 'bg-accent font-medium',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{detail}</span>
      )}
    </button>
  )
}

/** What asking with a candidate gives, short: `3 rows · 9 Nodes`. */
const givesWords = (gives: NonNullable<Candidate['gives']>): string =>
  gives.matched === 0
    ? 'nothing'
    : `${counted(gives.matched)} ${gives.matched === 1 ? 'row' : 'rows'} · ${counted(gives.nodes)} Nodes`

/** One slot of a question as a chip: what it holds, why, and what it can take. */
function SlotChip({
  slot,
  value,
  why,
  labelOf,
  candidatesOf,
  valuesOf,
  onValue,
}: {
  slot: Slot
  value: readonly string[] | undefined
  why?: Why
  labelOf: (path: string) => string
  candidatesOf: (slot: Slot) => Candidate[]
  valuesOf: (slot: Slot) => ValueCandidate[]
  onValue: (values: readonly string[] | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState('')
  const held0 = value?.[0]
  const choices = useMemo(
    () => (open && slot.kind === 'value' ? valuesOf(slot) : []),
    [open, slot, valuesOf],
  )
  const candidates = useMemo(
    () => (open && slot.kind !== 'value' ? candidatesOf(slot) : []),
    [candidatesOf, open, slot],
  )
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? candidates.filter(
        (candidate) =>
          candidate.label.toLowerCase().includes(needle) ||
          candidate.path.toLowerCase().includes(needle) ||
          candidate.variables.some((name) => name.toLowerCase().includes(needle)),
      )
    : candidates
  const held = value ?? []
  const said =
    held.length === 0
      ? slot.optional
        ? 'any'
        : 'none'
      : slot.kind === 'value'
        ? held[0]!
        : held.length === 1
          ? labelOf(held[0]!)
          : `${labelOf(held[0]!)} +${held.length - 1}`
  const pick = (path: string) => {
    if (slot.kind === 'nodes') {
      const next = held.includes(path) ? held.filter((each) => each !== path) : [...held, path]
      onValue(next.length > 0 ? next : undefined)
      return
    }
    onValue([path])
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-ask-slot={slot.id}
          data-held={held.length > 0 ? '' : undefined}
          className={cn(CHIP, !slot.applied && 'border-dashed')}
        >
          <span className="shrink-0 text-muted-foreground">{slot.label}</span>
          <span
            className={cn(
              'min-w-0 truncate',
              held.length > 0 ? 'font-medium text-foreground' : 'italic text-muted-foreground',
            )}
          >
            {said}
          </span>
          {why !== undefined && (
            <Sparkles
              aria-label="picked by the Studio"
              className="h-3 w-3 shrink-0 text-primary/80"
            />
          )}
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-0">
        <div className="space-y-1 border-b px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[12.5px] font-medium">{slot.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {slot.kind === 'nodes'
                ? 'several Nodes'
                : slot.kind === 'node'
                  ? 'one Node'
                  : 'a value'}
              {slot.optional ? ' · optional' : ''}
            </span>
          </div>
          {slot.doc !== undefined && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">{slot.doc}</p>
          )}
          {slot.offered && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Offered by the Studio from what the Query reads: its own parameters are not read yet.
            </p>
          )}
          {!slot.applied && (
            <p className="text-[12px] leading-relaxed text-warning">
              Shown, not applied: the reading cannot tell what the Query compares it with.
            </p>
          )}
          {why !== undefined && held.length > 0 && (
            <p className="flex items-start gap-1.5 text-[12px] leading-relaxed">
              <Sparkles aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" />
              <span>
                Picked for you: <span className="font-medium">{labelOf(held[0]!)}</span>,{' '}
                {whyWords(why)}.
              </span>
            </p>
          )}
        </div>
        {slot.kind === 'value' ? (
          <div className="max-h-72 overflow-y-auto p-1" role="listbox">
            {choices.map((choice) => (
              <Row
                key={choice.value}
                current={held0 === choice.value}
                detail={
                  choice.nodes === 0
                    ? 'none here'
                    : `${counted(choice.nodes)} ${choice.nodes === 1 ? 'Node' : 'Nodes'}`
                }
                onPick={() => {
                  onValue([choice.value])
                  setOpen(false)
                }}
              >
                {choice.value}
              </Row>
            ))}
            {choices.length === 0 && (
              <p className="px-2 py-1.5 text-[12px] leading-relaxed text-muted-foreground">
                {slot.applied
                  ? 'The dataset holds no value for it.'
                  : 'Type a value: the dataset has none to offer for it.'}
              </p>
            )}
            <form
              className="mt-1 flex items-center gap-1.5 border-t px-2 pt-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                if (!typed.trim()) return
                onValue([typed.trim()])
                setTyped('')
                setOpen(false)
              }}
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Another value"
                className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!typed.trim()}
                className="h-6 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent disabled:text-muted-foreground/60"
              >
                Set
              </button>
            </form>
          </div>
        ) : (
          <>
            {candidates.length > 8 && (
              <label className="flex items-center gap-2 border-b px-3 py-1.5">
                <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Find among ${counted(candidates.length)}`}
                  className="h-6 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
                />
              </label>
            )}
            <div className="max-h-72 overflow-y-auto p-1" role="listbox">
              {shown.slice(0, 80).map((candidate) => (
                <Row
                  key={candidate.path}
                  current={held.includes(candidate.path)}
                  onPick={() => pick(candidate.path)}
                  title={candidate.path}
                  detail={candidate.gives ? givesWords(candidate.gives) : undefined}
                >
                  {candidate.label}
                  {candidate.variables.map((name) => (
                    <span
                      key={name}
                      className="ml-1.5 rounded-sm bg-muted px-1 font-mono text-[10.5px] font-normal text-muted-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </Row>
              ))}
              {shown.length > 80 && (
                <p className="px-2 py-1.5 text-[11.5px] text-muted-foreground">
                  {counted(shown.length - 80)} more: type to find one.
                </p>
              )}
              {shown.length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  {candidates.length === 0
                    ? 'The dataset holds no Node it can take.'
                    : 'No Node matches.'}
                </p>
              )}
            </div>
          </>
        )}
        {held.length > 0 && (slot.optional || slot.offered) && (
          <div className="border-t p-1">
            <Row
              current={false}
              onPick={() => {
                onValue(undefined)
                setOpen(false)
              }}
            >
              <span className="text-muted-foreground">Any: free this slot</span>
            </Row>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Who asks, as a chip: one of the dataset's identities, or the choice that stands for none. */
function AsChip({
  identities,
  as,
  deciding,
  onAs,
}: Pick<QuestionBarProps, 'identities' | 'as' | 'deciding' | 'onAs'>) {
  const [open, setOpen] = useState(false)
  const current = identities.find((one) => one.id === as)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-ask-as={as ?? ''} className={cn(CHIP, 'shrink-0')}>
          <span className="shrink-0 text-muted-foreground">read as</span>
          <span className="min-w-0 truncate font-medium">{current?.label ?? 'the Domain'}</span>
          {deciding !== undefined && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {deciding}
            </span>
          )}
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-0">
        <p className="border-b px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          A Query runs under whoever asks: the same question answers with what that identity may
          read.
        </p>
        <div className="max-h-72 overflow-y-auto p-1" role="listbox">
          <Row
            current={as === undefined}
            detail="everything"
            onPick={() => {
              onAs(undefined)
              setOpen(false)
            }}
          >
            the Domain
          </Row>
          {identities.map((one) => (
            <Row
              key={one.id}
              current={one.id === as}
              detail={one.className}
              title={one.id}
              onPick={() => {
                onAs(one.id)
                setOpen(false)
              }}
            >
              {one.label}
            </Row>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Scale({ factor, onFactor }: Pick<QuestionBarProps, 'factor' | 'onFactor'>) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="group"
        aria-label="Size the dataset is read at"
        className="inline-flex h-6 items-center rounded-md bg-muted p-0.5"
      >
        {FACTORS.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === factor}
            data-ask-factor={each}
            title={
              each === 1 ? 'The dataset as written' : `The dataset laid down ${each} times (faked)`
            }
            onClick={() => onFactor(each)}
            className={cn(
              'h-5 whitespace-nowrap rounded px-1.5 text-[11.5px] tabular-nums transition-colors',
              each === factor
                ? 'bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            ×{each}
          </button>
        ))}
      </span>
      {factor > 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-dashed border-warning/60 px-1.5 text-[10.5px] text-warning">
              <FlaskConical aria-hidden className="h-3 w-3" />
              faked
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-72">
            The dataset as written, laid down {factor} times with its identities shared: a stand-in
            for a dataset drawn from a Shape, to read the level at size.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

/** What every tab says over a dataset's map: which dataset, at what size, and who reads it. */
export interface DataBarProps {
  datasetName: string
  nodes: number
  edges: number
  factor: number
  onFactor: (factor: number) => void
  onDatasets: () => void
  /** what stands at the right of the first line: who asks */
  aside?: ReactNode
  /** the tab's own line: the question it answers */
  children: ReactNode
}

/**
 * The bar over a dataset's map: the dataset and its size on one line, the question the tab
 * answers on the next. The same under every tab, so a reader always knows what is read, at
 * what size and as whom.
 */
export function DataBar(props: DataBarProps) {
  return (
    <div data-testid="question-bar" className="shrink-0 space-y-2 border-b bg-card/50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-testid="dataset-label"
          onClick={props.onDatasets}
          title="Every dataset of this Domain"
          className={cn(
            'inline-flex h-7 min-w-28 max-w-64 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium transition-colors hover:bg-primary/10 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0',
            DATA_ACCENT,
          )}
        >
          <DATA_GLYPH aria-hidden />
          <span className="truncate">{props.datasetName}</span>
          <LayoutGrid aria-hidden className="text-muted-foreground" />
        </button>
        {/* the first to give way on a narrow map: the panel and the measure say it too */}
        <span className="min-w-0 shrink-[4] truncate text-[12px] tabular-nums text-muted-foreground">
          {counted(props.nodes)} {plural('Node', props.nodes)} · {counted(props.edges)}{' '}
          {plural('Edge', props.edges)}
        </span>
        <Scale factor={props.factor} onFactor={props.onFactor} />
        <span className="ml-auto" />
        {props.aside}
      </div>
      {props.children}
    </div>
  )
}

/** A tab's line of the bar: its glyph in the Data accent, what it reads, then what it found. */
export function BarLine({
  glyph: Glyph,
  title,
  children,
}: {
  glyph: typeof Ruler
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
      <Glyph aria-hidden className={cn('h-3.5 w-3.5 shrink-0', DATA_ACCENT)} />
      <span data-ask-title className="shrink-0 text-[13px] font-semibold">
        {title}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">{children}</span>
    </div>
  )
}

/** How many free optional slots a Query shows before the rest fold behind a count. */
const FREE_SHOWN = 3

export function QuestionBar(props: QuestionBarProps) {
  const { definition, counts, hidden, approximate } = props
  const asLabel = props.identities.find((one) => one.id === props.as)?.label
  // A slot the Query requires or the question holds is always shown; of the free optional ones
  // the first few, the rest behind a count the reader opens.
  const [all, setAll] = useState<string>()
  const everyone = all === definition?.id
  let free = 0
  const shown = props.slots.filter((slot) => {
    if (everyone || !slot.optional || props.values[slot.id]?.length) return true
    free += 1
    return free <= FREE_SHOWN
  })
  const folded = props.slots.filter((slot) => !shown.includes(slot))
  return (
    <DataBar
      datasetName={props.datasetName}
      nodes={props.nodes}
      edges={props.edges}
      factor={props.factor}
      onFactor={props.onFactor}
      onDatasets={props.onDatasets}
      aside={
        <AsChip
          identities={props.identities}
          as={props.as}
          {...(props.deciding === undefined ? {} : { deciding: props.deciding })}
          onAs={props.onAs}
        />
      }
    >
      {definition ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Search aria-hidden className={cn('h-3.5 w-3.5 shrink-0', DATA_ACCENT)} />
            <span data-ask-title className="truncate text-[13px] font-semibold">
              {titleOf(definition)}
            </span>
          </span>
          {shown.map((slot) => (
            <SlotChip
              key={slot.id}
              slot={slot}
              value={props.values[slot.id]}
              {...(props.picked[slot.id] ? { why: props.picked[slot.id] } : {})}
              labelOf={props.labelOf}
              candidatesOf={props.candidatesOf}
              valuesOf={props.valuesOf}
              onValue={(values) => props.onValue(slot.id, values)}
            />
          ))}
          {props.slots.length > shown.length && (
            <button
              type="button"
              data-ask-more
              onClick={() => setAll(definition.id)}
              title={`Also takes ${folded.map((slot) => slot.label).join(', ')}`}
              className={cn(CHIP, 'border-dashed text-muted-foreground')}
            >
              +{folded.length} more
            </button>
          )}
          <span className="ml-auto inline-flex min-w-0 items-center gap-2">
            <span
              data-ask-summary
              className="truncate text-[12px] tabular-nums text-muted-foreground"
            >
              {props.deciding !== undefined
                ? `Deciding what ${asLabel ?? 'the identity'} may read…`
                : counts.length === 0 || counts[0]!.count === 0
                  ? 'Nothing matches'
                  : counts
                      .map((each) => `${counted(each.count)} ${plural(each.label, each.count)}`)
                      .join(' · ')}
              {props.deciding === undefined && hidden > 0 && (
                <span className="text-warning">
                  {' '}
                  · {counted(hidden)} withheld{asLabel ? ` from ${asLabel}` : ''}
                </span>
              )}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-ask-approximate
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed px-1.5 text-[10.5px] text-muted-foreground"
                >
                  <Info aria-hidden className="h-3 w-3" />
                  approximate
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-80">
                <p className="mb-1 font-medium">The Studio runs no Kernel.</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {approximate.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-label="Close the Query"
              title="Back to the dataset, measured"
              onClick={props.onClose}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ) : (
        <BarLine glyph={Ruler} title="Measured against its Schema">
          {props.breaches === 0
            ? 'every end holds as many links as it declares'
            : `${props.breaches} ${props.breaches === 1 ? 'end breaks' : 'ends break'} what ${props.breaches === 1 ? 'it declares' : 'they declare'}`}
        </BarLine>
      )}
    </DataBar>
  )
}
