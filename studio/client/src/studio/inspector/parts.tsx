import type { Bump } from '@shared/contracts/versions'

/**
 * The Inspector's page parts: a title block, quiet sections, links that open what they name,
 * lists that fold with a count, and the switches to the other two questions. One type scale
 * (18 title · 13 body · 12 secondary · 11 labels), no boxes inside the page, mono for
 * identifiers only.
 */
import { type LucideIcon, TextSearch } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import type { LensKey } from '@/studio/lenses/keys'

import { AnchorButton, useRevealedAnchor } from '@/components/anchor'
import { DescriptionText } from '@/components/studio-kit'
import { useUI } from '@/lib/store'
import { anchorData, targetSurface } from '@/lib/targets'
import { cn } from '@/lib/utils'

import type { SceneTone } from '../scene/types'
import type { ClassLink, Phrase, PropertyMark, ValueType } from './structure'
import type { LensSwitch } from './switches'

import { GLYPHS } from '../canvas/glyphs'
import { TONE_COLOR, TONE_TEXT } from '../canvas/tones'
import {
  BUMP_MARKS,
  ClassGlyph,
  classColor,
  PropertyMarks,
  RequiredMark,
  type SectionKind,
  SectionGlyph,
  type SectionMark,
  ToneDots,
  ValueMark,
} from './marks'

/**
 * Opens a selection: the Studio selects it, the canvas brings it into view. A Method named as a
 * rule names it (`class.X.method.m`) opens as the function the canvas draws (`function.X.m`).
 */
export function openTarget(target: string, domainId: string) {
  const method = /^(?:class|edge)\.([^:]+)\.method\.([^.]+)$/.exec(target)
  const id = method === null ? target : `function.${method[1]}.${method[2]}`
  const ui = useUI.getState()
  ui.openSchema()
  ui.selectClass(id, domainId)
  ui.revealOnCanvas(id)
}

/**
 * Text that opens a selection. Without a target, or with the one the Schema already shows, it
 * is said, not linked: a page never links to itself. At another level (Data, the Workspace) it
 * links, since it opens the Schema there.
 */
