import type { IrClassRef, IrEndpoint, StudioSchemaBundle } from '@shared/types'

import { classRefKey, isIrClassRef } from '@shared/types'
import { ArrowRight, Box } from 'lucide-react'

import { useRevealedAnchor } from '@/components/anchor'
import { IconTile, Surface } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useUI } from '@/lib/store'
import { anchorData } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { resolveClass } from '../inheritance'
import { SchemaIcon } from '../schema-icon'
import { cardLabel, isMany, isOptional } from './model'

// ── Edge relationship: directed source → target, with each end's real icon ──
// Endpoints carry a role (`as`), a set of allowed `types` (a union lists several
// exact Classes), and an optional declared `cardinality` ({min,max}; max:null =
// unbounded). Each end is one line — icon, Class, multiplicity — and the connector
// between them carries direction plus the ERD markers (crow's-foot = many, solid
// dot = one, hollow dot = optional).
//
// Everything here is said ONCE. The role is dropped when it only repeats the Class
// it points at, and the "one-to-many" phrasing lives in the connector's hover card
// rather than on the card, where it restated the two multiplicity chips beside it.
export function EdgeRelationship({
  bundle,
  endpoints,
  edgeName,
}: {
  bundle: StudioSchemaBundle
  endpoints: IrEndpoint[]
  edgeName: string
}) {
  const [from, to] = endpoints
  return (
    <Surface className="px-2.5 py-2.5">
      {/* A wrapping row, not a three-column grid: fixed columns squeezed `Opportunity`
          into `Opportu/nity` on a narrow panel. Here each end takes the width it needs
          and the target simply drops to a second line when the panel is too tight. */}
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
        <EndpointCard bundle={bundle} endpoint={from} edgeName={edgeName} />
        <RelConnector edgeName={edgeName} from={from} to={to} />
        <EndpointCard bundle={bundle} endpoint={to} edgeName={edgeName} />
      </div>
    </Surface>
  )
}

/** A role that only echoes the Class it points at is noise — `quote: Quote` says one thing. */
const roleAddsNothing = (role: string | undefined, types: string[]): boolean =>
  !role || types.some((type) => type.toLowerCase() === role.toLowerCase())

// One endpoint: the connected Class on a single line with its multiplicity.
// Single type → one clickable row; a union → an icon+name chip per allowed type.
function EndpointCard({
  bundle,
  endpoint,
  edgeName,
}: {
  bundle: StudioSchemaBundle
  endpoint?: IrEndpoint
  edgeName: string
}) {
  const selectClass = useUI((s) => s.selectClass)
  // The endpoints sit in a wrapping flex row that has to be free to shrink, so the
  // reveal marking goes ON the end itself rather than around it.
  const revealed = useRevealedAnchor(`edge.${edgeName}.endpoint.${endpoint?.name ?? ''}`)
  if (!endpoint) return null
  const ir = bundle.ir
  if (!ir) return null
  const targets: { name: string; ref?: IrClassRef }[] =
    endpoint.refs !== undefined
      ? endpoint.refs.filter(isIrClassRef).map((ref) => ({ name: ref.name, ref }))
      : endpoint.types.map((name) => ({ name }))
  if (targets.length === 0) targets.push({ name: '—' })
  const card = endpoint.cardinality
  // each end is itself a comment target — `edge.<Name>.endpoint.<role>`
  const epAnchor = endpoint.name
    ? anchorData(`edge.${edgeName}.endpoint.${endpoint.name}`, endpoint.name)
    : {}
  const meta = ({ name: t, ref }: (typeof targets)[number]) => {
    if (ref) {
      const local = ref.origin === ir.domain
      const cls = local ? ir.classes[t] : resolveClass(bundle, ref)
      const resolvable = !!cls
      return {
        t,
        key: classRefKey(ref),
        origin: local ? undefined : ref.origin,
        resolvable,
        selectionId: local ? `class.${ref.name}` : `class.${classRefKey(ref)}`,
        icon: cls?.icon as string | undefined,
      }
    }
    const cls = ir.classes[t]
    const resolvable = !!cls
    return {
      t,
      key: `class:${t}`,
      origin: undefined,
      resolvable,
      selectionId: resolvable ? `class.${t}` : undefined,
      icon: cls?.icon as string | undefined,
    }
  }
  const go = (m: { resolvable: boolean; selectionId?: string }) => () => {
    if (m.resolvable && m.selectionId) selectClass(m.selectionId, bundle.domainId)
  }
  const role = roleAddsNothing(
    endpoint.name,
    targets.map((target) => target.name),
  )
    ? undefined
    : endpoint.name
  const cardChip = (
    <span
      className="shrink-0 rounded border border-border px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground"
      title={`declared cardinality — ${cardLabel(card)}`}
    >
      {cardLabel(card)}
    </span>
  )

  // single type — one line
  if (targets.length === 1) {
    const m = meta(targets[0])
    return (
      <button
        type="button"
        onClick={m.resolvable ? go(m) : undefined}
        disabled={!m.resolvable}
        title={m.resolvable ? `Open ${m.t}` : m.origin ? `${m.t} · ${m.origin}` : m.t}
        {...epAnchor}
        {...revealed}
        className={cn(
          'flex min-w-0 max-w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
          m.resolvable ? 'cursor-pointer hover:bg-accent/60' : 'cursor-default',
        )}
      >
        <IconTile tone="node" size="sm">
          {m.icon ? <SchemaIcon svg={m.icon} className="h-3.5 w-3.5" /> : <Box />}
        </IconTile>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium leading-tight">{m.t}</span>
          {role && (
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {role}
            </span>
          )}
        </span>
        {cardChip}
      </button>
    )
  }

  // union — one clickable chip per allowed type
  return (
    <div {...epAnchor} {...revealed} className="flex min-w-0 max-w-full flex-col gap-1 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {targets.map((target) => {
          const m = meta(target)
          return (
            <button
              key={m.key}
              type="button"
              onClick={m.resolvable ? go(m) : undefined}
              disabled={!m.resolvable}
              title={m.resolvable ? `Open ${m.t}` : m.origin ? `${m.t} · ${m.origin}` : m.t}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-border py-0.5 pl-1 pr-1.5 transition-colors',
                m.resolvable ? 'cursor-pointer hover:bg-accent/60' : 'cursor-default',
              )}
            >
              <IconTile tone="node" size="sm" className="h-5 w-5">
                {m.icon ? <SchemaIcon svg={m.icon} className="h-3 w-3" /> : <Box />}
              </IconTile>
              <span className="text-[12px] font-medium">{m.t}</span>
            </button>
          )
        })}
        {cardChip}
      </div>
      <span className="truncate text-[11px] leading-tight text-muted-foreground">
        any of{role ? ` · ${role}` : ''}
      </span>
    </div>
  )
}

