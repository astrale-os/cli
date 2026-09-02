import { schemaRefKey } from '@shared/types'
import { AlertTriangle, Link2, ShieldCheck, Spline } from 'lucide-react'

import { type PolicyGuard, type PolicyIndex } from '@/lib/policy'
import { cn } from '@/lib/utils'

const GUARD_TITLE: Record<PolicyGuard, string> = {
  object: 'guards a node',
  edge: 'guards an edge',
  subject: 'about the subject alone',
}

/**
 * The rail's policies: every rule the domain declares, and how many times the selected
 * Dataset proves it. Picking one lights its proofs on the canvas and opens its panel.
 */
export function PoliciesRail({
  index,
  guards,
  counts,
  selectedKey,
  onSelect,
}: {
  index: PolicyIndex
  guards: ReadonlyMap<string, PolicyGuard>
  /** proofs found in the selected Dataset, by policy key; absent ⇒ no Dataset, or unsupported */
  counts: ReadonlyMap<string, number | null> | null
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  return (
    <div className="text-sm py-2 border-b">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Policies
      </div>
      {index.policies.length === 0 && index.unsupported.length === 0 ? (
        <p className="px-3 pt-1 pb-2 text-[12px] text-muted-foreground">
          This domain declares no policy.
        </p>
      ) : (
        index.policies.map((policy) => {
          const key = schemaRefKey(policy.ref)
          const guard = guards.get(key) ?? 'object'
          const count = counts?.get(key)
          const selected = key === selectedKey
          return (
            <button
              key={key}
              type="button"
              data-policy-key={key}
              aria-pressed={selected}
              onClick={() => onSelect(key)}
              title={policy.description ?? GUARD_TITLE[guard]}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-accent',
                selected && 'bg-accent',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center',
                  selected ? 'text-success' : 'text-muted-foreground',
                )}
                title={GUARD_TITLE[guard]}
              >
                {guard === 'edge' ? (
                  <Spline className="h-3.5 w-3.5" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {policy.ref.name}
              </span>
              {counts && (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[11px] tabular-nums',
                    count === null || count === undefined
                      ? 'text-muted-foreground'
                      : count > 0
                        ? 'bg-success/12 text-success'
                        : 'bg-muted text-muted-foreground',
                  )}
                  title={
                    count === null || count === undefined
                      ? 'Cannot be proven on this Dataset'
                      : `${count} proof${count === 1 ? '' : 's'} in this Dataset`
                  }
                >
                  {count === null || count === undefined ? '—' : count}
                </span>
              )}
            </button>
          )
        })
      )}
      {index.unsupported.map((name) => (
        <div
          key={name}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left"
          title="The Studio could not read this policy's declaration"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  )
}
