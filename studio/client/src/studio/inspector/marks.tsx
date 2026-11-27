import type { DefinitionPreconditionKind } from '@shared/contracts/schema'
import type { Bump } from '@shared/contracts/versions'
import type { CSSProperties } from 'react'

/**
 * The Inspector's marks: what a reader tells apart without reading. A Class wears its icon in
 * its module's hue, as its card does; a section the glyph and hue of what it lists, the same as
 * the canvas and the Index give it; a value its kind's glyph; a required value its own mark; a
 * count the Schema's notation. A hue says one thing, the one `canvas/tones.ts` gives it.
 */
import {
  ArrowRightFromLine,
  ArrowRightToLine,
  Asterisk,
  Binary,
  Box,
  Braces,
  Calendar,
  CalendarClock,
  Circle,
  CircleCheck,
  CircleDot,
  CircleQuestionMark,
  CircleSlash,
  ClipboardCheck,
  Equal,
  Eye,
  Hash,
  Link,
  Link2,
  List,
  ListChecks,
  type LucideIcon,
  AtSign,
  Ban,
  PencilLine,
  Pin,
  Plug,
  Plus,
  Route,
  Rows3,
  SearchCheck,
  ShieldCheck,
  Spline,
  SquareFunction,
  TextSearch,
  Timer,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Type,
  Unlink2,
  Workflow,
  Wrench,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { DeletionOutcome } from '../lenses/deletion'
import type { Lifetime } from '../lenses/lifetimes'
import type { SceneTone } from '../scene/types'
import type { ClassLink, Count, MarkKind, ValueKind } from './structure'

import { moduleTint } from '../../schema-studio/palette'
import { SchemaIcon } from '../../schema-studio/schema-icon'
import { TONE_COLOR } from '../canvas/tones'

/** The colour a Class wears: its module's hue, a relationship's, another Domain's quiet one. */
export function classColor(link: ClassLink): string {
  if (link.relationship) return TONE_COLOR.edge
  if (link.hue !== undefined) return moduleTint(link.hue).mark
  return TONE_COLOR[link.domain === undefined ? 'node' : 'muted']
}

/** A Class's icon in its colour: its own when it has one, else the glyph of what it is. */
export function ClassGlyph({ link, className }: { link: ClassLink; className?: string }) {
  const style = { color: classColor(link) }
  const size = cn('h-[1em] w-[1em] shrink-0', className)
  if (link.icon !== undefined)
    return (
      <span aria-hidden className="inline-flex shrink-0">
        <SchemaIcon svg={link.icon} className={size} style={style} />
      </span>
    )
  const Glyph = link.relationship ? Spline : Box
  return <Glyph className={size} style={style} aria-hidden />
}

/** What a section lists, as the canvas and the Index mark it: a glyph, and a hue when it has one. */
export type SectionKind =
  | 'properties'
  | 'relationships'
  | 'ends'
  | 'constraints'
  | 'policies'
  | 'calls'
  | 'reads'
  | 'writes'
  | 'preconditions'
  | 'input'
  | 'output'
  | 'integrations'
  | 'methods'
  | 'functions'
  | 'lifecycle'
  | 'deletion'
  | 'untold'

/**
 * A section's mark: a glyph in a hue. The Schema's sections take theirs from `SECTION_MARKS`; a
 * level's own, for what the Schema has no section for, comes from that level's marks.
 */
export interface SectionMark {
  readonly glyph: LucideIcon
  readonly tone: SceneTone
}

export const SECTION_MARKS: Record<SectionKind, SectionMark> = {
  properties: { glyph: Rows3, tone: 'node' },
  relationships: { glyph: Spline, tone: 'edge' },
  ends: { glyph: Spline, tone: 'edge' },
  constraints: { glyph: ListChecks, tone: 'what' },
  policies: { glyph: ShieldCheck, tone: 'who' },
  calls: { glyph: Workflow, tone: 'call' },
  reads: { glyph: Eye, tone: 'read' },
  // Writing is each verb's: the section's rows wear them, and its head counts them in theirs.
  writes: { glyph: PencilLine, tone: 'muted' },
  // What must hold before a mutation writes: a condition, in the hue of what must hold.
  preconditions: { glyph: ClipboardCheck, tone: 'what' },
  input: { glyph: ArrowRightToLine, tone: 'fn' },
  output: { glyph: ArrowRightFromLine, tone: 'fn' },
  integrations: { glyph: Plug, tone: 'call' },
  methods: { glyph: SquareFunction, tone: 'fn' },
  functions: { glyph: SquareFunction, tone: 'fn' },
  lifecycle: { glyph: Route, tone: 'transition' },
  deletion: { glyph: Trash2, tone: 'delete' },
  untold: { glyph: CircleQuestionMark, tone: 'muted' },
}

/**
 * What deleting a Node does to a link, as a mark: `detach` unlinks it, in the unlink hue;
 * `restrict` stops the deletion, in the delete hue — as the canvas marks an end that restricts.
 */
export const LIFETIME_MARKS: Record<Lifetime, { glyph: LucideIcon; tone: SceneTone }> = {
  detach: { glyph: Unlink2, tone: 'unlink' },
  restrict: { glyph: Ban, tone: 'delete' },
}

/**
 * What becomes of a deleted Node's links, as a mark: those that stop it wear the restrict mark
 * in the delete hue; those the reading cannot follow, a question; those the mutation unlinks
 * itself, the mark of what a mutation writes, in the unlink hue; those the Kernel unlinks with
 * it, the detach mark.
 */
const DELETION_MARKS: Record<DeletionOutcome, { glyph: LucideIcon; tone: SceneTone }> = {
  refused: { glyph: Ban, tone: 'delete' },
  untold: { glyph: CircleQuestionMark, tone: 'warning' },
  unlinked: { glyph: SECTION_MARKS.writes.glyph, tone: 'unlink' },
  detached: LIFETIME_MARKS.detach,
}

export function DeletionMark({
  outcome,
  className,
}: {
  outcome: DeletionOutcome
  className?: string
}) {
  const { glyph: Glyph, tone } = DELETION_MARKS[outcome]
  return (
    <Glyph
      aria-hidden
      data-deletion-mark={outcome}
      className={cn('h-[1em] w-[1em] shrink-0', className)}
      style={{ color: TONE_COLOR[tone] }}
    />
  )
}

/** What a precondition requires, by its kind, as a mark in the hue of what must hold. */
const PRECONDITION_GLYPHS: Record<DefinitionPreconditionKind, LucideIcon> = {
  node: CircleCheck,
  edge: Link,
  none: CircleSlash,
  exists: SearchCheck,
  count: Hash,
  unchanged: Equal,
  query: TextSearch,
}

export function PreconditionMark({
  kind,
  className,
}: {
  kind: DefinitionPreconditionKind
  className?: string
}) {
  const Glyph = PRECONDITION_GLYPHS[kind]
  return (
    <Glyph
      aria-hidden
      data-precondition-mark={kind}
      className={cn('h-[1em] w-[1em] shrink-0', className)}
      style={{ color: TONE_COLOR[SECTION_MARKS.preconditions.tone] }}
    />
  )
}

/** A lifetime's mark, in its hue. */
export function LifetimeMark({ lifetime, className }: { lifetime: Lifetime; className?: string }) {
  const { glyph: Glyph, tone } = LIFETIME_MARKS[lifetime]
  return (
    <Glyph
      aria-hidden
      data-lifetime-mark={lifetime}
      className={cn('h-[1em] w-[1em] shrink-0', className)}
      style={{ color: TONE_COLOR[tone] }}
    />
  )
}

/**
 * A version bump's mark, by what the platform's rule asks it for: a requirement the last
 * Publication satisfied and no longer does (major) wears the deleting verb's hue and a warning,
 * an addition (minor) the creating one's, any other change (patch) the updating one's. A
 * breaking change never reads as an addition.
 */
export const BUMP_MARKS: Record<Bump, SectionMark & { readonly title: string }> = {
  major: {
    glyph: TriangleAlert,
    tone: 'delete',
    title: 'A major bump: a requirement the last Publication satisfied no longer holds',
  },
  minor: { glyph: Plus, tone: 'create', title: 'A minor bump: an addition' },
  patch: { glyph: Wrench, tone: 'update', title: 'A patch: any other change' },
}

/** A section's glyph, in its hue: a Schema section's by its kind, or a mark of a level's own. */
export function SectionGlyph({ kind }: { kind: SectionKind | SectionMark }) {
  const { glyph: Glyph, tone } = typeof kind === 'string' ? SECTION_MARKS[kind] : kind
  return (
    <Glyph
      aria-hidden
      data-section-mark={typeof kind === 'string' ? kind : ''}
      className="h-3.5 w-3.5 shrink-0 self-center"
      style={{ color: TONE_COLOR[tone] }}
    />
  )
}

/** Tones side by side as dots: the verbs a section's rows wear. */
export function ToneDots({ tones }: { tones: readonly SceneTone[] }) {
  if (tones.length === 0) return null
  return (
    <span className="flex items-center gap-1 self-center" data-tone-dots={tones.join(' ')}>
      {tones.map((tone) => (
        <span
          key={tone}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: TONE_COLOR[tone] }}
        />
      ))}
    </span>
  )
}

