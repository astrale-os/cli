/**
 * A dependency link, and a Domain the workspace does not hold.
 *
 * - A link reads one dependent against every readable version of one dependency.
 * - A Domain outside the workspace (the Kernel, Shell…) reads its Publications as the registry
 *   lists them to this session, and every workspace Domain that depends on it.
 */

import type { DependencyStanding, Remote, RegistryIndex } from '@shared/contracts/versions'

import { REGISTRY_READ_LIMIT_MS } from '@shared/contracts/versions'
import { WORKSPACE_MAP_ID } from '@shared/contracts/workspace'
import { GitCompareArrows } from 'lucide-react'

import { Chip } from '@/components/studio-kit'
import { Button } from '@/components/ui/button'
import { relativeTime } from '@/lib/time'

import type { DomainFacts } from './facts'
import type { FactName } from './use-facts'

import { Empty, Fold, Meta, Page, Section } from '../inspector/parts'
import { DependencyVerdicts } from './compatibility'
import { originOf, valueOf } from './facts'
import { PageHeader, SelectLine } from './header'
import { DomainGlyph, linksTone, toned, VerdictBadge, WORKSPACE_SECTIONS } from './marks'
import {
  dependencyLinkId,
  domainNodeId,
  linkVerdict,
  originNodeId,
  standingBadge,
  verdictTone,
} from './project'
import { Reading, RemoteNotice } from './remote'
import { counted, domainName, shortRevision } from './words'

type Refresh = (domainId: string, facts?: readonly FactName[]) => Promise<void>
type OpenPublished = (origin: string, version: string) => void

/** The newest Publication a line reference could choose: yanked ones only when all are. */
export function newestPublication(index: RegistryIndex): string | undefined {
  return (index.publications.find((publication) => !publication.yanked) ?? index.publications[0])
    ?.version
}

export function DependencyPage({
  domain,
  alias,
  domains,
  onSelect,
  onOpenPublished,
  refresh,
}: {
  domain: DomainFacts
  alias: string
  domains: readonly DomainFacts[]
  onSelect: (id: string) => void
  onOpenPublished: OpenPublished
  refresh: Refresh
}) {
  const id = domain.summary.id
  const home = originOf(domain)
  const declared = valueOf(domain.local)?.dependencies.find((entry) => entry.alias === alias)
  const standing = valueOf(domain.dependencies)?.dependencies.find((entry) => entry.alias === alias)
  const origin = declared?.origin ?? standing?.origin
  if (!origin)
    return (
      <Page domainId={id} data-workspace-page="dependency">
        <Empty>
          {domainName(home)} no longer declares the dependency {alias}.
        </Empty>
      </Page>
    )
  const target = domains.find((candidate) => originOf(candidate) === origin)
  const verdict = linkVerdict(
    domain.compatibility,
    valueOf(domain.compatibility)?.dependencies.find((entry) => entry.origin === origin),
  )
  return (
    <Page domainId={id} data-workspace-page="dependency" data-dependency={`${id}:${alias}`}>
      <PageHeader
        kicker="Dependency"
        icon={<GitCompareArrows />}
        name={`${domainName(home)} depends on ${domainName(origin)}`}
        sublabel={`${home} → ${origin}${alias !== origin.split('.')[0] ? ` · as ${alias}` : ''}`}
      >
        <Button size="sm" variant="outline" onClick={() => onSelect(domainNodeId(id))}>
          Read {domainName(home)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSelect(target ? domainNodeId(target.summary.id) : originNodeId(origin))}
        >
          Read {domainName(origin)}
        </Button>
      </PageHeader>
      <PublishedSchemas
        home={home}
        origin={origin}
        standing={standing}
        reading={domain.dependencies.status === 'loading'}
        onOpenPublished={onOpenPublished}
        onRetry={() => refresh(id, ['dependencies'])}
      />
      <Section
        label="Version by version"
        kind={toned(
          WORKSPACE_SECTIONS.verdicts,
          verdict.label === undefined ? undefined : verdictTone(verdict),
        )}
        data-workspace-section="verdicts"
      >
        <DependencyVerdicts
          domainId={id}
          dependentOrigin={home}
          standing={standing}
          origin={origin}
          compatibility={domain.compatibility}
          copyStanding={target && standingBadge(target)}
          onRetry={() => refresh(id, ['dependencies', 'compatibility'])}
        />
      </Section>
    </Page>
  )
}

