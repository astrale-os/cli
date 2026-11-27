/**
 * One dependency's compatibility, version by version: the revision built against and the
 * Publications that carry it, then each readable version (and the workspace copy) with the
 * verdict of the DSL's `compare`, and every requirement a version breaks, with where it is used.
 */

import type {
  CompatibilityMatrix,
  CompatibilityVerdict,
  DependencyCompatibility,
  DependencyStanding,
  Remote,
  UnsatisfiedAssessment,
} from '@shared/contracts/versions'

import { Chip } from '@/components/studio-kit'
import { relativeTime } from '@/lib/time'

import type { SceneBadge } from '../scene/types'
import type { Fact } from './facts'

import { BadgeView } from '../canvas/parts'
import { Disclosure, Empty, Fold, Meta } from '../inspector/parts'
import { type KeyFate, KeyLine, useMarkingBundle, VerdictBadge } from './marks'
import { FactView, RemoteNotice } from './remote'
import {
  builtAgainstSentence,
  capital,
  counted,
  differenceSentence,
  domainName,
  joined,
  keyText,
  tally,
  tallySentence,
  unsatisfiedParts,
  unsatisfiedSummary,
  usagesSentence,
  verdictGroups,
  verdictLabel,
  verdictSentence,
} from './words'

/** A version's verdict as the map's link says one: it breaks, it holds, or it means the same. */
function VersionVerdict({ verdict }: { verdict: CompatibilityVerdict }) {
  return (
    <VerdictBadge
      verdict={{ label: verdictLabel(verdict), breaks: !verdict.compatible, judged: true }}
      equivalent={verdict.compatible && verdict.equivalent}
      data-verdict={
        verdict.compatible ? (verdict.equivalent ? 'equivalent' : 'compatible') : 'breaks'
      }
    />
  )
}

/** What a compared version does to a requirement, as the Schema's verb that would do it. */
const UNSATISFIED_FATES: Record<UnsatisfiedAssessment['state'], KeyFate> = {
  missing: 'removed',
  added: 'added',
  changed: 'changed',
  equal: 'same',
}

/** One unsatisfied requirement: what the version does to it, what differs, and who uses it. */
function Requirement({
  assessment,
  target,
  home,
  domainId,
}: {
  assessment: UnsatisfiedAssessment
  target: string
  home: string
  domainId: string
}) {
  const bundle = useMarkingBundle(domainId)
  const differences = assessment.differences.map((difference) =>
    differenceSentence(difference, home),
  )
  return (
    <div
      className="space-y-0.5 py-1.5 text-[13px] leading-relaxed"
      data-unsatisfied={assessment.subject.key}
    >
      <KeyLine
        subject={assessment.subject.key}
        bundle={bundle}
        fate={UNSATISFIED_FATES[assessment.state]}
        parts={unsatisfiedParts(assessment, target, home)}
      />
      {differences.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
          {differences.map((sentence, index) => (
            <li key={index}>{sentence}</li>
          ))}
          {assessment.differencesOmitted > 0 && (
            <li>{counted(assessment.differencesOmitted, 'more difference')} not carried.</li>
          )}
        </ul>
      )}
      {assessment.usages.length > 0 && (
        <Meta>
          <span
            title={assessment.usages
              .map((usage) => (usage.key ? keyText(usage.key, home) : usage.origin))
              .join('\n')}
          >
            {usagesSentence(assessment.usages, home)}
          </span>
        </Meta>
      )}
    </div>
  )
}

/** The requirements one version breaks, counted by kind, each opened on demand. */
function Breaks({
  verdict,
  target,
  home,
  domainId,
}: {
  verdict: CompatibilityVerdict
  target: string
  home: string
  domainId: string
}) {
  if (verdict.unsatisfied.length === 0) return null
  return (
    <Disclosure
      label={`${capital(counted(verdict.unsatisfied.length, 'unsatisfied requirement'))}: ${unsatisfiedSummary(verdict.unsatisfied)}`}
    >
      <Fold
        rows
        limit={5}
        items={verdict.unsatisfied}
        more={(count) => `Show ${count} more requirements`}
        render={(assessment) => (
          <Requirement
            key={`${assessment.subject.key}:${assessment.facet}`}
            assessment={assessment}
            target={target}
            home={home}
            domainId={domainId}
          />
        )}
      />
    </Disclosure>
  )
}

/** One row: versions of one revision, or the workspace copy, and their verdict. */
function VerdictRow({
  label,
  versions,
  marks,
  standing,
  verdict,
  target,
  home,
  dependent,
  origin,
  domainId,
}: {
  label: string
  /** the versions the verdict stands for; none for the workspace copy */
  versions?: readonly string[]
  marks: string[]
  /** the workspace copy's standing against its own Publications, as its map card says it */
  standing?: SceneBadge | undefined
  verdict: Remote<CompatibilityVerdict>
  target: string
  home: string
  dependent: string
  origin: string
  domainId: string
}) {
  return (
    <div className="space-y-1.5 py-2" data-verdict-row={label}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[13px] font-medium">{label}</span>
        {standing && <BadgeView badge={standing} />}
        {marks.map((mark) => (
          <Chip key={mark} tone="outline">
            {mark}
          </Chip>
        ))}
        <span className="ml-auto">
          {verdict.status === 'ok' ? (
            <VersionVerdict verdict={verdict.value} />
          ) : (
            <VerdictBadge verdict={{ label: "can't tell", breaks: false, judged: false }} />
          )}
        </span>
      </div>
      {verdict.status === 'ok' ? (
        <>
          <p className="text-[13px] leading-relaxed">
            {verdictSentence(verdict.value, dependent, versions)}
          </p>
          <Breaks verdict={verdict.value} target={target} home={home} domainId={domainId} />
        </>
      ) : (
        <RemoteNotice
          failure={verdict}
          what={`the verdict against ${domainName(origin)} ${label}`}
        />
      )}
    </div>
  )
}