export function Link({
  target,
  domainId,
  children,
  mono = false,
  title,
  className,
}: {
  target?: string
  domainId: string
  children: ReactNode
  mono?: boolean
  title?: string
  className?: string
}) {
  const here = useUI(
    (state) =>
      target !== undefined &&
      state.level === 'domain' &&
      state.selectedClass === target &&
      state.selectionDomainId === domainId,
  )
  if (target === undefined || here)
    return <span className={cn(mono && 'font-mono text-[0.92em]', className)}>{children}</span>
  return (
    <button
      type="button"
      title={title}
      data-inspector-link={target}
      onClick={(event) => {
        event.stopPropagation()
        openTarget(target, domainId)
      }}
      className={cn(
        'inline rounded-sm text-left underline decoration-foreground/20 underline-offset-[3px] transition-colors hover:decoration-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        mono ? 'font-mono text-[0.92em]' : 'font-medium',
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * A row's comment anchor: the row is commentable under `anchor`, and when a thread on it is
 * opened from elsewhere it is outlined and scrolled into view.
 */
export function useAnchorReveal(anchor: string, excerpt: string) {
  return { ...anchorData(anchor, excerpt), ...useRevealedAnchor(anchor) }
}

/**
 * A Class as the page names it, wherever it does: its icon in its module's hue, then its name,
 * a link when it opens, its Domain after it when not this one.
 */
export function ClassName({
  link,
  domainId,
  text,
  mono = false,
  glyph = true,
}: {
  link: ClassLink
  domainId: string
  text?: string
  /** a relationship, said by its declared name */
  mono?: boolean
  /** whether its icon leads it: not where the row it names already opens with it */
  glyph?: boolean
}) {
  return (
    <>
      {/* its icon never parts from its name at a line's end */}
      <span className="whitespace-nowrap">
        {glyph && <ClassGlyph link={link} className="mr-[0.3em] inline-block align-[-0.15em]" />}
        <Link
          target={link.open ? link.target : undefined}
          domainId={domainId}
          mono={mono}
          title={link.domain === undefined ? undefined : `${link.name} (${link.domain})`}
        >
          {text ?? link.name}
        </Link>
      </span>
      {link.domain !== undefined && <span className="text-muted-foreground"> ({link.domain})</span>}
    </>
  )
}

// The glyph and hue each wears on its card and Index row.
const CALLABLE_MARKS = {
  function: { glyph: GLYPHS.function, tone: 'fn' },
  mutation: { glyph: GLYPHS.mutation, tone: 'fn' },
  query: { glyph: TextSearch, tone: 'fn' },
  integration: { glyph: GLYPHS.integration, tone: 'muted' },
} as const satisfies Record<string, { glyph: LucideIcon; tone: SceneTone }>

/**
 * A callable, a mutation or query, or an Integration as the page names it, wherever it does: the
 * glyph its card and Index row wear, in their hue, then its name — a Method's Class before it,
 * quieter.
 */
export function CallableName({
  target,
  name,
  glyph,
  domainId,
}: {
  /** what it opens; none where it is said, not linked */
  target: string | undefined
  /** `Class.method`, a function's name, a mutation's or query's id, an Integration's key */
  name: string
  glyph: keyof typeof CALLABLE_MARKS
  domainId: string
}) {
  const { glyph: Glyph, tone } = CALLABLE_MARKS[glyph]
  const dot = glyph === 'function' ? name.lastIndexOf('.') : -1
  return (
    <span className="whitespace-nowrap" data-callable-name={name}>
      <Glyph
        aria-hidden
        className="mr-[0.3em] inline-block h-[1em] w-[1em] align-[-0.15em]"
        style={{ color: TONE_COLOR[tone] }}
      />
      <Link target={target} domainId={domainId} mono>
        {dot > 0 && <span className="text-muted-foreground">{name.slice(0, dot + 1)}</span>}
        {dot > 0 ? name.slice(dot + 1) : name}
      </Link>
    </span>
  )
}

/** A Class as a chip: its icon and name on a wash of its hue, its Domain after, quieter. */
export function ClassChip({ link, domainId }: { link: ClassLink; domainId: string }) {
  const color = classColor(link)
  return (
    <span
      data-class-chip={link.target}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 text-[12.5px] leading-[20px]"
      style={{
        borderColor: `color-mix(in oklch, ${color} 32%, transparent)`,
        background: `color-mix(in oklch, ${color} 7%, transparent)`,
      }}
    >
      <ClassGlyph link={link} className="text-[13px]" />
      <Link
        target={link.open ? link.target : undefined}
        domainId={domainId}
        mono={link.relationship === true}
        title={link.domain === undefined ? undefined : `${link.name} (${link.domain})`}
        className="min-w-0 truncate font-medium decoration-transparent hover:decoration-foreground/50"
      >
        {link.name}
      </Link>
      {link.domain !== undefined && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{link.domain}</span>
      )}
    </span>
  )
}

/**
 * A version bump as a chip, beside a Class's: its glyph and word in its hue, on a wash of it
 * (`BUMP_MARKS`); the platform's rule for it on hover.
 */
export function BumpChip({ bump }: { bump: Bump }) {
  const { glyph: Glyph, tone, title } = BUMP_MARKS[bump]
  const color = TONE_COLOR[tone]
  return (
    <span
      data-bump-chip={bump}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 text-[12px] font-medium leading-[20px]',
        TONE_TEXT[tone],
      )}
      style={{
        borderColor: `color-mix(in oklch, ${color} 32%, transparent)`,
        background: `color-mix(in oklch, ${color} 7%, transparent)`,
      }}
    >
      <Glyph aria-hidden className="h-3 w-3 shrink-0" />
      {bump}
    </span>
  )
}

/** A sentence as plain text: what a row drawn in marks says on hover. */
export const sentenceText = (phrases: readonly Phrase[]) =>
  phrases.map((phrase) => (typeof phrase === 'string' ? phrase : phrase.text)).join('')

/**
 * A value's line, for a Property and a callable's field alike: its kind's mark, its name —
 * heavier with a mark after it when it is required — then its type at the far edge (the Classes
 * of a reference as chips) and its other marks.
 */
export function ValueHead({
  name,
  value,
  required,
  marks = [],
  domainId,
  children,
}: {
  name: string
  value: ValueType
  required: boolean
  marks?: readonly PropertyMark[]
  domainId: string
  /** after it all: its comment button */
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ValueMark kind={value.kind} refs={value.refs ?? []} type={value.type} />
      <span
        className={cn(
          // The name says which value it is: its type gives way first.
          'max-w-[65%] shrink-0 truncate font-mono text-[12.5px] leading-5',
          required ? 'font-semibold' : 'text-foreground/85',
        )}
        title={name}
      >
        {name}
      </span>
      {required && <RequiredMark />}
      <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 text-[12px] text-muted-foreground">
        <TypeOf value={value} domainId={domainId} />
      </span>
      <PropertyMarks marks={marks} />
      {children}
    </div>
  )
}

/** A value with no name, as a callable's output: its kind's mark, then its type. */
export function ValueLine({ value, domainId }: { value: ValueType; domainId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px]">
      <ValueMark kind={value.kind} refs={value.refs ?? []} type={value.type} />
      <span className="flex min-w-0 items-center gap-1">
        <TypeOf value={value} domainId={domainId} />
      </span>
    </div>
  )
}

