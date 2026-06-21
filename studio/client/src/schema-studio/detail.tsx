import type {
  HandlerLink,
  IrClass,
  IrEndpoint,
  IrInterface,
  IrMethod,
  JsonSchema,
  SchemaIR,
  StudioSchemaBundle,
} from '@shared/types'

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  FolderClosed,
  Globe,
  HelpCircle,
  Hexagon,
  Layers,
  MousePointerClick,
  Plus,
  Shapes,
  Spline,
} from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { MethodAuthBadge } from '@/components/method-auth'
import {
  Chip,
  DetailsDisclosure,
  EmptyState,
  Group,
  IconTile,
  MetaGrid,
  Row,
  Surface,
} from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { describe, TypeChip, typeLabel } from '@/lib/format'
import { friendlyType, methodGlyph } from '@/lib/friendly'
import { useCatalog, useViewsModel } from '@/lib/hooks'
import { unguardedCount } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { viewsForClass } from '@/lib/views'

import {
  type InheritedGroup,
  type InterfaceTier,
  inheritedCount,
  inheritedGroupsOfClass,
  inheritedGroupsOfInterface,
} from './inheritance'
import { type MemberRef, moduleMembers } from './modules'
import { SchemaIcon } from './schema-icon'
import { ViewRow } from './views-panel'

/**
 * The schema detail pane — the studio's most important read surface.
 * Friendly by default (icons, names, one-line descriptions), with the technical
 * metadata (raw types, qualified keys, signatures, static/instance, handler
 * file:line, kernel ops, core refs) relocated behind HoverCards and a per-method
 * DetailsDisclosure. Everything meaningful carries an AnchorButton so it can be
 * commented on hover.
 */

// A subtle "Back" affordance: restores the previous selection. Renders nothing
// until you've navigated at least once (selectionHistory non-empty).
function BackBar() {
  const back = useUI((s) => s.back)
  const canGoBack = useUI((s) => s.selectionHistory.length > 0)
  if (!canGoBack) return null
  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={() => back()}
        title="Back to previous selection"
        className="group inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground/55 transition-colors hover:bg-accent/50 hover:text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Back
      </button>
    </div>
  )
}