/** Every readable version of the dependency `origin`, judged for the dependent. */
export function DependencyVerdicts({
  domainId,
  dependentOrigin,
  standing,
  origin,
  compatibility,
  copyStanding,
  onRetry,
}: {
  /** the dependent's, whose Schema marks the Keys its requirements name */
  domainId: string
  dependentOrigin: string
  standing: DependencyStanding | undefined
  origin: string
  compatibility: Fact<CompatibilityMatrix>
  /** where the dependency's workspace copy stands against its Publications, when it has one */
  copyStanding?: SceneBadge | undefined
  onRetry: () => Promise<unknown>
}) {
  const dependent = domainName(dependentOrigin)
  return (
    <div className="space-y-3">
      {standing && <p className="text-[13px] leading-relaxed">{builtAgainstSentence(standing)}</p>}
      <FactView
        fact={compatibility}
        what={`the compatibility of ${dependentOrigin}`}
        reading={`Judging ${dependent} against every version of ${domainName(origin)}…`}
        onRetry={onRetry}
        idle={<Empty>Not judged yet: select {dependent} to judge it.</Empty>}
      >
        {(matrix) => {
          if (matrix.error) return <Empty>Not judged: {matrix.error}</Empty>
          const dependency = matrix.dependencies.find((candidate) => candidate.origin === origin)
          if (!dependency)
            return (
              <Empty>
                {dependent} no longer depends on {origin}.
              </Empty>
            )
          return (
            <Verdicts
              domainId={domainId}
              dependency={dependency}
              dependent={dependent}
              home={dependentOrigin}
              carried={standing?.carriedBy ?? []}
              copyStanding={copyStanding}
              onRetry={onRetry}
            />
          )
        }}
      </FactView>
    </div>
  )
}

function Verdicts({
  domainId,
  dependency,
  dependent,
  home,
  carried,
  copyStanding,
  onRetry,
}: {
  domainId: string
  dependency: DependencyCompatibility
  dependent: string
  home: string
  carried: readonly string[]
  copyStanding?: SceneBadge | undefined
  onRetry: () => Promise<unknown>
}) {
  const name = domainName(dependency.origin)
  const groups = verdictGroups(dependency)
  const counts = tally(dependency)
  const local = dependency.local
  const judgedAt = firstJudgedAt(dependency)
  return (
    <div className="space-y-2">
      {counts && (
        <p className="text-[13px] leading-relaxed">
          {tallySentence(counts, dependent, dependency.origin)}
        </p>
      )}
      {dependency.publications.status !== 'ok' && (
        <RemoteNotice
          failure={dependency.publications}
          what={`the Publications of ${dependency.origin}`}
          onRetry={onRetry}
        />
      )}
      <div className="divide-y divide-border/60">
        {local && (
          <VerdictRow
            label="workspace copy"
            marks={[]}
            standing={copyStanding}
            verdict={local.verdict}
            target={`the workspace copy of ${name}`}
            home={home}
            dependent={dependent}
            origin={dependency.origin}
            domainId={domainId}
          />
        )}
        {groups && (
          <Fold
            limit={8}
            items={groups}
            more={(count) => `Show ${count} more versions`}
            render={(group) => {
              const marks = [
                ...(group.versions.some((version) => carried.includes(version))
                  ? ['built against']
                  : []),
                ...(group.yanked.length > 0
                  ? [
                      group.yanked.length === group.versions.length
                        ? 'yanked'
                        : `${joined(group.yanked)} yanked`,
                    ]
                  : []),
                ...(group.versions.length > 1 ? ['one revision'] : []),
              ]
              return (
                <VerdictRow
                  key={group.versions.join(',')}
                  label={group.versions.join(' · ')}
                  versions={group.versions}
                  marks={marks}
                  verdict={group.verdict}
                  target={`${name} ${group.versions[0]}`}
                  home={home}
                  dependent={dependent}
                  origin={dependency.origin}
                  domainId={domainId}
                />
              )
            }}
          />
        )}
      </div>
      {judgedAt && (
        <Meta>
          Judged {relativeTime(judgedAt.at)} by the SDK {judgedAt.sdk}. Capability requirements are
          not judged, and each binding is judged as a new one.
        </Meta>
      )}
    </div>
  )
}

function firstJudgedAt(
  dependency: DependencyCompatibility,
): { at: string; sdk: string } | undefined {
  const verdicts = [
    ...(dependency.local ? [dependency.local.verdict] : []),
    ...(dependency.publications.status === 'ok'
      ? dependency.publications.value.map((publication) => publication.verdict)
      : []),
  ]
  for (const verdict of verdicts)
    if (verdict.status === 'ok')
      return { at: verdict.value.judgedAt, sdk: verdict.value.judgedBy.sdk }
  return undefined
}
