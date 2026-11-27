/**
 * One workspace Domain's standing, in sentences first: the version on disk and its revision, the
 * last Publication, the changes since then with the reason each costs its bump, the version to
 * declare next, the Environments it publishes to, and each dependency's compatibility.
 */

import type { ChangeReport, DomainLocal, DomainStanding } from '@shared/contracts/versions'

import { CloudUpload, FileCode2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

import type { DomainFacts } from './facts'
import type { FactName } from './use-facts'

import { BadgeView } from '../canvas/parts'
import { TONE_TEXT } from '../canvas/tones'
import { Disclosure, Empty, Fact, Fold, Meta, Page, Section } from '../inspector/parts'
import { originOf, valueOf } from './facts'
import { Callout, PageHeader, SelectLine } from './header'
import {
  ChangeGroups,
  changesTone,
  DomainGlyph,
  linksTone,
  ReportSentences,
  toned,
  VerdictBadge,
  WORKSPACE_SECTIONS,
} from './marks'
import { dependencyLinkId, linkVerdict, standingBadge } from './project'
import { isRunning, usePublishRuns } from './publish'
import { FactView, RemoteNotice, RetryButton } from './remote'
import {
  builtAgainstSentence,
  counted,
  domainName,
  environmentsSentence,
  gitSentence,
  nextVersion,
  relationSentence,
  shortRevision,
} from './words'

export interface DomainPageProps {
  domain: DomainFacts
  domains: readonly DomainFacts[]
  onOpenDomain: (domainId: string) => void
  onSelect: (id: string) => void
  onPublish: (domainId: string) => void
  refresh: (domainId: string, facts?: readonly FactName[]) => Promise<void>
}

export function DomainPage({
  domain,
  domains,
  onOpenDomain,
  onSelect,
  onPublish,
  refresh,
}: DomainPageProps) {
  const id = domain.summary.id
  const origin = originOf(domain)
  const name = domainName(origin)
  const local = valueOf(domain.local)
  const run = usePublishRuns((state) => state.runs[id])
  const running = run !== undefined && isRunning(run)
  const dependents = domains.filter(
    (other) =>
      other.summary.id !== id &&
      valueOf(other.local)?.dependencies.some((entry) => entry.origin === origin),
  )
  const standing = standingBadge(domain)
  const report =
    domain.changes.status === 'ready' && domain.changes.value.status === 'ok'
      ? domain.changes.value.value
      : undefined
  // the hue each list of links wears on the map: the worst of their verdicts
  const verdictOn = (of: DomainFacts, target: string) =>
    linkVerdict(
      of.compatibility,
      valueOf(of.compatibility)?.dependencies.find((entry) => entry.origin === target),
    )
  const dependenciesTone = linksTone(
    (local?.dependencies ?? []).map((dependency) => verdictOn(domain, dependency.origin)),
  )
  const dependentsTone = linksTone(dependents.map((other) => verdictOn(other, origin)))

  return (
    <Page domainId={id} data-workspace-page="domain" data-domain-name={name}>
      <PageHeader
        kicker="Workspace Domain"
        icon={<DomainGlyph />}
        name={name}
        sublabel={
          local?.packageName && local.packageName !== origin
            ? `${origin} · ${local.packageName}`
            : origin
        }
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpenDomain(id)}
          data-action="open-schema"
        >
          <FileCode2 />
          Open at the Schema level
        </Button>
        <Button size="sm" onClick={() => onPublish(id)} data-action="publish">
          <CloudUpload />
          {running ? 'Publishing…' : 'Publish…'}
        </Button>
        <RetryButton onRetry={() => refresh(id)} label="Read again" />
      </PageHeader>

      <Section
        label="Standing"
        kind={toned(WORKSPACE_SECTIONS.standing, standing?.tone)}
        hint={standing && <BadgeView badge={standing} />}
        data-workspace-section="standing"
      >
        <LocalStanding domain={domain} />
        <FactView
          fact={domain.standing}
          what={`the standing of ${origin}`}
          reading={`Reading the Publications of ${origin}…`}
          onRetry={() => refresh(id, ['standing'])}
        >
          {(standing) => (
            <RegistryStanding standing={standing} onRetry={() => refresh(id, ['standing'])} />
          )}
        </FactView>
      </Section>

      <Section
        label="Changes since the last Publication"
        kind={toned(WORKSPACE_SECTIONS.changes, changesTone(report))}
        data-workspace-section="changes"
        hint={report ? `judged ${relativeTime(report.judgedAt)}` : undefined}
      >
        <FactView
          fact={domain.changes}
          what={`the change report of ${origin}`}
          reading="The platform is judging the changes (astrale-domain diff)…"
          onRetry={() => refresh(id, ['changes'])}
          idle={
            <Empty>
              Not judged yet.{' '}
              <button type="button" className="underline" onClick={() => refresh(id, ['changes'])}>
                Judge the changes
              </button>
            </Empty>
          }
        >
          {(answer) =>
            answer.status === 'ok' ? (
              <Changes report={answer.value} origin={origin} domainId={id} />
            ) : (
              <RemoteNotice
                failure={answer}
                what={`the change report of ${origin}`}
                onRetry={() => refresh(id, ['changes'])}
              />
            )
          }
        </FactView>
      </Section>

      <Section label="Publish" kind={WORKSPACE_SECTIONS.publish} data-workspace-section="publish">
        {local ? (
          <>
            <p className="text-[13px] leading-relaxed">
              {environmentsSentence(local.environments)}
            </p>
            <p className="text-[13px] leading-relaxed">{gitSentence(local.git)}</p>
          </>
        ) : null}
        {run && run.phase !== 'idle' && (
          <Meta data-publish-phase={run.phase}>{runSummary(run.phase)}</Meta>
        )}
        <div>
          <Button size="sm" variant="outline" onClick={() => onPublish(id)}>
            <CloudUpload />
            {running ? 'Follow the Publish' : `Publish ${local?.declared ?? ''}…`}
          </Button>
        </div>
      </Section>

      <Section
        label="Dependencies"
        kind={toned(WORKSPACE_SECTIONS.dependencies, dependenciesTone)}
        count={local?.dependencies.length}
        data-workspace-section="dependencies"
      >
        <Dependencies domain={domain} domains={domains} onSelect={onSelect} refresh={refresh} />
      </Section>

      <Section
        label="Depended on by"
        kind={toned(WORKSPACE_SECTIONS.dependencies, dependentsTone)}
        count={dependents.length}
        data-workspace-section="dependents"
      >
        {dependents.length === 0 ? (
          <Empty>No workspace Domain depends on {name}.</Empty>
        ) : (
          <Fold
            items={dependents}
            limit={8}
            more={(count) => `Show ${count} more Domains`}
            render={(other) => {
              const alias = valueOf(other.local)!.dependencies.find(
                (entry) => entry.origin === origin,
              )!.alias
              return (
                <SelectLine
                  key={other.summary.id}
                  onSelect={() => onSelect(dependencyLinkId(other.summary.id, alias))}
                  trailing="Compatibility →"
                >
                  <DomainGlyph className="mr-1.5" />
                  {domainName(originOf(other))}
                </SelectLine>
              )
            }}
          />
        )}
      </Section>
    </Page>
  )
}

