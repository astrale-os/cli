import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { publicationOf } from '@shared/contracts/versions'
import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { parseSchemaRefKey } from '@shared/schema/identity'
import { Database, ShieldCheck } from 'lucide-react'

import { EmptyState } from '@/components/studio-kit'
import { useBundle, useSchemaDomains } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { carryToDataset } from '@/studio/data/carry'
import { Empty, LensSwitches, Page, Section, Title } from '@/studio/inspector/parts'
import { type LensSwitch } from '@/studio/inspector/switches'
import { type PolicyRule, policyRuleOf, rulesOf } from '@/studio/rules/model'
import { PolicyRuleCard, UnreadNote } from '@/studio/rules/rule-view'

import { originLabel } from './detail/model'

/**
 * Policy panels also work when their domain is not drawn on the canvas: a Policy is read from
 * the workspace Domain that declares it. A Publication is read from its own bundle, whatever the
 * Policy's origin: it carries the very Schemas it is built against, and the workspace's copy of
 * its origin is another version.
 */
export function SchemaPolicyDetail({
  domainId,
  policyKey,
}: {
  domainId: string
  policyKey: string
}) {
  const ref = parseSchemaRefKey(policyKey)
  const { data: workspace } = useSchemaDomains()
  const ownerId = publicationOf(domainId)
    ? domainId
    : (workspace?.find((domain) => domain.origin === ref?.origin)?.id ?? domainId)
  const { data: bundle, isLoading } = useBundle(ownerId)
  if (isLoading) return <div className="p-5 text-sm text-muted-foreground">Loading policy…</div>
  if (!bundle?.ir)
    return (
      <div className="p-5">
        <EmptyState title="Policy unavailable" hint={ref?.name ?? policyKey} />
      </div>
    )
  return <PolicyDetail bundle={bundle} policyKey={policyKey} />
}

/**
 * A Policy's page in the Inspector. Under Rules, its card: the rule in words or as a Figure,
 * where it sits, what it checks and what checks it. Under the other lenses, what it is and the
 * switch to Rules: a Policy adds nothing to what exists or to what happens.
 */
function PolicyDetail({ bundle, policyKey }: { bundle: StudioSchemaBundle; policyKey: string }) {
  const lens = useUI((state) => state.lens)
  const readerDomainId = useUI((state) => state.readerDomainId)
  const rules = rulesOf(bundle)
  const key = policyKey.includes(':policy.')
    ? policyKey
    : `${rules.origin ?? bundle.ir?.domain}:policy.${policyKey}`
  const policy = policyRuleOf(rules, key)
  if (!policy && !rules.unread)
    return (
      <div className="p-5">
        <EmptyState
          title="Policy unavailable"
          hint="This policy's declaration is not available in this domain."
        />
      </div>
    )
  const name = policy?.name ?? parseSchemaRefKey(key)?.name ?? policyKey
  const origin = policy?.origin ?? parseSchemaRefKey(key)?.origin
  const switches: LensSwitch[] =
    lens === 'rules' || policy === undefined ? [] : [{ lens: 'rules', text: policyWords(policy) }]
  return (
    <Page domainId={bundle.domainId} data-inspector-lens={lens} data-policy-detail="">
      <Title
        kicker={`Policy · ${originLabel(origin)}`}
        name={name}
        icon={<ShieldCheck />}
        {...(policy?.description === undefined ? {} : { description: policy.description })}
        domainId={bundle.domainId}
        anchor={`policy.${key}`}
      />
      {lens !== 'rules' ? (
        <Section label={lens === 'structure' ? 'Structure' : 'Behavior'}>
          <Empty>
            A Policy is a rule: it adds nothing to{' '}
            {lens === 'structure' ? 'what exists' : 'what happens'}.
          </Empty>
        </Section>
      ) : policy ? (
        <PolicyRuleCard rules={rules} policy={policy} />
      ) : (
        <UnreadNote unread={rules.unread!} />
      )}
      {/* The Data level reads the Domain shown; the Kernel and a Publication carry no dataset. */}
      {lens === 'rules' &&
        policy !== undefined &&
        readerDomainId !== undefined &&
        !isReadOnlyDomainId(readerDomainId) && (
          <button
            type="button"
            data-policy-on-dataset={policy.target}
            onClick={() => void carryToDataset(readerDomainId, policy.target, policy.name)}
            className="inline-flex items-center gap-1.5 rounded-sm text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Database className="h-3.5 w-3.5" /> What it admits on a dataset
          </button>
        )}
      <LensSwitches switches={switches} />
    </Page>
  )
}

/** What the Rules lens has to say of a Policy: where it sits and what it checks. */
function policyWords(policy: PolicyRule): string {
  const sits = policy.sitsOn.length
  const checks = policy.policies.length
  const parts = [
    sits === 0
      ? 'It sits on nothing'
      : `It sits on ${sits} ${sits === 1 ? 'slot or callable' : 'slots and callables'}`,
    ...(checks === 0 ? [] : [`checks ${checks} ${checks === 1 ? 'Policy' : 'Policies'}`]),
  ]
  return `${parts.join(' and ')}; read what it says`
}
