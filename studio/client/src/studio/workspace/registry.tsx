/**
 * The registry, as this session may read it: its Domains, then each Domain's Publications
 * (yanked ones marked), each of which opens read-only at the Schema level.
 *
 * Every read has its own status: a registry that cannot be reached says so here, and never
 * blanks what the Workspace knows from its own sources.
 */

import type { RegistryDomain } from '@shared/contracts/versions'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Chip } from '@/components/studio-kit'
import { Button } from '@/components/ui/button'
import { versionsApi, versionsKeys } from '@/lib/api'
import { answerLifetime, readAgain } from '@/lib/domain-queries'
import { relativeTime } from '@/lib/time'

import { Disclosure, Empty, Fold, Meta, Section } from '../inspector/parts'
import { factOf } from './facts'
import { DomainGlyph, WORKSPACE_SECTIONS } from './marks'
import { FactView, RemoteNotice, RetryButton } from './remote'
import { counted, domainName, shortRevision } from './words'

/** How many registry Domains, and Publications of one, are listed before the rest are folded. */
export const REGISTRY_DOMAINS_SHOWN = 12
export const PUBLICATIONS_SHOWN = 8

export interface RegistrySectionProps {
  /** Origins the workspace holds, marked in the listing. */
  workspaceOrigins: ReadonlySet<string>
  /** Opens a Publication read-only at the Schema level. */
  onOpenPublished: (origin: string, version: string) => void
}

export function RegistrySection({ workspaceOrigins, onOpenPublished }: RegistrySectionProps) {
  const query = useQuery({
    queryKey: versionsKeys.registryDomains,
    queryFn: versionsApi.registryDomains,
    ...answerLifetime(60_000),
    retry: false,
  })
  const fact = factOf(query, true)
  const answer = query.data
  return (
    <Section
      label="Registry"
      kind={WORKSPACE_SECTIONS.registry}
      count={answer?.status === 'ok' ? answer.value.domains.length : undefined}
      data-workspace-section="registry"
      hint={answer ? <RetryButton onRetry={() => query.refetch()} label="Read again" /> : undefined}
    >
      <FactView
        fact={fact}
        what="the registry's Domains"
        reading="Reading the registry's Domains…"
        onRetry={() => query.refetch()}
      >
        {(listing) =>
          listing.status !== 'ok' ? (
            <RemoteNotice
              failure={listing}
              what="the registry's Domains"
              onRetry={() => query.refetch()}
            />
          ) : listing.value.domains.length === 0 ? (
            <Empty>The registry lists no Domain this session may read.</Empty>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] leading-relaxed">
                {counted(listing.value.domains.length, 'Domain')} registered on{' '}
                {listing.value.admin}, as this session may read them.
                {!listing.value.complete &&
                  ' The listing stopped at its page bound: more may exist.'}
              </p>
              <Fold
                limit={REGISTRY_DOMAINS_SHOWN}
                items={listing.value.domains}
                more={(count) => `Show ${count} more registry Domains`}
                render={(domain) => (
                  <RegistryDomainItem
                    key={domain.origin}
                    domain={domain}
                    inWorkspace={workspaceOrigins.has(domain.origin)}
                    onOpenPublished={onOpenPublished}
                  />
                )}
              />
              <Meta>Read {relativeTime(listing.readAt)}.</Meta>
            </div>
          )
        }
      </FactView>
    </Section>
  )
}

function RegistryDomainItem({
  domain,
  inWorkspace,
  onOpenPublished,
}: {
  domain: RegistryDomain
  inWorkspace: boolean
  onOpenPublished: (origin: string, version: string) => void
}) {
  return (
    <div data-registry-domain={domain.origin}>
      <Disclosure
        label={
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <DomainGlyph outside={!inWorkspace} className="self-center" />
            <span className="font-medium text-foreground">
              {domain.name ?? domainName(domain.origin)}
            </span>
            <span className="font-mono text-[11px]">{domain.origin}</span>
            {inWorkspace && <Chip tone="outline">in this Workspace</Chip>}
          </span>
        }
      >
        {domain.description && (
          <p className="pb-1.5 text-[12px] text-muted-foreground">{domain.description}</p>
        )}
        <RegistryVersions origin={domain.origin} onOpenPublished={onOpenPublished} />
      </Disclosure>
    </div>
  )
}

/** One registry Domain's Publications, read when it is opened. */
export function RegistryVersions({
  origin,
  onOpenPublished,
}: {
  origin: string
  onOpenPublished: (origin: string, version: string) => void
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: versionsKeys.registryVersions(origin),
    queryFn: () => versionsApi.registryVersions(origin),
    ...answerLifetime(60_000),
    retry: false,
  })
  const retry = () =>
    readAgain(queryClient, {
      queryKey: versionsKeys.registryVersions(origin),
      queryFn: () => versionsApi.registryVersions(origin, true),
      staleTime: 0,
    })
  return (
    <FactView
      fact={factOf(query, true)}
      what={`the Publications of ${origin}`}
      reading={`Reading the Publications of ${origin}…`}
      onRetry={retry}
    >
      {(answer) =>
        answer.status !== 'ok' ? (
          <RemoteNotice failure={answer} what={`the Publications of ${origin}`} onRetry={retry} />
        ) : answer.value.publications.length === 0 ? (
          <Empty>The registry lists no Publication of {origin}.</Empty>
        ) : (
          <Fold
            rows
            limit={PUBLICATIONS_SHOWN}
            items={answer.value.publications}
            more={(count) => `Show ${count} more Publications`}
            render={(publication) => (
              <PublicationRow
                key={publication.version}
                origin={origin}
                version={publication.version}
                yanked={publication.yanked}
                publishedAt={publication.publishedAt}
                revision={publication.schemaRevision}
                onOpenPublished={onOpenPublished}
              />
            )}
          />
        )
      }
    </FactView>
  )
}

function PublicationRow({
  origin,
  version,
  yanked,
  publishedAt,
  revision,
  onOpenPublished,
}: {
  origin: string
  version: string
  yanked: boolean
  publishedAt: string
  revision: string
  onOpenPublished: (origin: string, version: string) => void
}) {
  return (
    <div className="py-1.5" data-publication={version}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
        <span className="font-mono font-medium">{version}</span>
        {yanked && (
          <Chip tone="warning" title="A yanked version is never chosen by a line reference.">
            yanked
          </Chip>
        )}
        <span className="font-mono text-[12px] text-muted-foreground" title={revision}>
          {shortRevision(revision)}
        </span>
        <span className="text-[12px] text-muted-foreground">{relativeTime(publishedAt)}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          aria-label={`Open ${domainName(origin)} ${version} read-only`}
          onClick={() => onOpenPublished(origin, version)}
        >
          Open read-only
        </Button>
      </div>
    </div>
  )
}
