import type { IrDefinitionRef, IrEndpoint, StudioSchemaBundle } from '@shared/types'

import { definitionRefKey, isIrDefinitionRef, isIrInterfaceRef } from '@shared/types'
import { ArrowRight, Box, Shapes } from 'lucide-react'

import { Chip, IconTile, Surface } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useUI } from '@/lib/store'
import { anchorData } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { resolveInterface } from '../inheritance'
import { interfaceSelectionId } from '../modules'
import { SchemaIcon } from '../schema-icon'
import { cardLabel, isMany, isOptional } from './model'

// ── Edge relationship: directed source → target, with each end's real icon ──
// Endpoints carry a role (`as`), a set of allowed `types` (a union lists several;
// an interface stands for any class that implements it), and an optional declared
// `cardinality` ({min,max}; max:null = unbounded). We render each end as entity
// tile(s) with a cardinality chip, and a connector whose markers (crow's-foot = many,
// solid dot = one, hollow dot = optional) reflect the real declared multiplicity.
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
    <Surface className="px-3 py-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1">
        <EndpointCard bundle={bundle} endpoint={from} edgeName={edgeName} />
        <RelConnector edgeName={edgeName} from={from} to={to} />
        <EndpointCard bundle={bundle} endpoint={to} edgeName={edgeName} />
      </div>
    </Surface>
  )
}

// One endpoint: the connected class/interface as entity tile(s) with role + cardinality.
// Single type → one prominent clickable tile; a union → an icon+name chip per type.
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
  if (!endpoint) return null
  const ir = bundle.ir
  if (!ir) return null
  const targets: { name: string; ref?: IrDefinitionRef }[] =
    endpoint.refs !== undefined
      ? endpoint.refs.filter(isIrDefinitionRef).map((ref) => ({ name: ref.name, ref }))
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
      const cls = local && ref.kind === 'class' ? ir.classes[t] : undefined
      const iface =
        ref.kind === 'interface'
          ? local
            ? ir.interfaces[t]
            : resolveInterface(bundle, ref)
          : undefined
      const resolvable = !!cls || !!iface
      return {
        t,
        key: definitionRefKey(ref),
        origin: local ? undefined : ref.origin,
        isInterface: ref.kind === 'interface',
        resolvable,
        selectionId: isIrInterfaceRef(ref)
          ? interfaceSelectionId(ref, ir.domain)
          : local
            ? `class.${ref.name}`
            : undefined,
        icon: cls?.icon as string | undefined,
      }
    }
    const cls = ir.classes[t]
    const iface = ir.interfaces[t]
    // A name-only legacy endpoint cannot choose safely between a same-named Class and Interface.
    const resolvable = (!!cls || !!iface) && !(cls && iface)
    return {
      t,
      key: `legacy:${t}`,
      origin: undefined,
      isInterface: !cls && !!iface,
      resolvable,
      selectionId: resolvable ? (!cls && iface ? `interface.${t}` : `class.${t}`) : undefined,
      icon: cls?.icon as string | undefined,
    }
  }
  const go = (m: { resolvable: boolean; selectionId?: string }) => () => {
    if (m.resolvable && m.selectionId) selectClass(m.selectionId)
  }
  const roleChip = (
    <div className="inline-flex max-w-full items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      <span className="truncate">{endpoint.name}</span>
    </div>
  )
  const cardChip = (
    <span
      className="inline-flex items-center rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80"
      title="declared cardinality"
    >
      {cardLabel(card)}
    </span>
  )

  // single type — prominent tile
  if (targets.length === 1) {
    const m = meta(targets[0])
    return (
      <button
        type="button"
        onClick={m.resolvable ? go(m) : undefined}
        disabled={!m.resolvable}
        title={m.resolvable ? `Open ${m.t}` : m.origin ? `${m.t} · ${m.origin}` : m.t}
        {...epAnchor}
        className={cn(
          'group/ep flex flex-col items-center gap-2.5 rounded-xl px-2 py-3 text-center min-w-0 transition-colors',
          m.resolvable ? 'hover:bg-accent/60 cursor-pointer' : 'cursor-default',
        )}
      >
        <IconTile
          tone={m.isInterface ? 'fuchsia' : 'violet'}
          size="lg"
          className="transition-transform group-hover/ep:-translate-y-0.5"
        >
          {m.icon ? (
            <SchemaIcon svg={m.icon} className="h-5 w-5" />
          ) : m.isInterface ? (
            <Shapes />
          ) : (
            <Box />
          )}
        </IconTile>
        <div className="min-w-0 w-full space-y-1.5">
          <div className="text-sm font-bold break-words leading-tight">{m.t}</div>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {roleChip}
            {cardChip}
          </div>
        </div>
      </button>
    )
  }

  // union — one clickable chip per allowed type
  return (
    <div
      {...epAnchor}
      className="flex flex-col items-center gap-2.5 rounded-xl px-2 py-3 text-center min-w-0"
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5">
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
                'inline-flex items-center gap-1.5 rounded-lg border border-border/70 pl-1 pr-2 py-1 transition-colors',
                m.resolvable ? 'hover:bg-accent/60 cursor-pointer' : 'cursor-default',
              )}
            >
              <IconTile tone={m.isInterface ? 'fuchsia' : 'violet'} size="sm">
                {m.icon ? (
                  <SchemaIcon svg={m.icon} className="h-3.5 w-3.5" />
                ) : m.isInterface ? (
                  <Shapes />
                ) : (
                  <Box />
                )}
              </IconTile>
              <span className="text-[13px] font-semibold">{m.t}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="text-[10px] lowercase tracking-wide text-muted-foreground/60">any of</span>
        {roleChip}
        {cardChip}
      </div>
    </div>
  )
}

// The connector: direction (source → target) plus per-side ERD cardinality markers.
// The center pill names the relationship shape; the exact notation is on hover.
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
    <div className="flex flex-col items-center justify-center gap-2 self-center px-1.5 min-w-[84px]">
      <div className="flex w-full items-center text-muted-foreground/45">
        <EndMarker many={isMany(lc)} optional={isOptional(lc)} side="left" />
        <span className="h-px flex-1 bg-border" />
        <ArrowRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground/70" />
        <span className="h-px flex-1 bg-border" />
        <EndMarker many={isMany(rc)} optional={isOptional(rc)} side="right" />
      </div>
      <HoverCard openDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/75 transition-colors hover:text-muted-foreground cursor-default"
          >
            {shape}
          </button>
        </HoverCardTrigger>
        <HoverCardContent className="w-60">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-mono text-foreground/90">{edgeName}</span> links{' '}
            <span className="font-mono text-foreground/90">{cardLabel(lc)}</span> {from?.name} to{' '}
            <span className="font-mono text-foreground/90">{cardLabel(rc)}</span> {to?.name}.
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

// ── End marker: crow's-foot (many) or a dot (one) — SOLID = a single, HOLLOW = optional ──
// Mirrors the canvas markers (see cardinality-markers.tsx): a point reads as "one
// thing", a fan as "many", and hollow vs. solid as "maybe" vs. "definitely".
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
      className={cn('h-4 w-6 shrink-0', side === 'right' && 'rotate-180')}
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
