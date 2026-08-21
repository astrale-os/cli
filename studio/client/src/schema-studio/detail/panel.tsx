import type { IrClass, IrInterface, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { isIrInterfaceRef } from '@shared/types'
import { ArrowLeft, Box, FolderClosed, MousePointerClick, Plus, Shapes, Spline } from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { Chip, EmptyState, Group, IconTile, Row, Surface } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useCatalog, useViewsModel } from '@/lib/hooks'
import { handlerLinkFor, unguardedCount } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { anchorData, schemaMemberRef } from '@/lib/targets'
import { cn } from '@/lib/utils'
import { viewsForClass } from '@/lib/views'

import {
  inheritedGroupsOfClass,
  inheritedGroupsOfInterface,
  resolveInterface,
} from '../inheritance'
import {
  type MemberRef,
  implementedInterfaceRefsOf,
  interfaceSelectionId,
  moduleMembers,
} from '../modules'
import { SchemaIcon } from '../schema-icon'
import { ViewRow } from '../views-panel'
import { InheritedSection, MethodCard, PropertyRow } from './members'
import { interfaceRelations, originLabel, selectedInterfaceRef, splitId } from './model'
import { EdgeRelationship } from './relationships'

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
    importedIface?.ref && isIrInterfaceRef(importedIface.ref)
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
              {(span?.doc ?? member.description) && (
                <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                  {span?.doc ?? member.description}
                </p>
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