const VALUE_GLYPHS: Record<Exclude<ValueKind, 'reference'>, LucideIcon> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  datetime: CalendarClock,
  url: Link2,
  email: AtSign,
  choice: CircleDot,
  list: List,
  object: Braces,
  state: Route,
  binary: Binary,
  value: Circle,
}

/**
 * A value's kind as a mark: its glyph, quiet; a reference wears the Class it refers to, a state
 * the lifecycle's hue.
 */
export function ValueMark({
  kind,
  refs,
  type,
}: {
  kind: ValueKind
  refs?: readonly ClassLink[]
  /** its type in words, read on hover */
  type: string
}) {
  const first = refs?.[0]
  if (kind === 'reference' && first !== undefined)
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center text-[13px]"
        data-value-mark="reference"
        title={type}
      >
        <ClassGlyph link={first} />
      </span>
    )
  const Glyph = kind === 'reference' ? Box : VALUE_GLYPHS[kind]
  return (
    <span
      className="flex h-4 w-4 shrink-0 items-center justify-center"
      data-value-mark={kind}
      title={type}
    >
      <Glyph
        aria-hidden
        className={cn('h-3.5 w-3.5', kind !== 'state' && 'text-muted-foreground')}
        style={kind === 'state' ? { color: TONE_COLOR.transition } : undefined}
      />
    </span>
  )
}