function runSummary(phase: string): string {
  switch (phase) {
    case 'looking':
      return 'Taking a fresh look before publishing…'
    case 'look-failed':
      return 'The last look could not be taken.'
    case 'review':
      return 'A Publish is ready for review.'
    case 'starting':
    case 'running':
      return 'A Publish is running.'
    case 'published':
      return 'The last Publish succeeded.'
    case 'failed':
      return 'The last Publish failed.'
    case 'refused':
      return 'The last Publish was refused before anything ran.'
    case 'error':
      return 'The last Publish stream broke: whether it finished is not known.'
    default:
      return ''
  }
}

/** The facts on disk: version, revision, build state. */
function LocalStanding({ domain }: { domain: DomainFacts }) {
  const fact = domain.local
  if (fact.status === 'loading') return <Meta>Reading the sources…</Meta>
  if (fact.status === 'error')
    return <Callout>The sources could not be read: {fact.message}</Callout>
  if (fact.status !== 'ready') return null
  const local: DomainLocal = fact.value
  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-relaxed">
        {local.declared
          ? `Declares ${local.declared} in package.json: the version a Publish gives the release.`
          : 'package.json declares no version: a Publish needs one.'}
      </p>
      {!domain.summary.depsInstalled && (
        <Callout>
          Its dependencies are not installed: its SDK cannot judge its Schema. Install them, then
          read again.
        </Callout>
      )}
      {local.revision === null && (
        <Callout>
          The Schema revision is unknown:{' '}
          {local.revisionError ?? 'the Schema could not be admitted.'}
        </Callout>
      )}
      <div className="space-y-1">
        <Fact label="version">
          <span className="font-mono">{local.declared ?? 'none'}</span>
        </Fact>
        <Fact label="revision">
          {local.revision ? (
            <span className="font-mono" title={local.revision}>
              {shortRevision(local.revision)}
            </span>
          ) : (
            'unknown'
          )}
        </Fact>
        <Fact label="commit">
          {local.git === null ? (
            'none'
          ) : (
            <span className="font-mono">
              {local.git.commit.slice(0, 7)}
              {local.git.dirty && (
                <span className={cn('ml-1.5 font-sans', TONE_TEXT.warning)}>
                  uncommitted changes
                </span>
              )}
            </span>
          )}
        </Fact>
      </div>
    </div>
  )
}

