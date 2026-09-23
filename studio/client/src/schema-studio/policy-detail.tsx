import type { IrSchemaRef, StudioSchemaBundle } from '@shared/types'

import { parseSchemaRefKey, schemaRefKey } from '@shared/types'
import { FlaskConical, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'

import { EmptyState } from '@/components/studio-kit'
import { useBundle, useWorkspace } from '@/lib/hooks'
import { indexPolicies, policyGuard, policyUsage, type PolicyUsage } from '@/lib/policy'
import { useUI } from '@/lib/store'

import { checkObjectWords, ExpressionWords } from './dataset-view/policy-words'
import { resolveClass } from './inheritance'

export function PolicyUsageSection({
  usage,
  onOpen,
  bundle,
}: {
  usage: PolicyUsage
  onOpen: (key: string) => void
  bundle: StudioSchemaBundle
}) {
  const domainId = bundle.domainId
  const memberLink = (label: string, target: string) => (
    <button
      type="button"
      onClick={() => {
        const ui = useUI.getState()
        if (target.includes('.method.')) ui.revealAnchor(target, domainId)
        else {
          ui.setSection('schema')
          ui.selectClass(target, domainId)
        }
      }}
      className="rounded font-medium hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline focus-visible:outline-none"
    >
      {label}
    </button>
  )
  const link = (ref: IrSchemaRef) => (
    <button
      type="button"
      key={schemaRefKey(ref)}
      onClick={() => onOpen(schemaRefKey(ref))}
      className="rounded text-primary hover:underline"
    >
      {ref.name}
    </button>
  )
  const via = (refs?: IrSchemaRef[]) =>
    refs?.length ? (
      <span className="inline-flex flex-wrap items-baseline gap-1 text-muted-foreground">
        via{' '}
        {refs.map((ref, i) => (
          <span key={schemaRefKey(ref)}>
            {i > 0 && ' → '}
            {link(ref)}
          </span>
        ))}
      </span>
    ) : null
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Used by
      </h3>
      {usage.policies.length + usage.classes.length + usage.callables.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No policy, class or callable references this policy.
        </p>
      ) : (
        <div className="space-y-2 text-[12px]">
          {usage.policies.map((use) => (
            <div key={schemaRefKey(use.ref)} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-muted-foreground">Policy</span> {link(use.ref)} {via(use.via)}
            </div>
          ))}
          {usage.classes.map((use, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span>
                {memberLink(use.className, `class.${use.className}`)} · {use.operation}
              </span>{' '}
              {via(use.via)}
            </div>
          ))}
          {usage.callables.map((use, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span>
                {use.ownerKind === 'class' ? (
                  <>
                    {memberLink(use.owner, `class.${use.owner}`)}.
                    {memberLink(
                      use.name,
                      `${bundle.ir?.classes[use.owner]?.type === 'edge' ? 'edge' : 'class'}.${use.owner}.method.${use.name}`,
                    )}
                  </>
                ) : (
                  memberLink(use.name, `function.${use.name}`)
                )}
              </span>
              <span className="text-muted-foreground">on {checkObjectWords(use.object)}</span>{' '}
              {via(use.via)}
              {use.composed && (
                <span className="text-muted-foreground">(part of a combined check)</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Policy panels also work when their domain is not drawn on the canvas. */
export function SchemaPolicyDetail({
  domainId,
  policyKey,
}: {
  domainId: string
  policyKey: string
}) {
  const ref = parseSchemaRefKey(policyKey)
  const { data: workspace } = useWorkspace()
  const ownerId = workspace?.find((domain) => domain.origin === ref?.origin)?.id ?? domainId
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

function PolicyDetail({ bundle, policyKey }: { bundle: StudioSchemaBundle; policyKey: string }) {
  const ir = bundle.ir!
  const index = useMemo(() => indexPolicies(ir), [ir])
  const policy =
    index.byKey.get(policyKey) ??
    index.byKey.get(schemaRefKey({ origin: ir.domain, kind: 'policy', name: policyKey }))
  if (!policy)
    return (
      <div className="p-5">
        <EmptyState
          title="Policy unavailable"
          hint="This policy's declaration is not available in this domain."
        />
      </div>
    )
  const open = (key: string) => useUI.getState().selectClass(`policy.${key}`, bundle.domainId)
  const guard = policyGuard(policy, index)
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2.5 border-b px-4 py-3 pr-12">
        <ShieldCheck className="h-6 w-6 shrink-0 text-success" />
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{policy.ref.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            {guard === 'edge'
              ? 'guards an edge'
              : guard === 'object'
                ? 'guards a node'
                : 'about the subject'}
          </p>
        </div>
      </div>
      <div className="space-y-5 p-4">
        {policy.description && (
          <p className="text-[13px] leading-relaxed text-foreground/80">{policy.description}</p>
        )}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rule
          </h3>
          <div className="rounded-md border bg-card px-3 py-2.5">
            <ExpressionWords
              policy={policy}
              index={index}
              onOpen={open}
              undirected={(ref) =>
                resolveClass(bundle, { ...ref, kind: 'class' })?.orientation === 'undirected'
              }
            />
          </div>
        </section>
        <PolicyUsageSection usage={policyUsage(ir, policy)} onOpen={open} bundle={bundle} />
        <button
          type="button"
          onClick={() => useUI.getState().openPolicy(schemaRefKey(policy.ref), bundle.domainId)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-primary hover:bg-accent"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Test on a Dataset
        </button>
      </div>
    </div>
  )
}