/** A required value's mark, after its name. */
export function RequiredMark() {
  return (
    <span
      role="img"
      aria-label="required"
      title="Required: every one has a value."
      data-required-mark=""
      className="inline-flex h-3 w-3 shrink-0 items-center justify-center self-center text-foreground/80"
    >
      <Asterisk aria-hidden className="h-3 w-3" strokeWidth={2.6} />
    </span>
  )
}

const PROPERTY_GLYPHS: Record<Exclude<MarkKind, 'required'>, LucideIcon> = {
  immutable: Pin,
  automatic: Timer,
  searchable: TextSearch,
}

/** A Property's other marks, a quiet glyph each, its meaning on hover. */
export function PropertyMarks({
  marks,
}: {
  marks: readonly { kind: MarkKind; label: string; meaning: string }[]
}) {
  const shown = marks.filter((mark) => mark.kind !== 'required')
  if (shown.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 self-center text-muted-foreground">
      {shown.map((mark) => {
        const Glyph = PROPERTY_GLYPHS[mark.kind as Exclude<MarkKind, 'required'>]
        return (
          <span
            key={mark.kind}
            role="img"
            aria-label={mark.label}
            title={`${mark.label}: ${mark.meaning}`}
            data-property-mark={mark.kind}
          >
            <Glyph aria-hidden className="h-3 w-3" />
          </span>
        )
      })}
    </span>
  )
}

/** A count as the Schema writes it (`0..1`), its words on hover. */
export function CountMark({ count, className }: { count: Count; className?: string }) {
  return (
    <span
      data-count-mark={count.declared}
      title={count.words}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded border border-(--count-tone) px-1 font-mono text-[10.5px] leading-none text-(--count-tone)',
        className,
      )}
      style={{ '--count-tone': TONE_COLOR.edge } as CSSProperties}
    >
      {count.declared}
    </span>
  )
}
