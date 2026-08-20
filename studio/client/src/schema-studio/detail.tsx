import type {
  HandlerLink,
  IrClass,
  IrDefinitionKey,
  IrDefinitionRef,
  IrEndpoint,
  IrInterface,
  IrMethod,
  IrSchemaRef,
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
import { handlerLinkFor, unguardedCount } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { anchorData, schemaMemberRef } from '@/lib/targets'
import { cn } from '@/lib/utils'
import { viewsForClass } from '@/lib/views'

import {
  type InheritedGroup,
  type InterfaceTier,
  inheritedCount,
  inheritedGroupsOfClass,
  inheritedGroupsOfInterface,
  interfaceTier,
  resolveInterface,
} from './inheritance'
import {
  type InterfaceDefinitionRef,
  type InterfaceReference,
  type MemberRef,
  implementedInterfaceRefsOf,
  interfaceSelectionId,
  moduleMembers,
  parseInterfaceSelectionToken,
} from './modules'
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

interface InterfaceRelation {
  name: string
  reference: InterfaceReference
  identity: string
  tier: InterfaceTier
  origin?: string
  selectionId: string
  navigable: boolean
}

function isDefinitionRef(ref: IrSchemaRef): ref is IrDefinitionRef {
  return ref.kind === 'class' || ref.kind === 'interface'
}

function isInterfaceRef(ref: IrSchemaRef): ref is IrDefinitionRef & { kind: 'interface' } {
  return ref.kind === 'interface'
}

function definitionKey(ref: IrDefinitionRef): IrDefinitionKey {
  return `${ref.origin}:${ref.kind}.${ref.name}`
}

function selectedInterfaceRef(ir: SchemaIR, token: string): InterfaceDefinitionRef | undefined {
  const parsed = parseInterfaceSelectionToken(token)
  if (!parsed) return undefined
  if (parsed.origin === ir.domain) return ir.interfaces[parsed.name] ? parsed : undefined
  const key = definitionKey(parsed)
  const descriptor = ir.importsByKey?.[key]
  if (descriptor?.ref && isInterfaceRef(descriptor.ref)) return descriptor.ref
  const body = ir.importedInterfacesByKey?.[key]
  if (body?.ref && isInterfaceRef(body.ref)) return body.ref
  return body ? parsed : undefined
}

function interfaceRelations(
  bundle: StudioSchemaBundle,
  refs: IrSchemaRef[] | undefined,
  legacyNames: string[] | undefined,
): InterfaceRelation[] {
  const references: InterfaceReference[] =
    refs !== undefined ? refs.filter(isInterfaceRef) : (legacyNames ?? [])
  return references.map((reference) => ({
    name: typeof reference === 'string' ? reference : reference.name,
    reference,
    identity: typeof reference === 'string' ? `legacy:${reference}` : definitionKey(reference),
    tier: interfaceTier(bundle, reference),
    origin:
      typeof reference === 'string'
        ? bundle.ir?.imports[reference]?.origin
        : reference.origin === bundle.ir?.domain
          ? undefined
          : reference.origin,
    selectionId: interfaceSelectionId(reference, bundle.ir?.domain),
    navigable: resolveInterface(bundle, reference) !== undefined,
  }))
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

  const [kind, selectedName] = splitId(selected)
  const exactSelectedInterface =
    kind === 'interface' ? selectedInterfaceRef(ir, selectedName) : undefined
  const name = exactSelectedInterface?.name ?? selectedName
  const localMember: IrClass | IrInterface | undefined =
    kind === 'interface'
      ? exactSelectedInterface
        ? exactSelectedInterface.origin === ir.domain
          ? ir.interfaces[name]
          : undefined
        : ir.interfaces[name]
      : ir.classes[name]
  // imported (kernel/cross-domain) interfaces live in ir.imports, not ir.interfaces —
  // fall back to their recovered body so an inherited-group header opens read-only detail.
  const importedIface =
    kind === 'interface' && !localMember
      ? exactSelectedInterface
        ? resolveInterface(bundle, exactSelectedInterface)
        : bundle.importedInterfaces?.[name]
      : undefined
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
  const importedRef =
    importedIface?.ref && isInterfaceRef(importedIface.ref)
      ? importedIface.ref
      : exactSelectedInterface?.origin !== ir.domain
        ? exactSelectedInterface
        : undefined
  const refBase = importedRef
    ? interfaceSelectionId(importedRef, ir.domain)
    : schemaMemberRef(memberKind, name)
  const span = bundle.overlay.sourceSpans[refBase]

  const props = Object.entries(member.properties ?? {})
  const requiredProperties = member.required
  const methods = Object.entries(member.methods ?? {})
  const endpoints = (member as IrClass).endpoints ?? []

  // implements → split into domain interfaces (clickable chips) vs kernel mixins (tucked away)
  const cls = member as IrClass
  const iface = member as IrInterface
  const implementedRefs =
    memberKind === 'interface' ? undefined : implementedInterfaceRefsOf(bundle, name)
  const impls = interfaceRelations(
    bundle,
    cls.implementsRefs !== undefined ? implementedRefs : undefined,
    cls.implements,
  )
  const domainIfaces = impls.filter((relation) => relation.tier !== 'kernel')
  const kernelMixins = impls.filter((relation) => relation.tier === 'kernel')
  const extendsList = interfaceRelations(bundle, iface.extendsRefs, iface.extends)

  // inherited members (from implemented interfaces / extended interfaces), grouped
  // by source interface — the IR doesn't flatten these into the member's own fields.
  const inherited =
    memberKind === 'interface'
      ? inheritedGroupsOfInterface(bundle, importedRef ?? name)
      : inheritedGroupsOfClass(bundle, name)

  const tone = memberKind === 'interface' ? 'fuchsia' : memberKind === 'edge' ? 'violet' : 'violet'
  const icon = (member as IrClass).icon
  const classViews = memberKind === 'interface' ? [] : viewsForClass(viewsModel, name)

  return (
    // The pane is a comment SCOPE: any click that doesn't land on a more specific
    // marked element (a property/method row, an endpoint) resolves to this member
    // rather than collapsing to the section. More-specific descendants still win
    // because the resolver climbs to the NEAREST `data-anchor-ref` ancestor.
    <div className="h-full overflow-y-auto" {...anchorData(refBase, name)}>
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
                  <Chip tone="outline">
                    {originLabel(importedRef?.origin ?? ir.imports[name]?.origin)}
                  </Chip>
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
              {extendsList.map((relation) => (
                <button
                  key={`ext-${relation.identity}`}
                  type="button"
                  disabled={!relation.navigable}
                  onClick={() =>
                    relation.navigable ? selectClass(relation.selectionId) : undefined
                  }
                  className={cn(
                    'rounded-full',
                    relation.navigable && 'transition-transform hover:-translate-y-px',
                  )}
                >
                  <Chip
                    tone="outline"
                    className={cn(relation.navigable && 'cursor-pointer hover:bg-accent/70')}
                  >
                    extends {relation.name}
                    {relation.origin ? ` · ${originLabel(relation.origin)}` : ''}
                  </Chip>
                </button>
              ))}
              {domainIfaces.map((relation) => (
                <button
                  key={relation.identity}
                  type="button"
                  disabled={!relation.navigable}
                  onClick={() =>
                    relation.navigable ? selectClass(relation.selectionId) : undefined
                  }
                  className={cn(
                    'rounded-full',
                    relation.navigable && 'transition-transform hover:-translate-y-px',
                  )}
                >
                  <Chip
                    tone="fuchsia"
                    className={cn(relation.navigable && 'cursor-pointer hover:bg-fuchsia-500/20')}
                  >
                    <Shapes className="h-3 w-3" /> {relation.name}
                    {relation.origin ? ` · ${originLabel(relation.origin)}` : ''}
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
                      {kernelMixins.map((relation) => (
                        <Chip key={relation.identity} tone="outline">
                          {relation.name}
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
            <EdgeRelationship bundle={bundle} endpoints={endpoints} edgeName={name} />
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
                  optional={requiredProperties ? !requiredProperties.includes(pname) : undefined}
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
                methods.map(([mname, method]) => ({
                  method,
                  link: importedIface
                    ? undefined
                    : handlerLinkFor(
                        bundle.overlay.handlerLinks,
                        name,
                        mname,
                        memberKind === 'interface' ? 'interface' : 'class',
                      ),
                })),
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
                  ownerKind={memberKind === 'interface' ? 'interface' : 'class'}
                  handlerOwnerLocal={!importedIface}
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
// tile(s) with a cardinality chip, and a connector whose markers (crow's-foot = many,
// solid dot = one, hollow dot = optional) reflect the real declared multiplicity.
function EdgeRelationship({
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
      ? endpoint.refs.filter(isDefinitionRef).map((ref) => ({ name: ref.name, ref }))
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
        key: definitionKey(ref),
        origin: local ? undefined : ref.origin,
        isInterface: ref.kind === 'interface',
        resolvable,
        selectionId: isInterfaceRef(ref)
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
  optional,
}: {
  bundle: StudioSchemaBundle
  refBase: string
  pname: string
  schema: JsonSchema
  /** Canonical required membership; undefined lets legacy nullable schemas decide. */
  optional?: boolean
}) {
  const pref = `${refBase}.property.${pname}`
  const pdoc = bundle.overlay.sourceSpans[pref]?.doc
  const ft = friendlyType(schema, optional)
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
              {w.code}
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
  ownerKind = 'class',
  handlerOwnerLocal = true,
  refBase,
  mname,
  method,
  overridden = false,
}: {
  bundle: StudioSchemaBundle
  owner: string
  ownerKind?: HandlerLink['ownerKind']
  handlerOwnerLocal?: boolean
  refBase: string
  mname: string
  method: IrMethod
  overridden?: boolean
}) {
  const mref = `${refBase}.method.${mname}`
  const link = handlerOwnerLocal
    ? handlerLinkFor(bundle.overlay.handlerLinks, owner, mname, ownerKind)
    : undefined
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
            <MethodAuthBadge method={method} link={link} />
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
              const optional = method.requiredParams
                ? !method.requiredParams.includes(pn)
                : undefined
              const ft = friendlyType(ps as JsonSchema, optional)
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
          const refBase = g.ref
            ? interfaceSelectionId(g.ref, bundle.ir?.domain)
            : `interface.${g.iface}`
          return (
            <div key={refBase} className={cn('border-l-2 pl-3.5', rail)}>
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
                    {g.props.map(([pname, schema, optional]) => (
                      <PropertyRow
                        key={`p-${pname}`}
                        bundle={bundle}
                        refBase={refBase}
                        pname={pname}
                        schema={schema as JsonSchema}
                        optional={optional}
                      />
                    ))}
                  </Surface>
                )}
                {g.methods.map((m) => (
                  <MethodCard
                    key={`m-${m.name}`}
                    bundle={bundle}
                    owner={g.iface}
                    ownerKind="interface"
                    handlerOwnerLocal={g.tier === 'local'}
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
      anchorRef={m.ref}
      anchorExcerpt={m.name}
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
    // scope: clicks in the module pane that miss a member row resolve to the module.
    <div className="h-full overflow-y-auto" {...anchorData(`module.${path}`, info.label)}>
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