export function SchemaDetail({
  bundle,
  selected,
}: {
  bundle: StudioSchemaBundle
  selected?: string
}) {
  const ir = bundle.ir
  const selectClass = useUI((s) => s.selectClass)
  const { data: catalog } = useCatalog()
  const viewsModel = useViewsModel(bundle.domainId)
  // resolve a domain's catalog icon (kernel hexagon, cross-domain glyph) so an
  // inherited-group header can show "the icon of the domain" instead of its origin.
  const originIcon = (origin?: string): string | undefined =>
    origin ? catalog?.find((e) => e.origin === origin)?.icon : undefined

  if (!ir || !selected) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <EmptyState
          icon={<MousePointerClick />}
          title="Nothing selected"
          hint="Pick a class, interface, or edge in the graph to see its properties, methods, and handlers."
        />
      </div>
    )
  }

  if (selected.startsWith('module.'))
    return <ModuleDetail bundle={bundle} path={selected.slice('module.'.length)} />

  const [kind, name] = splitId(selected)
  const localMember: IrClass | IrInterface | undefined =
    kind === 'interface' ? ir.interfaces[name] : ir.classes[name]
  // imported (kernel/cross-domain) interfaces live in ir.imports, not ir.interfaces —
  // fall back to their recovered body so an inherited-group header opens read-only detail.
  const importedIface =
    kind === 'interface' && !localMember ? bundle.importedInterfaces?.[name] : undefined
  const member: IrClass | IrInterface | undefined = localMember ?? importedIface
  if (!member) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <EmptyState title="Not found" hint={selected} />
      </div>
    )
  }

  const isEdge = (member as IrClass).type === 'edge'
  const memberKind = kind === 'interface' ? 'interface' : isEdge ? 'edge' : 'class'
  const refBase =
    memberKind === 'interface' ? `interface.${name}` : isEdge ? `edge.${name}` : `class.${name}`
  const span = bundle.overlay.sourceSpans[refBase]

  const props = Object.entries(member.properties ?? {})
  const methods = Object.entries(member.methods ?? {})
  const endpoints = (member as IrClass).endpoints ?? []

  // implements → split into domain interfaces (clickable chips) vs kernel mixins (tucked away)
  const impls = (member as IrClass).implements ?? []
  const domainIfaces = impls.filter((i) => !!ir.interfaces[i])
  const kernelMixins = impls.filter((i) => !ir.interfaces[i])
  const extendsList = (member as IrInterface).extends ?? []

  // inherited members (from implemented interfaces / extended interfaces), grouped
  // by source interface — the IR doesn't flatten these into the member's own fields.
  const inherited =
    memberKind === 'interface'
      ? inheritedGroupsOfInterface(bundle, name)
      : inheritedGroupsOfClass(bundle, name)

  const tone = memberKind === 'interface' ? 'fuchsia' : memberKind === 'edge' ? 'violet' : 'violet'
  const icon = (member as IrClass).icon
  const classViews = viewsForClass(viewsModel, name)

  return (
    <div className="h-full overflow-y-auto">
      <BackBar />
      <div className="px-5 py-6 space-y-7">
        {/* ── Header ── */}
        <header
          className="group space-y-3"
          data-anchor-ref={refBase}
          data-anchor-excerpt={name}
          data-commentable=""
        >
          <div className="flex items-start gap-3.5">
            <IconTile tone={tone} size="lg">
              {icon ? <SchemaIcon svg={icon} className="h-5 w-5" /> : <Shapes />}
            </IconTile>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold tracking-tight truncate">{name}</h2>
                {memberKind === 'interface' && <Chip tone="fuchsia">interface</Chip>}
                {importedIface && (
                  <Chip tone="outline">{originLabel(ir.imports[name]?.origin)}</Chip>
                )}
                {memberKind === 'edge' && <Chip tone="outline">edge</Chip>}
                <AnchorButton
                  anchorRef={{ ref: refBase, kind: 'schema', file: span?.file }}
                  excerpt={name}
                  className="ml-auto"
                />
              </div>
              {span?.doc && (
                <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{span.doc}</p>
              )}
            </div>
          </div>

          {/* relations: domain interface chips + tucked-away kernel mixins */}
          {(domainIfaces.length > 0 || kernelMixins.length > 0 || extendsList.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
              {extendsList.map((i) => (
                <Chip key={`ext-${i}`} tone="outline">
                  extends {i}
                </Chip>
              ))}
              {domainIfaces.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectClass(`interface.${i}`)}
                  className="rounded-full transition-transform hover:-translate-y-px"
                >
                  <Chip tone="fuchsia" className="cursor-pointer hover:bg-fuchsia-500/20">
                    <Shapes className="h-3 w-3" /> {i}
                  </Chip>
                </button>
              ))}
              {kernelMixins.length > 0 && (
                <HoverCard openDelay={80}>
                  <HoverCardTrigger asChild>
                    <button type="button" className="rounded-full">
                      <Chip tone="default" className="cursor-default">
                        <Plus className="h-3 w-3" /> {kernelMixins.length} base
                      </Chip>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-56">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Kernel mixins
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {kernelMixins.map((i) => (
                        <Chip key={i} tone="outline">
                          {i}
                        </Chip>
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          )}
        </header>

        {/* ── Edge relationship ── */}
        {isEdge && endpoints.length >= 2 && (
          <Group label="Relationship">
            <EdgeRelationship ir={ir} endpoints={endpoints} edgeName={name} />
          </Group>
        )}

        {/* ── Properties ── */}
        {props.length > 0 && (
          <Group label="Properties" hint={`${props.length}`}>
            <Surface className="divide-y divide-border/70">
              {props.map(([pname, schema]) => (
                <PropertyRow
                  key={pname}
                  bundle={bundle}
                  refBase={refBase}
                  pname={pname}
                  schema={schema as JsonSchema}
                />
              ))}
            </Surface>
          </Group>
        )}

        {/* ── Methods ── */}
        {methods.length > 0 && (
          <Group
            label="Methods"
            hint={(() => {
              const unguarded = unguardedCount(
                methods.map(([mname]) =>
                  bundle.overlay.handlerLinks.find((h) => h.owner === name && h.method === mname),
                ),
              )
              return (
                <span className="inline-flex items-center gap-2">
                  {unguarded > 0 && <Chip tone="warning">{unguarded} unguarded</Chip>}
                  {methods.length}
                </span>
              )
            })()}
          >
            <div className="space-y-2.5">
              {methods.map(([mname, method]) => (
                <MethodCard
                  key={mname}
                  bundle={bundle}
                  owner={name}
                  refBase={refBase}
                  mname={mname}
                  method={method}
                />
              ))}
            </div>
          </Group>
        )}

        {/* ── Views bound to this class (viewFor: selfOf(Class)) ── */}
        {classViews.length > 0 && (
          <Group label="Views" hint={`${classViews.length}`}>
            <div className="flex flex-col gap-0.5">
              {classViews.map((v) => (
                <ViewRow key={v.slug} domainId={bundle.domainId} view={v} icon={icon} />
              ))}
            </div>
          </Group>
        )}

        {/* ── Inherited (from implemented / extended interfaces) ── */}
        {inherited.length > 0 && (
          <InheritedSection bundle={bundle} groups={inherited} originIcon={originIcon} />
        )}

        {props.length === 0 && methods.length === 0 && inherited.length === 0 && !isEdge && (
          <EmptyState
            title="No properties or methods"
            hint="This member carries no fields of its own."
          />
        )}
      </div>
    </div>
  )
}

// ── Edge relationship: directed source → target, with each end's real icon ──
// Endpoints carry a role (`as`), a set of allowed `types` (a union lists several;
// an interface stands for any class that implements it), and an optional declared
// `cardinality` ({min,max}; max:null = unbounded). We render each end as entity
// tile(s) with a cardinality chip, and a connector whose ERD markers (crow's-foot
// = many, bar = one, hollow ring = optional) reflect the real declared multiplicity.
function EdgeRelationship({
  ir,
  endpoints,
  edgeName,
}: {
  ir: SchemaIR
  endpoints: IrEndpoint[]
  edgeName: string
}) {
  const [from, to] = endpoints
  return (
    <Surface className="px-3 py-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1">
        <EndpointCard ir={ir} endpoint={from} />
        <RelConnector edgeName={edgeName} from={from} to={to} />
        <EndpointCard ir={ir} endpoint={to} />
      </div>
    </Surface>
  )
}

// ── cardinality helpers (max:null = unbounded; undeclared ⇒ unconstrained = many) ──
type Card = { min: number; max: number | null }
function cardLabel(c?: Card): string {
  if (!c) return '*'
  const { min, max } = c
  if (max === null) return min <= 0 ? '*' : `${min}..*`
  if (min === max) return `${max}`
  return `${min}..${max}`
}
const isMany = (c?: Card) => !c || c.max === null || c.max > 1
const isOptional = (c?: Card) => !c || c.min <= 0

// One endpoint: the connected class/interface as entity tile(s) with role + cardinality.
// Single type → one prominent clickable tile; a union → an icon+name chip per type.
function EndpointCard({ ir, endpoint }: { ir: SchemaIR; endpoint?: IrEndpoint }) {
  const selectClass = useUI((s) => s.selectClass)
  if (!endpoint) return null
  const types = endpoint.types.length ? endpoint.types : ['—']
  const card = endpoint.cardinality
  const meta = (t: string) => {
    const cls = ir.classes[t]
    const iface = ir.interfaces[t]
    return {
      t,
      isInterface: !cls && !!iface,
      resolvable: !!cls || !!iface,
      icon: cls?.icon as string | undefined,
    }
  }
  const go = (m: { t: string; isInterface: boolean; resolvable: boolean }) => () => {
    if (m.resolvable) selectClass(m.isInterface ? `interface.${m.t}` : `class.${m.t}`)
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
  if (types.length === 1) {
    const m = meta(types[0])
    return (
      <button
        type="button"
        onClick={m.resolvable ? go(m) : undefined}
        disabled={!m.resolvable}
        title={m.resolvable ? `Open ${m.t}` : m.t}
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
    <div className="flex flex-col items-center gap-2.5 rounded-xl px-2 py-3 text-center min-w-0">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {types.map((t) => {
          const m = meta(t)
          return (
            <button
              key={t}
              type="button"
              onClick={m.resolvable ? go(m) : undefined}
              disabled={!m.resolvable}
              title={m.resolvable ? `Open ${t}` : t}
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
              <span className="text-[13px] font-semibold">{t}</span>
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

// ── ERD end marker: crow's-foot (many) or bar (one); hollow ring when optional ──
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
      {many ? <path d="M22 8 L9 2 M22 8 L9 8 M22 8 L9 14" /> : <path d="M22 8 L9 8 M9 3 L9 13" />}
      {optional && <circle cx="5" cy="8" r="2.3" />}
    </svg>
  )
}

// ── Property row ──
// A property/method's parsed description (JSDoc/comment), tucked behind a small
// "?" so it's there on hover without spelling every doc out inline.
function DocHint({ doc }: { doc: string }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Description"
          className="text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {doc}
      </HoverCardContent>
    </HoverCard>
  )
}

function PropertyRow({
  bundle,
  refBase,
  pname,
  schema,
}: {
  bundle: StudioSchemaBundle
  refBase: string
  pname: string
  schema: JsonSchema
}) {
  const pref = `${refBase}.property.${pname}`
  const pdoc = bundle.overlay.sourceSpans[pref]?.doc
  const ft = friendlyType(schema)
  const Icon = ft.icon
  const warns = bundle.overlay.annotations.filter((a) => a.target === pref)
  const d = describe(schema)

  return (
    <Row
      anchorRef={pref}
      anchorExcerpt={pname}
      leading={
        <IconTile tone="sky" size="sm">
          <Icon />
        </IconTile>
      }
      title={
        <span className="flex items-center gap-1.5">
          {pname}
          {pdoc && <DocHint doc={pdoc} />}
          {ft.optional && <Chip tone="default">optional</Chip>}
          {warns.map((w) => (
            <Chip key={w.code} tone="warning" title={w.message}>
              {w.code === 'ENUM_DROPPED_BY_UPDATE' ? 'enum changes need migration' : w.code}
            </Chip>
          ))}
        </span>
      }
      subtitle={
        <HoverCard openDelay={140}>
          <HoverCardTrigger asChild>
            <span className="cursor-default">{ft.label}</span>
          </HoverCardTrigger>
          <HoverCardContent className="w-auto max-w-sm">
            <MetaGrid
              items={[
                { label: 'type', value: typeLabel(d) + (ft.optional ? ' (optional)' : '') },
                { label: 'key', value: pref },
              ]}
            />
          </HoverCardContent>
        </HoverCard>
      }
      trailing={
        <AnchorButton
          anchorRef={{ ref: pref, kind: 'schema', file: bundle.overlay.sourceSpans[pref]?.file }}
          excerpt={pname}
        />
      }
    />
  )
}

// ── Method card ──
function MethodCard({
  bundle,
  owner,
  refBase,
  mname,
  method,
  overridden = false,
}: {
  bundle: StudioSchemaBundle
  owner: string
  refBase: string
  mname: string
  method: IrMethod
  overridden?: boolean
}) {
  const mref = `${refBase}.method.${mname}`
  const link = bundle.overlay.handlerLinks.find((h) => h.owner === owner && h.method === mname)
  const doc = bundle.overlay.sourceSpans[mref]?.doc
  const glyph = methodGlyph(method)
  const Glyph = glyph.icon

  const contractOnly = link && !link.implemented
  const unlinked = link?.unlinked

  return (
    <Surface
      className="px-3 py-2.5"
      data-anchor-ref={mref}
      data-anchor-excerpt={`${owner}.${mname}`}
      data-commentable=""
    >
      <Row
        className="px-0 py-0 hover:bg-transparent"
        leading={
          <IconTile tone={glyph.tone} size="sm">
            <Glyph />
          </IconTile>
        }
        title={
          <span className="flex items-center gap-1.5">
            <span className={cn(overridden && 'line-through text-muted-foreground/70')}>
              {mname}
            </span>
            <MethodAuthBadge link={link} />
            {doc && <DocHint doc={doc} />}
            {method.inheritance === 'sealed' && <Chip tone="warning">sealed</Chip>}
            {method.inheritance === 'abstract' && <Chip tone="fuchsia">contract</Chip>}
            {overridden && <Chip tone="default">overridden</Chip>}
            {contractOnly && <Chip tone="warning">needs handler</Chip>}
            {unlinked && <Chip tone="default">unlinked</Chip>}
          </span>
        }
        trailing={
          <AnchorButton
            anchorRef={{ ref: mref, kind: 'schema', file: bundle.overlay.sourceSpans[mref]?.file }}
            excerpt={`${owner}.${mname}`}
          />
        }
      />

      <div className="pl-[2.625rem] pt-1.5">
        <DetailsDisclosure label="Details">
          <MethodDetails method={method} link={link} owner={owner} />
        </DetailsDisclosure>
      </div>
    </Surface>
  )
}

function MethodDetails({
  method,
  link,
  owner,
}: {
  method: IrMethod
  link?: HandlerLink
  owner: string
}) {
  const params = Object.entries(method.params ?? {})
  return (
    <div className="space-y-3 pb-1">
      {/* params: name + type */}
      {params.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Input
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {params.map(([pn, ps]) => {
              const ft = friendlyType(ps as JsonSchema)
              return (
                <span key={pn} className="inline-flex items-baseline gap-1.5">
                  <span className="font-medium">{pn}</span>
                  <span className="text-muted-foreground">
                    {ft.label}
                    {ft.optional ? '?' : ''}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* static/instance (auth verdict lives on the row badge) */}
      <ReceiverBadge owner={owner} isStatic={method.static} />

      {/* external kernel ops, e.g. ::link / ::update */}
      {link?.kernelCalls && link.kernelCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {link.kernelCalls.map((k) => (
            <Chip key={k} tone="outline" className="font-mono">
              {k}
            </Chip>
          ))}
        </div>
      )}

      {/* return type */}
      <div className="pt-0.5">
        <span className="text-[11px] text-muted-foreground/60">returns </span>
        <TypeChip schema={method.returns} />
      </div>
    </div>
  )
}

// ── Receiver badge: plain-language "what does this method run on?" ──
// Replaces the jargon "instance"/"static". An instance method runs on one
// specific record (the implicit receiver — what a programmer would call `this`),
// a static method runs on the type itself. We name the owner so it reads plainly.
function ReceiverBadge({ owner, isStatic }: { owner: string; isStatic: boolean }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button type="button" className="cursor-default rounded-full">
          <Chip tone="outline">
            {isStatic ? <Layers className="h-3 w-3" /> : <Box className="h-3 w-3" />}{' '}
            {isStatic ? `on the ${owner} type` : `on a ${owner}`}
          </Chip>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-[15rem]">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {isStatic ? (
            <>
              Acts on the <span className="font-medium text-foreground/90">{owner} type</span>.{' '}
              <span className="text-muted-foreground/60">(static)</span>
            </>
          ) : (
            <>
              Acts on a single <span className="font-medium text-foreground/90">{owner}</span>.{' '}
              <span className="text-muted-foreground/60">(instance)</span>
            </>
          )}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}

// ── Inherited section: members a class/interface gets from the interfaces it
// implements/extends. Rendered at the SAME weight as the member's own fields —
// real PropertyRow / MethodCard (icons, friendly types, the method details
// disclosure) — grouped under each source interface and marked inherited by a
// tier-coloured left rail + a clickable interface header. They're load-bearing,
// so they read that way; the rail just says where they come from.
function InheritedSection({
  bundle,
  groups,
  originIcon,
}: {
  bundle: StudioSchemaBundle
  groups: InheritedGroup[]
  originIcon: (o?: string) => string | undefined
}) {
  const selectClass = useUI((s) => s.selectClass)
  return (
    <Group label="Inherited" hint={`${inheritedCount(groups)}`}>
      <div className="space-y-5">
        {groups.map((g) => {
          const rail =
            g.tier === 'local'
              ? 'border-l-fuchsia-500/40'
              : g.tier === 'external'
                ? 'border-l-sky-500/40'
                : 'border-l-border'
          const tileTone = g.tier === 'local' ? 'fuchsia' : g.tier === 'external' ? 'sky' : 'muted'
          const refBase = `interface.${g.iface}`
          return (
            <div key={g.iface} className={cn('border-l-2 pl-3.5', rail)}>
              {/* interface header — substantial + clickable → its detail */}
              <button
                type="button"
                onClick={() => selectClass(refBase)}
                title={g.origin ?? 'this domain'}
                className="group/ih mb-2.5 flex w-full items-center gap-2.5 text-left"
              >
                <IconTile tone={tileTone} size="sm">
                  <InterfaceGlyphInner tier={g.tier} iconSvg={originIcon(g.origin)} />
                </IconTile>
                <span className="text-sm font-semibold tracking-tight group-hover/ih:text-foreground transition-colors">
                  {g.iface}
                </span>
                <Chip tone={g.tier === 'local' ? 'fuchsia' : 'outline'}>
                  {g.tier === 'local' ? 'interface' : originLabel(g.origin)}
                </Chip>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 group-hover/ih:text-muted-foreground transition-colors">
                  inherited <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </button>
              {/* full-weight members — identical treatment to the member's own */}
              <div className="space-y-2.5">
                {g.props.length > 0 && (
                  <Surface className="divide-y divide-border/70">
                    {g.props.map(([pname, schema]) => (
                      <PropertyRow
                        key={`p-${pname}`}
                        bundle={bundle}
                        refBase={refBase}
                        pname={pname}
                        schema={schema as JsonSchema}
                      />
                    ))}
                  </Surface>
                )}
                {g.methods.map((m) => (
                  <MethodCard
                    key={`m-${m.name}`}
                    bundle={bundle}
                    owner={g.iface}
                    refBase={refBase}
                    mname={m.name}
                    method={m.method}
                    overridden={m.overridden}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Group>
  )
}

// The interface's icon for an IconTile: own-domain → fuchsia Shapes glyph; kernel /
// cross-domain → the source domain's catalog icon (falling back to a tier glyph).
function InterfaceGlyphInner({ tier, iconSvg }: { tier: InterfaceTier; iconSvg?: string }) {
  if (tier === 'local') return <Shapes />
  if (iconSvg) return <SchemaIcon svg={iconSvg} className="h-4 w-4" />
  return tier === 'kernel' ? <Hexagon /> : <Globe />
}

/** Short origin label for an imported interface's header chip ("kernel", "notifications"). */
function originLabel(origin?: string): string {
  if (!origin) return 'imported'
  if (origin === 'kernel.astrale.ai') return 'kernel'
  return origin.split('.')[0]
}

function ModuleDetail({ bundle, path }: { bundle: StudioSchemaBundle; path: string }) {
  const selectClass = useUI((s) => s.selectClass)
  const info = moduleMembers(bundle, path)

  const memberRow = (m: MemberRef) => (
    <Row
      key={m.selectId}
      onClick={() => selectClass(m.selectId)}
      leading={
        <IconTile
          tone={m.kind === 'interface' ? 'fuchsia' : m.kind === 'edge' ? 'amber' : 'sky'}
          size="sm"
        >
          {m.icon ? (
            <SchemaIcon svg={m.icon} className="h-4 w-4" />
          ) : m.kind === 'interface' ? (
            <Shapes />
          ) : m.kind === 'edge' ? (
            <Spline />
          ) : (
            <Box />
          )}
        </IconTile>
      }
      title={m.name}
    />
  )

  return (
    <div className="h-full overflow-y-auto">
      <BackBar />
      <div className="px-5 py-6 space-y-7">
        <header className="flex items-start gap-3.5">
          <IconTile tone="muted" size="lg" style={{ color: `oklch(0.82 0.12 ${info.hue})` }}>
            <FolderClosed />
          </IconTile>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-lg font-extrabold tracking-tight truncate">{info.label}</h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              {info.classes.length} {info.classes.length === 1 ? 'class' : 'classes'}
              {info.interfaces.length > 0 &&
                ` · ${info.interfaces.length} interface${info.interfaces.length === 1 ? '' : 's'}`}
              {info.edges.length > 0 &&
                ` · ${info.edges.length} relationship${info.edges.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </header>

        {info.interfaces.length > 0 && (
          <Group label="Interfaces">
            <Surface className="divide-y divide-border/70">
              {info.interfaces.map(memberRow)}
            </Surface>
          </Group>
        )}
        {info.classes.length > 0 && (
          <Group label="Classes">
            <Surface className="divide-y divide-border/70">{info.classes.map(memberRow)}</Surface>
          </Group>
        )}
        {info.edges.length > 0 && (
          <Group label="Relationships">
            <Surface className="divide-y divide-border/70">{info.edges.map(memberRow)}</Surface>
          </Group>
        )}
      </div>
    </div>
  )
}

function splitId(id: string): ['interface' | 'class', string] {
  const [k, ...rest] = id.split('.')
  return [k === 'interface' ? 'interface' : 'class', rest.join('.')]
}
