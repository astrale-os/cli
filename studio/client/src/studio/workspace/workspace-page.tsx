/**
 * The Workspace with nothing selected: how many Domains it holds, what asks for action, which
 * Domains outside it are depended on, and the registry.
 */

import { WORKSPACE_MAP_ID } from '@shared/contracts/workspace'
import { Layers, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'

import type { DomainFacts, Fact } from './facts'

import { BadgeView } from '../canvas/parts'
import { Empty, Fold, Meta, Page, Section } from '../inspector/parts'
import { originOf, valueOf } from './facts'
import { Callout, PageHeader, SelectLine } from './header'
import { DomainGlyph, WORKSPACE_SECTIONS } from './marks'
import { domainNodeId, originNodeId, standingBadge } from './project'
import { RegistrySection } from './registry'
import { RetryButton, ServerNotice } from './remote'
import { attentionSentences, counted, domainName, joined } from './words'

/** How many Domains a list shows before folding the rest. */
export const DOMAINS_SHOWN = 12

export function WorkspacePage({
  domains,
  locals,
  others,
  judged,
  everything,
  onJudgeEverything,
  onSelect,
  onOpenPublished,
  onRereadLocals,
  onReadAgain,
  onNewDomain,
}: {
  domains: readonly DomainFacts[]
  locals: Fact<unknown>
  /** Origins depended on that the workspace does not hold, by name. */
  others: readonly string[]
  judged: ReadonlySet<string>
  everything: boolean
  onJudgeEverything: () => void
  onSelect: (id: string) => void
  onOpenPublished: (origin: string, version: string) => void
  onRereadLocals: () => Promise<unknown>
  /** Reads every registry fact of these Domains again, past every cache. */
  onReadAgain: (domainIds: readonly string[]) => Promise<unknown>
  /** Opens the composer that starts a new Domain of this Workspace. */
  onNewDomain: () => void
}) {
  const { causes, sentences: attention } = attentionSentences(domains)
  const unjudged = domains.filter((domain) => !judged.has(domain.summary.id)).length
  const origins = new Set(domains.map(originOf))
  return (
    <Page domainId={WORKSPACE_MAP_ID} data-workspace-page="workspace">
      <PageHeader kicker="Workspace" icon={<Layers />} name="Workspace">
        <Button size="sm" variant="outline" onClick={onNewDomain} data-action="new-domain">
          <Plus />
          New domain
        </Button>
      </PageHeader>
      <div className="space-y-1.5 text-[13px] leading-relaxed">
        <p>
          {domains.length === 0
            ? 'This Workspace holds no Domain.'
            : `This Workspace holds ${counted(domains.length, 'Domain')}.`}
          {others.length > 0 &&
            ` ${others.length === 1 ? 'One Domain' : `${others.length} Domains`} outside it ${others.length === 1 ? 'is' : 'are'} depended on: ${joined(others.map(domainName))}.`}
        </p>
        {attention.length === 0 && causes.length === 0 && domains.length > 0 && unjudged === 0 && (
          <p className="text-muted-foreground">Nothing asks for action.</p>
        )}
      </div>
      {locals.status === 'error' && (
        <ServerNotice
          message={locals.message}
          what="the Workspace's sources"
          onRetry={onRereadLocals}
        />
      )}

      {attention.length + causes.length > 0 && (
        <Section
          label="Asks for action"
          kind={WORKSPACE_SECTIONS.attention}
          count={attention.length + causes.length}
          data-workspace-section="attention"
        >
          {causes.map((cause) => (
            <div
              key={cause.status}
              data-workspace-cause={cause.status}
              className="flex items-baseline gap-2 py-1 text-[13px] leading-relaxed"
            >
              <span className="min-w-0 flex-1">{cause.sentence}</span>
              <RetryButton onRetry={() => onReadAgain(cause.domainIds)} className="shrink-0" />
            </div>
          ))}
          <Fold
            items={attention}
            limit={8}
            more={(count) => `Show ${count} more`}
            render={(item) => (
              <SelectLine
                key={item.domainId}
                onSelect={() => onSelect(domainNodeId(item.domainId))}
                trailing="Read →"
              >
                {item.sentence}
              </SelectLine>
            )}
          />
        </Section>
      )}

      {unjudged > 0 && !everything && (
        <Callout tone="quiet">
          {counted(unjudged, 'Domain')} {unjudged === 1 ? 'is' : 'are'} not judged yet: a Workspace
          this large reads each change report and compatibility when its Domain is selected.{' '}
          <Button size="xs" variant="outline" className="ml-1" onClick={onJudgeEverything}>
            Judge every Domain
          </Button>
        </Callout>
      )}

      <Section
        label="Domains"
        kind={WORKSPACE_SECTIONS.domains}
        count={domains.length}
        data-workspace-section="domains"
      >
        {domains.length === 0 ? (
          <Empty>Create a Domain, or add one to the Workspace, to read it here.</Empty>
        ) : (
          <Fold
            rows
            items={domains}
            limit={DOMAINS_SHOWN}
            more={(count) => `Show ${count} more Domains`}
            render={(domain) => {
              const local = valueOf(domain.local)
              const standing = standingBadge(domain)
              return (
                <SelectLine
                  key={domain.summary.id}
                  onSelect={() => onSelect(domainNodeId(domain.summary.id))}
                  data-workspace-domain={domain.summary.id}
                  trailing={standing && <BadgeView badge={standing} />}
                >
                  <DomainGlyph className="mr-1.5" />
                  <span className="font-medium">{domainName(originOf(domain))}</span>
                  <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">
                    {local?.declared ?? ''}
                  </span>
                </SelectLine>
              )
            }}
          />
        )}
      </Section>

      {others.length > 0 && (
        <Section
          label="Outside this Workspace"
          kind={WORKSPACE_SECTIONS.others}
          count={others.length}
          data-workspace-section="others"
        >
          <Fold
            items={others}
            limit={DOMAINS_SHOWN}
            more={(count) => `Show ${count} more Domains`}
            render={(origin) => (
              <SelectLine
                key={origin}
                onSelect={() => onSelect(originNodeId(origin))}
                trailing="Read →"
              >
                <DomainGlyph outside className="mr-1.5" />
                <span className="font-medium">{domainName(origin)}</span>
                <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">{origin}</span>
              </SelectLine>
            )}
          />
          <Meta>Depended on by workspace Domains; read from the registry.</Meta>
        </Section>
      )}

      <RegistrySection workspaceOrigins={origins} onOpenPublished={onOpenPublished} />
    </Page>
  )
}