// The connector: direction (source → target) plus per-side ERD cardinality markers.
// Hovering it spells the shape out in words — on the card that sentence only
// repeated the multiplicity chips sitting a few pixels to either side of it.
function RelConnector({
  edgeName,
  from,
  to,
}: {
  edgeName: string
  from?: IrEndpoint
  to?: IrEndpoint
}) {
  const lc = from?.cardinality
  const rc = to?.cardinality
  const shape = `${isMany(lc) ? 'many' : 'one'}-to-${isMany(rc) ? 'many' : 'one'}`
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <div
          title={shape}
          className="flex w-[72px] shrink-0 items-center self-center px-1 text-muted-foreground"
        >
          <EndMarker many={isMany(lc)} optional={isOptional(lc)} side="left" />
          <span className="h-px flex-1 bg-border" />
          <ArrowRight className="h-4 w-4 shrink-0" />
          <span className="h-px flex-1 bg-border" />
          <EndMarker many={isMany(rc)} optional={isOptional(rc)} side="right" />
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-64">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-mono text-foreground/80">{edgeName}</span> is {shape}: it links{' '}
          <span className="font-mono text-foreground/80">{cardLabel(lc)}</span> {from?.name} to{' '}
          <span className="font-mono text-foreground/80">{cardLabel(rc)}</span> {to?.name}.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}

// ── End marker: crow's-foot (many) or a dot (one) — SOLID = a single, HOLLOW = optional ──
// The canvas shows direction by default and spells cardinality out in words in its
// cardinality mode; this pane is where the notation itself lives: a point reads as
// "one thing", a fan as "many", hollow vs. solid as "maybe" vs. "definitely".
function EndMarker({
  many,
  optional,
  side,
}: {
  many: boolean
  optional: boolean
  side: 'left' | 'right'
}) {
  return (
    <svg
      viewBox="0 0 24 16"
      className={cn('h-4 w-5 shrink-0', side === 'right' && 'rotate-180')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {many ? (
        <>
          <path d="M22 8 L9 2 M22 8 L9 8 M22 8 L9 14" />
          {/* solid dot ⇒ at least one (1..*); nothing for the optional/unbounded default */}
          {!optional && <circle cx="16" cy="8" r="2.2" fill="currentColor" stroke="none" />}
        </>
      ) : (
        // a single point at the entity — solid (exactly one) or hollow (zero-or-one)
        <circle
          cx="9"
          cy="8"
          r="3"
          fill={optional ? 'none' : 'currentColor'}
          stroke={optional ? 'currentColor' : 'none'}
        />
      )}
    </svg>
  )
}
