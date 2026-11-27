/**
 * The Workspace level's marks. Wherever the map marks something the page wears the same mark: a
 * Domain its card's glyph; a dependency's verdict its link's tone (`verdictTone`), as a badge the map's badge colours paint
 * (`TONE_CHIP`); what became of a Key of the Schema the tone of the Schema's verb that would do
 * it — added creates, removed deletes, changed updates; and a Key its Schema mark — a Class its
 * icon in its module's hue, a property, a method, a function, a Policy, an Integration their
 * section's glyph and hue.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'
import type { Bump, ChangeReport, PublicationChange } from '@shared/contracts/versions'
import type { ReactNode } from 'react'

import { parseClassRefKey } from '@shared/schema/identity'
import { useQuery } from '@tanstack/react-query'
import {
  BellRing,
  Check,
  CircleQuestionMark,
  CloudUpload,
  Equal,
  FileDiff,
  Library,
  type LucideIcon,
  Milestone,
  Package,
  Scale,
  Server,
  TriangleAlert,
} from 'lucide-react'

import { api } from '@/lib/api'
import { bundleQueryOptions } from '@/lib/domain-queries'
import { cn } from '@/lib/utils'

import type { SceneTone } from '../scene/types'
import type { LinkVerdict } from './project'

import { GLYPHS } from '../canvas/glyphs'
import { TONE_CHIP, TONE_COLOR, TONE_TEXT } from '../canvas/tones'
import {
  BUMP_MARKS,
  ClassGlyph,
  type SectionKind,
  type SectionMark,
  SectionGlyph,
} from '../inspector/marks'
import { BumpChip, Fold, Meta, Sublabel } from '../inspector/parts'
import { classLink } from '../inspector/structure'
import { verdictTone } from './project'
import {
  capital,
  changeParts,
  changesByBump,
  changeSentence,
  counted,
  keyWords,
  reasonSentence,
  reportVerdict,
} from './words'

/**
 * A Domain as the map draws its card: the module glyph, in a workspace Domain's tone, or muted for
 * one outside the Workspace.
 */
export function DomainGlyph({
  outside = false,
  className,
}: {
  outside?: boolean
  className?: string
}) {
  const Glyph = GLYPHS.module
  return (
    <Glyph
      aria-hidden
      data-domain-mark={outside ? 'outside' : 'workspace'}
      className={cn('inline-block h-3.5 w-3.5 shrink-0 align-[-0.15em]', className)}
      style={{ color: TONE_COLOR[outside ? 'muted' : 'node'] }}
    />
  )
}

/** A verdict's glyph: it breaks, it means the same, it holds, or it is not known yet. */
function verdictGlyph(verdict: LinkVerdict, equivalent: boolean): LucideIcon {
  if (verdict.breaks) return TriangleAlert
  if (!verdict.judged) return CircleQuestionMark
  return equivalent ? Equal : Check
}

/**
 * A verdict as the map's link says it: its glyph and its words, in the link's tone. `equivalent`
 * when the version means exactly what was built against.
 */
export function VerdictBadge({
  verdict,
  equivalent = false,
  className,
  ...rest
}: {
  verdict: LinkVerdict & { readonly label: string }
  equivalent?: boolean
  className?: string
} & Record<`data-${string}`, string | undefined>) {
  const tone = verdictTone(verdict)
  const Glyph = verdictGlyph(verdict, equivalent)
  return (
    <span
      title={verdict.title}
      data-verdict-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap',
        TONE_CHIP[tone],
        className,
      )}
      {...rest}
    >
      <Glyph aria-hidden className="h-3 w-3 shrink-0" />
      {verdict.label}
    </span>
  )
}

/** What became of a Key, as the Schema's verb that would do it. */
export type KeyFate = 'added' | 'removed' | 'changed' | 'same'

export const FATE_TONES: Record<KeyFate, SceneTone> = {
  added: 'create',
  removed: 'delete',
  changed: 'update',
  same: 'muted',
}

/** The section a Key's kind is listed in on the Schema, which gives it its glyph and hue. */
const KEY_SECTIONS: Partial<Record<string, SectionKind>> = {
  property: 'properties',
  method: 'methods',
  function: 'functions',
  Policy: 'policies',
  Integration: 'integrations',
}