/**
 * The dependency's Schema as published: the version the dependent is built against, and the
 * newest one, each opened read-only at the Schema level. Several versions can carry the
 * built-against Schema revision; they carry the same Schema, and the newest of them is opened.
 */
function PublishedSchemas({
  home,
  origin,
  standing,
  reading,
  onOpenPublished,
  onRetry,
}: {
  home: string
  origin: string
  standing?: DependencyStanding
  reading: boolean
  onOpenPublished: OpenPublished
  onRetry: () => Promise<unknown>
}) {
  const index = standing?.index
  const builtAgainst = standing?.carriedBy[0]
  const newest = index?.status === 'ok' ? newestPublication(index.value) : undefined
  return (
    <Section
      label="Published Schema"
      kind={WORKSPACE_SECTIONS.published}
      data-workspace-section="published-schema"
    >
      {!standing && reading ? (
        <Reading
          limitMs={REGISTRY_READ_LIMIT_MS}
          what={`the dependencies of ${home}`}
          onRetry={onRetry}
        >
          Reading what {domainName(home)} is built against…
        </Reading>
      ) : !standing ? (
        <Meta>Not read yet.</Meta>
      ) : index && index.status !== 'ok' ? (
        <RemoteNotice failure={index} what={`the Publications of ${origin}`} onRetry={onRetry} />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] leading-relaxed">
            {domainName(home)} is built against revision{' '}
            <span className="font-mono text-[12px]" title={standing.builtAgainst}>
              {shortRevision(standing.builtAgainst)}
            </span>
            {builtAgainst
              ? `, which ${standing.carriedBy.length === 1 ? 'Publication' : 'Publications'} ${standing.carriedBy.join(', ')} ${standing.carriedBy.length === 1 ? 'carries' : 'carry'}.`
              : ', which no Publication carries: it was built against an unpublished Schema.'}
            {newest
              ? ` The newest Publication of ${origin} is ${newest}.`
              : ` The registry lists no Publication of ${origin}.`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={!builtAgainst}
              data-open-publication="built-against"
              onClick={() => builtAgainst && onOpenPublished(origin, builtAgainst)}
            >
              Open built-against version{builtAgainst ? ` ${builtAgainst}` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!newest}
              data-open-publication="newest"
              onClick={() => newest && onOpenPublished(origin, newest)}
            >
              Open newest version{newest ? ` ${newest}` : ''}
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

/** Who in the workspace depends on `origin`, under which alias. */
export function dependentsOf(
  domains: readonly DomainFacts[],
  origin: string,
): Array<{ domain: DomainFacts; alias: string; standing?: DependencyStanding }> {
  return domains.flatMap((domain) => {
    const entry = valueOf(domain.local)?.dependencies.find(
      (candidate) => candidate.origin === origin,
    )
    if (!entry) return []
    const standing = valueOf(domain.dependencies)?.dependencies.find(
      (candidate) => candidate.alias === entry.alias,
    )
    return [{ domain, alias: entry.alias, ...(standing ? { standing } : {}) }]
  })
}

export function OriginPage({
  origin,
  domains,
  onSelect,
  onOpenPublished,
  refresh,
}: {
  origin: string
  domains: readonly DomainFacts[]
  onSelect: (id: string) => void
  onOpenPublished: OpenPublished
  refresh: Refresh
}) {
  const dependents = dependentsOf(domains, origin)
  const indexes = dependents.flatMap((dependent) =>
    dependent.standing ? [dependent.standing.index] : [],
  )
  const index: Remote<RegistryIndex> | undefined =
    indexes.find((candidate) => candidate.status === 'ok') ?? indexes[0]
  const reading = dependents.some((dependent) => dependent.domain.dependencies.status === 'loading')
  const verdicts = dependents.map(({ domain }) =>
    linkVerdict(
      domain.compatibility,
      valueOf(domain.compatibility)?.dependencies.find((entry) => entry.origin === origin),
    ),
  )
  const retry = () =>
    Promise.all(
      dependents.map((dependent) => refresh(dependent.domain.summary.id, ['dependencies'])),
    ).then(() => undefined)
  return (
    <Page domainId={WORKSPACE_MAP_ID} data-workspace-page="origin" data-origin={origin}>
      <PageHeader
        kicker="Domain outside this Workspace"
        icon={<DomainGlyph outside />}
        name={domainName(origin)}
        sublabel={origin}
      />
      <p className="text-[13px] leading-relaxed">
        {origin} is not in this Workspace. What is known of it comes from the registry and from the
        Schemas that depend on it.
      </p>
      <Section
        label="Publications"
        kind={WORKSPACE_SECTIONS.publications}
        count={index?.status === 'ok' ? index.value.publications.length : undefined}
        data-workspace-section="publications"
      >
        {!index ? (
          <Meta>{reading ? `Reading the Publications of ${origin}…` : 'Not read yet.'}</Meta>
        ) : index.status !== 'ok' ? (
          <RemoteNotice failure={index} what={`the Publications of ${origin}`} onRetry={retry} />
        ) : index.value.publications.length === 0 ? (
          <Empty>The registry lists no Publication of {origin}.</Empty>
        ) : (
          <Fold
            rows
            limit={10}
            items={index.value.publications}
            more={(count) => `Show ${count} more Publications`}
            render={(publication) => (
              <div
                key={publication.version}
                className="flex items-baseline gap-2 py-1.5 text-[13px]"
              >
                <span className="font-mono font-medium">{publication.version}</span>
                {publication.yanked && <Chip tone="warning">yanked</Chip>}
                <span
                  className="font-mono text-[12px] text-muted-foreground"
                  title={publication.schemaRevision}
                >
                  {shortRevision(publication.schemaRevision)}
                </span>
                <span className="ml-auto text-[12px] text-muted-foreground">
                  {relativeTime(publication.publishedAt)}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Open ${domainName(origin)} ${publication.version} read-only`}
                  onClick={() => onOpenPublished(origin, publication.version)}
                >
                  Open read-only
                </Button>
              </div>
            )}
          />
        )}
      </Section>
      <Section
        label="Used by"
        kind={toned(WORKSPACE_SECTIONS.dependencies, linksTone(verdicts))}
        count={dependents.length}
        data-workspace-section="used-by"
      >
        {dependents.length === 0 ? (
          <Empty>No workspace Domain depends on {origin} any more.</Empty>
        ) : (
          <Fold
            items={dependents}
            limit={8}
            more={(count) => `Show ${count} more Domains`}
            render={({ domain, alias, standing }, index) => {
              const verdict = verdicts[index]!
              return (
                <div key={domain.summary.id} className="space-y-0.5">
                  <SelectLine
                    onSelect={() => onSelect(dependencyLinkId(domain.summary.id, alias))}
                    trailing="Version by version →"
                  >
                    <DomainGlyph className="mr-1.5" />
                    <span className="font-medium">{domainName(originOf(domain))}</span>
                    {verdict.label !== undefined && (
                      <VerdictBadge
                        className="ml-2"
                        verdict={{ ...verdict, label: verdict.label }}
                      />
                    )}
                  </SelectLine>
                  <Meta>
                    {standing
                      ? standing.carriedBy.length > 0
                        ? `Built against ${standing.carriedBy.join(', ')}.`
                        : `Built against revision ${shortRevision(standing.builtAgainst)}${standing.index.status === 'ok' ? ', which no Publication carries' : ''}.`
                      : 'Reading what it is built against…'}
                  </Meta>
                </div>
              )
            }}
          />
        )}
        {dependents.length > 0 && (
          <Meta>
            {counted(dependents.length, 'workspace Domain')} built against {origin}.
          </Meta>
        )}
      </Section>
    </Page>
  )
}