/** Where the sources stand against the registry. */
function RegistryStanding({
  standing,
  onRetry,
}: {
  standing: DomainStanding
  onRetry: () => Promise<unknown>
}) {
  const latest = standing.latest
  const relation = standing.relation
  const action = relation.kind === 'behind' || relation.kind === 'version-taken'
  return (
    <div className="space-y-2" data-relation={relation.kind}>
      {action ? (
        <Callout>{relationSentence(relation, standing.local)}</Callout>
      ) : (
        <p className="text-[13px] leading-relaxed">{relationSentence(relation, standing.local)}</p>
      )}
      {latest && (
        <p className="text-[13px] leading-relaxed">
          The last Publication is {latest.version}, published {relativeTime(latest.publishedAt)}
          {latest.yanked ? '; it is yanked' : ''}.
          {standing.carriedBy.length > 0 &&
            ` These sources' Schema revision is the one ${standing.carriedBy.length === 1 ? standing.carriedBy[0] : standing.carriedBy.join(', ')} carries.`}
        </p>
      )}
      {standing.index.status === 'ok' ? (
        <Meta>
          {counted(standing.index.value.publications.length, 'Publication')} readable · read{' '}
          {relativeTime(standing.index.readAt)}
        </Meta>
      ) : (
        <RemoteNotice
          failure={standing.index}
          what={`the Publications of ${standing.local.origin ?? 'this Domain'}`}
          onRetry={onRetry}
        />
      )}
    </div>
  )
}

/** The change report: what is compared, what it requires, and every change with its reason. */
function Changes({
  report,
  origin,
  domainId,
}: {
  report: ChangeReport
  origin: string
  domainId: string
}) {
  const next = nextVersion(report)
  return (
    <div className="space-y-3" data-accepted={String(report.accepted)}>
      <div className="space-y-1">
        <ReportSentences report={report} className="text-[13px] leading-relaxed" />
      </div>
      {next ? (
        <Callout>
          Declare <span className="font-mono font-medium">{next}</span> next: it is the version
          these changes admit.
        </Callout>
      ) : !report.published ? (
        <Meta>
          The version to publish is{' '}
          <span className="font-mono text-foreground">{report.declared}</span>.
        </Meta>
      ) : null}
      <ChangeGroups
        changes={report.changes}
        origin={origin}
        domainId={domainId}
        limit={6}
        reasons
      />
      {report.notes.length > 0 && (
        <Disclosure label={`The platform's notes (${report.notes.length})`}>
          <ul className="space-y-0.5 text-[12px] text-muted-foreground">
            {report.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  )
}

/** Each dependency: what it is built against, and how many of its versions still hold. */
function Dependencies({
  domain,
  domains,
  onSelect,
  refresh,
}: {
  domain: DomainFacts
  /** the Workspace's, which tell a dependency it holds from one outside */
  domains: readonly DomainFacts[]
  onSelect: (id: string) => void
  refresh: DomainPageProps['refresh']
}) {
  const id = domain.summary.id
  const local = valueOf(domain.local)
  const name = domainName(originOf(domain))
  if (!local) return <Meta>Reading the sources…</Meta>
  if (local.dependencies.length === 0) return <Empty>{name} depends on no other Domain.</Empty>
  const standings = valueOf(domain.dependencies)
  const matrix = valueOf(domain.compatibility)
  return (
    <div className="space-y-1">
      {domain.dependencies.status === 'error' && (
        <RemoteNotice
          failure={{ status: 'failed', message: domain.dependencies.message }}
          what={`the dependencies of ${name}`}
          onRetry={() => refresh(id, ['dependencies'])}
        />
      )}
      {standings?.error && <Callout>{standings.error}</Callout>}
      <Fold
        rows
        limit={8}
        items={local.dependencies}
        more={(count) => `Show ${count} more dependencies`}
        render={(dependency) => {
          const standing = standings?.dependencies.find((entry) => entry.alias === dependency.alias)
          const compatibility = matrix?.dependencies.find(
            (entry) => entry.origin === dependency.origin,
          )
          const verdict = linkVerdict(domain.compatibility, compatibility)
          return (
            <div
              key={dependency.alias}
              className="space-y-0.5 py-1.5"
              data-dependency={dependency.origin}
            >
              <SelectLine
                onSelect={() => onSelect(dependencyLinkId(id, dependency.alias))}
                trailing="Version by version →"
              >
                <DomainGlyph
                  className="mr-1.5"
                  outside={!domains.some((other) => originOf(other) === dependency.origin)}
                />
                <span className="font-medium">{domainName(dependency.origin)}</span>
                {dependency.alias !== dependency.origin.split('.')[0] && (
                  <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">
                    as {dependency.alias}
                  </span>
                )}
                {verdict.label !== undefined && (
                  <VerdictBadge className="ml-2" verdict={{ ...verdict, label: verdict.label }} />
                )}
              </SelectLine>
              <Meta>
                {standing
                  ? builtAgainstSentence(standing)
                  : `Built against revision ${shortRevision(dependency.revision)}.`}
              </Meta>
            </div>
          )
        }}
      />
      <Meta>Select a dependency, or its link on the map, to read every version's verdict.</Meta>
    </div>
  )
}