/**
 * A Key's mark: a Class its icon in its module's hue where `bundle` — the Schema it is read in —
 * defines it, the Class glyph where it does not; any other kind its section's glyph; none for a
 * kind the Schema gives no mark.
 */
export function KeyGlyph({ subject, bundle }: { subject: string; bundle?: StudioSchemaBundle }) {
  const words = keyWords(subject)
  if (words.noun === 'Class') {
    const ref = parseClassRefKey(subject)
    const link =
      bundle && ref ? classLink(bundle, ref) : { target: subject, name: words.name, open: false }
    return (
      <span data-key-mark="Class" className="inline-flex shrink-0 self-center">
        <ClassGlyph link={link} className="h-3.5 w-3.5" />
      </span>
    )
  }
  const kind = KEY_SECTIONS[words.noun]
  return kind ? <SectionGlyph kind={kind} /> : null
}

/**
 * The Schema a Domain's Keys are marked by, as every reader holds it: read at background priority,
 * and only by a line that marks a Key, so a page pays for no Schema it shows nothing of; none
 * for no Domain (`''`).
 */
export function useMarkingBundle(domainId: string): StudioSchemaBundle | undefined {
  return useQuery({
    ...bundleQueryOptions(domainId),
    queryFn: () => api.bundle(domainId, 'background'),
    enabled: domainId !== '',
  }).data
}

/** A sentence about a Key: its mark, the Key, what became of it in its fate's tone, the rest. */
export function KeyLine({
  subject,
  bundle,
  fate,
  parts,
  className,
  children,
  ...rest
}: {
  subject: string
  bundle?: StudioSchemaBundle
  fate: KeyFate
  parts: { readonly subject: string; readonly verb: string; readonly rest: string }
  className?: string
  children?: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <p
      className={cn('flex items-baseline gap-1.5 text-[13px] leading-relaxed', className)}
      data-key-fate={fate}
      {...rest}
    >
      <KeyGlyph subject={subject} bundle={bundle} />
      <span>
        {parts.subject} <span className={TONE_TEXT[FATE_TONES[fate]]}>{parts.verb}</span>
        {parts.rest}
        {children}
      </span>
    </p>
  )
}

/** What became of a Key since the last Publication, as the Schema's verb that would do it. */
const CHANGE_FATES: Record<PublicationChange['state'], KeyFate> = {
  added: 'added',
  missing: 'removed',
  changed: 'changed',
}

/**
 * One change since the last Publication: its Key's mark, the Key, what became of it in its verb's
 * tone; a change of the build or of the revision alone, which names no Key, in words alone.
 */
export function ChangeLine({
  change,
  origin,
  domainId,
  className,
}: {
  change: PublicationChange
  origin: string
  /** the Domain whose Schema marks its Key */
  domainId: string
  className?: string
}) {
  const parts = changeParts(change, origin)
  const bundle = useMarkingBundle(parts ? domainId : '')
  if (!parts)
    return (
      <p className={cn('text-[13px] leading-relaxed', className)}>
        {changeSentence(change, origin)}
      </p>
    )
  return (
    <KeyLine
      subject={change.subject}
      bundle={bundle}
      fate={CHANGE_FATES[change.state]}
      parts={parts}
      className={className}
    />
  )
}

/**
 * The Workspace pages' sections, each marked by what it lists in the hue the map gives that: the
 * Domains a Domain card's glyph, in the Workspace's tone or muted outside it; the dependencies a
 * link's glyph; a Publication a package. A section whose hue is a judgement takes it from the
 * judgement (`toned`): a standing its badge's, the changes their highest bump's, links their
 * verdicts'.
 */
