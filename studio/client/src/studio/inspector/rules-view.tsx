/**
 * The Rules lens of the Inspector: its Policies and its constraints. A Class or relationship's
 * rule sites, who-may first; a Class as its card reads them, with its relationships'
 * constraints and who may call its Methods, a row per rule; a callable's contract and call rule. Mutations, queries and
 * Integrations carry no rule of their own: the page shows the call rule of each function that
 * reaches them, which is what decides who may.
 */
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { methodAuth } from '@/lib/callable'

import type { CallableLink } from './behavior'

import { cardRowsOf } from '../lenses/rules'
import { originShort } from '../lenses/structure'
import { FoldRows } from '../rule-page'
import { markOf } from '../rules/admission'
import { callRuleOf, type DomainRules } from '../rules/model'
import { Admission } from '../rules/rule-mark'
import { CallRule, RuleSites } from '../rules/rule-view'
import { CallableName, Empty, Fact, Fold, Section } from './parts'
import { ruleTargetOf } from './switches'
import { type InspectorTarget, targetOf } from './target'
import { withArticle } from './words'

type FunctionTarget = Extract<InspectorTarget, { kind: 'function' }>

export function RulesView({
  bundle,
  target,
  rules,
  users,
  domainId,
}: {
  bundle: StudioSchemaBundle
  target: InspectorTarget
  rules: DomainRules
  /** for a mutation, query or Integration: the functions that reach it */
  users: readonly CallableLink[]
  domainId: string
}) {
  switch (target.kind) {
    case 'class': {
      // The Class reads as its card does: its constraints gather its relationships'
      // constraints, and its Methods' call Policies follow, a row per rule.
      const domain = bundle.ir ? originShort(bundle.ir.domain) : ''
      const holds = cardRowsOf(bundle, target.id, 'holds')
      const calls = cardRowsOf(bundle, target.id, 'call')
      return (
        <>
          <RuleSites
            rules={rules}
            target={target.id}
            {...(holds.length > 0
              ? {
                  holds: {
                    count: holds.length,
                    body: <FoldRows bundle={bundle} rows={holds} domain={domain} />,
                  },
                }
              : {})}
          />
          {calls.length > 0 && (
            <Section label="Calls" kind="calls" count={calls.length} data-inspector-calls="">
              <FoldRows bundle={bundle} rows={calls} domain={domain} />
            </Section>
          )}
        </>
      )
    }
    case 'function':
      return (
        <Section label="Call" kind="calls" data-inspector-call="">
          <CallerRule rules={rules} target={target} />
        </Section>
      )
    case 'definition':
    case 'integration': {
      const callers = users.flatMap((each) => {
        const found = targetOf(bundle, each.target)
        return found.kind === 'function' ? [{ link: each, target: found }] : []
      })
      const what = withArticle(
        target.kind === 'integration' ? 'Integration' : target.definition.kind,
      )
      return (
        <Section
          label="Policies"
          kind="calls"
          count={callers.length || undefined}
          data-inspector-reach=""
        >
          {callers.length === 0 ? (
            <Empty>
              Rules sit on Classes, relationships and callables; {what} has none of its own, and no
              function is read to reach it.
            </Empty>
          ) : (
            <>
              <Empty>
                Rules sit on Classes, relationships and callables; {what} has none of its own. Who
                may reach it is decided by the call rule of each function that does.
              </Empty>
              <Fold
                items={callers}
                limit={3}
                rows
                render={(caller) => (
                  <div
                    key={caller.link.key}
                    data-inspector-caller={caller.link.key}
                    className="space-y-1.5 py-3 first:pt-0"
                  >
                    <p className="text-[13px]">
                      <CallableName
                        target={caller.link.target}
                        name={caller.link.key}
                        glyph="function"
                        domainId={domainId}
                      />
                    </p>
                    <CallerRule rules={rules} target={caller.target} />
                  </div>
                )}
              />
            </>
          )}
        </Section>
      )
    }
    default:
      return null
  }
}

/** A callable's contract, then the rule that decides who may call it. */
function CallerRule({ rules, target }: { rules: DomainRules; target: FunctionTarget }) {
  const contract = methodAuth(target.callable)
  const site = callRuleOf(rules, ruleTargetOf(target), target.callable.auth, target.abstract)
  const mark = markOf(site, target.callable.auth)
  return (
    <div className="space-y-2">
      {mark && (
        <p data-call-admits={mark.admits}>
          <Admission mark={mark}>{site ? undefined : 'by its contract'}</Admission>
        </p>
      )}
      {contract !== null && (
        <Fact label="Contract">
          {contract.label}
          <span className="text-muted-foreground">
            {' · '}
            {contract.blurb.replace(/^The callable contract /, '').replace(/\.$/, '')}
          </span>
        </Fact>
      )}
      <CallRule
        rules={rules}
        target={ruleTargetOf(target)}
        auth={target.callable.auth}
        contract={target.abstract}
      />
    </div>
  )
}