/** A type: a reference's Classes as chips (`list of` before them for a list), else its words. */
function TypeOf({ value, domainId }: { value: ValueType; domainId: string }) {
  const refs = value.refs ?? []
  if (refs.length === 0)
    return (
      <span className="truncate" title={value.type}>
        {value.type}
      </span>
    )
  return (
    <>
      {/^(?:List|Stream)/.test(value.type) && (
        <span className="shrink-0">
          {value.type.startsWith('Stream') ? 'stream of' : 'list of'}
        </span>
      )}
      {refs.slice(0, 2).map((ref) => (
        <ClassChip key={ref.target} link={ref} domainId={domainId} />
      ))}
      {refs.length > 2 && <span className="shrink-0">+{refs.length - 2}</span>}
    </>
  )
}

/** What a value says of itself, under its name, quieter. */
export function ValueNote({ text }: { text: string }) {
  return (
    <p className="line-clamp-2 pl-6 text-[12px] leading-relaxed text-muted-foreground" title={text}>
      {text}
    </p>
  )
}

/** A sentence whose Class names open them. */
export function Phrases({ phrases, domainId }: { phrases: readonly Phrase[]; domainId: string }) {
  return phrases.map((phrase, index) =>
    typeof phrase === 'string' ? (
      <span key={index}>{phrase}</span>
    ) : (
      <ClassName key={index} link={phrase.link} domainId={domainId} text={phrase.text} />
    ),
  )
}

/**
 * Names joined as a sentence lists them: `A, B and C`. Past `limit` the list ends with a quiet
 * `and N more` that says the rest when clicked.
 */
export function Joined({
  items,
  last = 'and',
  limit = Infinity,
}: {
  items: readonly ReactNode[]
  last?: 'and' | 'or'
  limit?: number
}) {
  const [open, setOpen] = useState(false)
  // folding a single name away saves nothing worth a click
  if (open || items.length <= limit + 1)
    return items.map((item, index) => (
      <span key={index}>
        {index > 0 && (index === items.length - 1 ? ` ${last} ` : ', ')}
        {item}
      </span>
    ))
  return (
    <>
      {items.slice(0, limit).map((item, index) => (
        <span key={index}>
          {index > 0 && ', '}
          {item}
        </span>
      ))}
      {` ${last} `}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        className="rounded-sm text-muted-foreground underline decoration-transparent underline-offset-[3px] transition-colors hover:text-foreground hover:decoration-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {items.length - limit} more
      </button>
    </>
  )
}

/**
 * The page's title block: what kind of thing it is, its name, and what it says of itself.
 * `anchor` is its comment anchor: the block is commentable, and shows its open threads.
 */
