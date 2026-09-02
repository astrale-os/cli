/** Method security affordance: badge (row glyph + hover), card, inline chip. */
import { schemaRefKey } from '@shared/types'
import { FlaskConical, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'

import { Chip, IconTile } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useBundle } from '@/lib/hooks'
import { type AuthCallable, methodAuth } from '@/lib/method-auth'
import { decodePolicyCheck, indexPolicies, policyCheckLeaves, policyLabel } from '@/lib/policy'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

const TRIGGER_TONE: Record<string, string> = {
  emerald: 'text-success',
  sky: 'text-schema-node',
  amber: 'text-warning',
  rose: 'text-destructive',
}

interface MethodAuthProps {
  method?: AuthCallable
  /** The domain the callable belongs to; absent, the active one. Names its policies. */
  domainId?: string
}

interface MethodAuthBadgeProps extends MethodAuthProps {
  /** Use a non-interactive trigger when the badge sits inside a clickable Row. */
  interactive?: boolean
}

/** Row glyph; hover reveals the full card. */
export function MethodAuthBadge({ method, domainId, interactive = true }: MethodAuthBadgeProps) {
  const v = methodAuth(method)
  if (!v) return null
  const Icon = v.icon
  const triggerClassName = cn(
    'inline-flex items-center justify-center rounded-md transition-colors',
    TRIGGER_TONE[v.tone],
  )
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        {interactive ? (
          <button
            type="button"
            aria-label={`Authorization: ${v.label}`}
            className={triggerClassName}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span role="img" aria-label={`Authorization: ${v.label}`} className={triggerClassName}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 p-0 overflow-hidden">
        <MethodAuthCard method={method} domainId={domainId} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** The policy checks a callable declares, each one written out and one click from its proof. */
function PolicyChecks({ method, domainId }: MethodAuthProps) {
  const activeDomainId = useUI((s) => s.domainId)
  const openPolicy = useUI((s) => s.openPolicy)
  const { data: bundle } = useBundle(domainId ?? activeDomainId)
  const ir = bundle?.ir ?? null
  const index = useMemo(() => (ir ? indexPolicies(ir) : null), [ir])
  const raw = method?.policy
  const check = useMemo(() => (raw === undefined ? undefined : decodePolicyCheck(raw)), [raw])

  if (raw === undefined) return null
  if (!check) {
    return (
      <div className="border-t px-3 py-2 text-[12px] text-warning">
        The Studio could not read this callable’s policy check.
      </div>
    )
  }
  const leaves = policyCheckLeaves(check)
  const composed = !('check' in check)
  return (
    <div className="border-t px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {composed ? ('allOf' in check ? 'Checks all of' : 'Checks any of') : 'Checks'}
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {leaves.map((leaf, i) => {
          const key = schemaRefKey(leaf.check)
          const policy = index?.byKey.get(key)
          const name = index ? policyLabel(leaf.check, index.origin) : leaf.check.name
          return (
            <div key={i} className="flex items-start gap-2 text-[12px]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  on{' '}
                  {leaf.object.kind === 'self'
                    ? 'the receiver (self)'
                    : leaf.object.kind === 'input'
                      ? `input.${leaf.object.field}`
                      : `${leaf.object.ref.kind} ${leaf.object.ref.name}`}
                </span>
                {policy?.description && (
                  <p className="mt-0.5 leading-snug text-muted-foreground">{policy.description}</p>
                )}
              </div>
              {policy && (
                <button
                  type="button"
                  onClick={() => openPolicy(key)}
                  title="Prove this policy on the demo data (Tests)"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <FlaskConical className="h-3 w-3" /> Test
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Full verdict from the canonical callable authentication contract. */
export function MethodAuthCard({ method, domainId }: MethodAuthProps) {
  const v = methodAuth(method)
  if (!v) return null
  const Icon = v.icon
  const authorizedWithoutCheck = v.auth === 'authorized' && method?.policy === undefined
  return (
    <div className="text-[13px]">
      <div className="flex items-start gap-2.5 p-3">
        <IconTile tone={v.tone} size="sm">
          <Icon />
        </IconTile>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{v.label}</span>
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {v.blurb}
            {authorizedWithoutCheck &&
              ' No check of its own: the class-level read and traverse policies, and grants, decide.'}
          </p>
        </div>
      </div>

      <PolicyChecks method={method} domainId={domainId} />

      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
        <Chip tone="outline" className="font-mono">
          auth: {v.auth}
        </Chip>
      </div>
    </div>
  )
}

/** Inline pills naming the policies a callable checks — for rows that cannot hold a button. */
export function PolicyChips({ method, origin }: { method?: AuthCallable; origin?: string }) {
  const raw = method?.policy
  const leaves = useMemo(() => {
    const check = raw === undefined ? undefined : decodePolicyCheck(raw)
    return check ? policyCheckLeaves(check) : []
  }, [raw])
  if (leaves.length === 0) return null
  return (
    <>
      {leaves.map((leaf, i) => (
        <Chip key={i} tone="success" title="policy check — hover the shield for details">
          {origin ? policyLabel(leaf.check, origin) : leaf.check.name}
          {leaf.object.kind === 'self'
            ? ''
            : leaf.object.kind === 'input'
              ? ` · input.${leaf.object.field}`
              : ` · ${leaf.object.ref.name}`}
        </Chip>
      ))}
    </>
  )
}