export const WORKSPACE_SECTIONS = {
  standing: { glyph: Milestone, tone: 'muted' },
  changes: { glyph: FileDiff, tone: 'muted' },
  publish: { glyph: CloudUpload, tone: 'create' },
  environment: { glyph: Server, tone: 'muted' },
  dependencies: { glyph: GLYPHS.relationship, tone: 'edge' },
  verdicts: { glyph: Scale, tone: 'muted' },
  published: { glyph: Package, tone: 'node' },
  publications: { glyph: Package, tone: 'muted' },
  attention: { glyph: BellRing, tone: 'warning' },
  domains: { glyph: GLYPHS.module, tone: 'node' },
  others: { glyph: GLYPHS.module, tone: 'muted' },
  registry: { glyph: Library, tone: 'muted' },
} as const satisfies Record<string, SectionMark>

/** A section's mark in the hue of what it judges, or its own when nothing is judged yet. */
export function toned(mark: SectionMark, tone: SceneTone | undefined): SectionMark {
  return tone === undefined ? mark : { glyph: mark.glyph, tone }
}

/** The hue of several links, as the map paints the worst of them: one breaks, all hold, or not yet. */
export function linksTone(verdicts: readonly LinkVerdict[]): SceneTone | undefined {
  if (verdicts.some((verdict) => verdict.breaks)) return 'warning'
  if (verdicts.length > 0 && verdicts.every((verdict) => verdict.judged)) return 'success'
  return undefined
}

/** The hue of the changes: their highest bump's, which a reader meets first. */
export function changesTone(report: ChangeReport | undefined): SceneTone | undefined {
  const highest = report && changesByBump(report.changes)[0]
  return highest && BUMP_MARKS[highest.bump].tone
}

/** A bump as a sentence's object, its level a chip: `a [major] bump`, `a [patch]`. */
export function BumpPhrase({ bump }: { bump: Bump }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      a <BumpChip bump={bump} />
      {bump === 'patch' ? '' : ' bump'}
    </span>
  )
}

/** The report's verdict as `reportVerdict` says it, the bump it requires as its chip. */
export function ReportSentences({
  report,
  className,
}: {
  report: ChangeReport
  className?: string
}) {
  return (
    <>
      {reportVerdict(report).map((sentence, index) => (
        <p key={index} className={className}>
          {typeof sentence === 'string' ? (
            sentence
          ) : (
            <span data-report-requires={sentence.requires}>
              They require <BumpPhrase bump={sentence.requires} />
              {sentence.effective !== undefined && (
                <>
                  ; under the 0.x rule that is <BumpPhrase bump={sentence.effective} />
                </>
              )}
              .
            </span>
          )}
        </p>
      ))}
    </>
  )
}

/**
 * Changes by the bump each requires, highest first: a group headed by its count and its bump's
 * chip, and ruled in its bump's hue down every change it holds, so a breaking change reads as one
 * before its sentence is read.
 */
export function ChangeGroups({
  changes,
  origin,
  domainId,
  limit,
  reasons = false,
  lineClassName,
}: {
  changes: readonly PublicationChange[]
  origin: string
  /** the Domain whose Schema marks the Keys */
  domainId: string
  /** how many changes of a group show before the rest fold */
  limit: number
  /** each change's reason under it */
  reasons?: boolean
  lineClassName?: string
}) {
  return (
    <>
      {changesByBump(changes).map((group) => (
        <div
          key={group.bump}
          className="space-y-1 border-l-2 pl-2.5"
          style={{
            borderColor: `color-mix(in oklch, ${TONE_COLOR[BUMP_MARKS[group.bump].tone]} 55%, transparent)`,
          }}
          data-bump={group.bump}
        >
          <Sublabel>
            {capital(counted(group.changes.length, 'change'))} that{' '}
            {group.changes.length === 1 ? 'requires' : 'require'} <BumpPhrase bump={group.bump} />
          </Sublabel>
          <Fold
            rows
            limit={limit}
            items={group.changes}
            more={(count) => `Show ${count} more changes`}
            render={(change, index) => (
              <div
                key={`${change.subject}:${change.facet}:${index}`}
                className={reasons ? 'space-y-0.5 py-1.5' : 'py-1'}
              >
                <ChangeLine
                  change={change}
                  origin={origin}
                  domainId={domainId}
                  className={lineClassName}
                />
                {reasons && <Meta>{reasonSentence(change.reason)}</Meta>}
              </div>
            )}
          />
        </div>
      ))}
    </>
  )
}