export function Title({
  kicker,
  name,
  mono = false,
  icon,
  description,
  domainId,
  anchor,
  file,
  children,
}: {
  kicker: ReactNode
  name: string
  mono?: boolean
  icon?: ReactNode
  description?: string
  domainId: string
  anchor: string
  file?: string
  children?: ReactNode
}) {
  return (
    <header className="space-y-2.5 pr-8">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon !== undefined && (
          <span className="flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        )}
        <span className="min-w-0 truncate">{kicker}</span>
      </div>
      <div className="flex items-start gap-2">
        <h2
          className={cn(
            'min-w-0 flex-1 break-words text-[18px] font-semibold leading-tight tracking-tight',
            mono && 'font-mono text-[16px] tracking-normal',
          )}
        >
          {name}
        </h2>
        <AnchorButton
          domainId={domainId}
          anchorRef={{ ref: anchor, kind: 'schema', ...(file === undefined ? {} : { file }) }}
          excerpt={name}
          className="mt-0.5"
        />
      </div>
      {description !== undefined && (
        <Description key={`${anchor}:${description}`} text={description} />
      )}
      {children}
    </header>
  )
}

/** Domain-authored prose, three lines until asked for more. */
function Description({ text }: { text: string }) {
  const id = useId()
  const element = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const node = element.current
    if (expanded || node === null) return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [text, expanded])
  return (
    <div>
      <DescriptionText
        ref={element}
        id={id}
        className={cn(
          'text-[13px] leading-relaxed text-muted-foreground',
          !expanded && 'line-clamp-3',
        )}
      >
        {text}
      </DescriptionText>
      {overflowing && (
        <button
          type="button"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/** One fact under the title: a quiet label, then the fact. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px] leading-relaxed">
      <span className="w-[4.5rem] shrink-0 pt-px text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

/**
 * A section of the page: what it lists as its glyph in its hue, a quiet label, its count, then
 * its content.
 */
export function Section({
  label,
  kind,
  count,
  tally,
  hint,
  children,
  ...rest
}: {
  label: string
  /**
   * what it lists, which gives it its glyph and hue: a Schema section's kind, or the mark a level
   * gives what the Schema has no section for (a Publication's standing, a verdict's outcome)
   */
  kind?: SectionKind | SectionMark
  count?: number
  /** the hues its rows wear, as dots after its count: the verbs of what it writes */
  tally?: readonly SceneTone[]
  hint?: ReactNode
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className="space-y-2.5" {...rest}>
      <h3 className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {kind !== undefined && <SectionGlyph kind={kind} />}
        {label}
        {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
        {tally !== undefined && <ToneDots tones={tally} />}
        {hint !== undefined && (
          <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
            {hint}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}

/** A sub-heading inside a section: `From Timestamped`, `Through FleetResource`. */
export function Sublabel({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-[12px] text-muted-foreground">{children}</p>
}

/** What is true when a section has nothing to list. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
}

/** A secondary line under an item. Its links are quiet: underlined only under the pointer. */
export function Meta({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      className={cn(
        'text-[12px] leading-relaxed text-muted-foreground [&_[data-inspector-link]:hover]:decoration-foreground/60 [&_[data-inspector-link]]:decoration-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * A list that shows its first `limit` items and folds the rest behind a count. `rows` lists
 * items with hairlines between them; otherwise they stand apart by spacing alone.
 */
export function Fold<T>({
  items,
  limit = 6,
  render,
  more = (count) => `Show ${count} more`,
  rows = false,
  className,
}: {
  items: readonly T[]
  limit?: number
  render: (item: T, index: number) => ReactNode
  more?: (count: number) => string
  rows?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // a fold that would hide a single item hides nothing worth a click
  const shown = open || items.length <= limit + 1 ? items : items.slice(0, limit)
  const hidden = items.length - shown.length
  return (
    <div className={className}>
      <div className={rows ? 'divide-y divide-border/60' : 'space-y-2'}>{shown.map(render)}</div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {more(hidden)}
        </button>
      )}
    </div>
  )
}

/** A disclosure: a quiet line that opens what it counts. */
export function Disclosure({
  label,
  children,
  initiallyOpen = false,
}: {
  label: ReactNode
  children: ReactNode
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const id = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex items-baseline gap-1.5 rounded-sm text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span
          aria-hidden
          className={cn('inline-block w-2.5 transition-transform', open && 'rotate-90')}
        >
          ›
        </span>
        {label}
      </button>
      {open && (
        <div id={id} className="mt-2 pl-4">
          {children}
        </div>
      )}
    </div>
  )
}

const LENS_LABEL: Record<LensKey, string> = {
  structure: 'Structure',
  behavior: 'Behavior',
  rules: 'Rules',
}

/** The other two questions, at the foot of the page; a click changes the lens and keeps the selection. */
export function LensSwitches({ switches }: { switches: readonly LensSwitch[] }) {
  const setLens = useUI((state) => state.setLens)
  if (switches.length === 0) return null
  return (
    <nav
      aria-label="Ask another question"
      data-inspector-switches=""
      className="space-y-1 border-t pt-4"
    >
      {switches.map((each) => (
        <button
          key={each.lens}
          type="button"
          data-lens-switch={each.lens}
          onClick={() => setLens(each.lens)}
          className="group flex w-full items-baseline gap-2 rounded-sm py-0.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="min-w-0 flex-1">{each.text}</span>
          <span className="shrink-0 text-[12px] font-medium text-foreground/70 group-hover:text-foreground">
            {LENS_LABEL[each.lens]} →
          </span>
        </button>
      ))}
    </nav>
  )
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex="0"]'

/**
 * The page's frame: its own scroll, the word card docked at its foot (the frame is the card's
 * containing block), and the arrow keys walking its links and buttons. Esc is left to the
 * Studio, which closes the panel, unless something inside the page claimed it first.
 *
 * The page is the Inspector surface: every target on it is found again on it, never on the
 * card or the Index row that draws the same element. `domainId` names the Domain the page
 * reads, which owns every target on it that does not name another.
 */
export function Page({
  children,
  domainId,
  ...rest
}: { children: ReactNode; domainId: string } & Record<`data-${string}`, string | undefined>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return
    const step =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'Home'
            ? -Infinity
            : event.key === 'End'
              ? Infinity
              : 0
    if (step === 0) return
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null,
    )
    if (stops.length === 0) return
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next =
      step === -Infinity
        ? 0
        : step === Infinity
          ? stops.length - 1
          : Math.min(stops.length - 1, Math.max(0, at < 0 ? 0 : at + step))
    event.preventDefault()
    stops[next]!.focus()
  }
  return (
    <div
      data-inspector=""
      {...targetSurface('inspector')}
      data-domain-id={domainId}
      className="inspector-frame flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
    >
      <div className="min-h-0 flex-1 overflow-y-auto" {...rest}>
        {/* the foot clears the agent dock that floats over the panel's lower corner */}
        <div className="space-y-8 px-5 pb-24 pt-5">{children}</div>
      </div>
    </div>
  )
}
