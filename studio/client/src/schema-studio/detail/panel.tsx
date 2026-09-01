import type { IrClassRef, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { classRefKey, parseClassRefKey } from '@shared/types'
import { Box, MousePointerClick, Spline } from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { Chip, EmptyState, Group, IconTile, Surface } from '@/components/studio-kit'
import { useCatalog, useViewsModel } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorData, schemaMemberRef } from '@/lib/targets'
import { viewsForClass } from '@/lib/views'

import { inheritedGroupsOfClass, resolveClass } from '../inheritance'
import { SchemaIcon } from '../schema-icon'
import { ViewRow } from '../views-panel'
import { InheritedSection, MethodCard, PropertyRow } from './members'
import { originLabel } from './model'
import { EdgeRelationship } from './relationships'

export function SchemaDetail({
  bundle,
  selected,
}: {
  bundle: StudioSchemaBundle
  selected?: string
}) {
  const ir = bundle.ir
  const selectClass = useUI((state) => state.selectClass)
  const { data: catalog } = useCatalog()
  const viewsModel = useViewsModel(bundle.domainId)
  const originIcon = (origin?: string): string | undefined =>
    origin ? catalog?.find((entry) => entry.origin === origin)?.icon : undefined

  if (!ir || !selected) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <EmptyState
          icon={<MousePointerClick />}
          title="Nothing selected"
          hint="Pick a Class or relationship to inspect its properties, methods, handlers, and Views."
        />
      </div>
    )
  }
  const token = selected.startsWith('class.') ? selected.slice('class.'.length) : selected
  const importedRef = parseClassRefKey(token)
  const local = importedRef === undefined || importedRef.origin === ir.domain
  const name = importedRef?.name ?? token
  const member = local ? ir.classes[name] : resolveClass(bundle, importedRef)
  if (!member) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <EmptyState title="Not found" hint={selected} />
      </div>
    )
  }

  const ref: IrClassRef = importedRef ?? { origin: ir.domain, kind: 'class', name }
  const isEdge = member.type === 'edge'
  const memberKind = isEdge ? 'edge' : 'class'
  const refBase = local ? schemaMemberRef(memberKind, name) : `class.${classRefKey(ref)}`
  const span = local ? bundle.overlay.sourceSpans[refBase] : undefined
  const properties = Object.entries(member.properties)
  const methods = Object.entries(member.methods)
  const inherited = local && !isEdge ? inheritedGroupsOfClass(bundle, name) : []
  const classViews = local && !isEdge ? viewsForClass(viewsModel, name) : []

  return (
    <div className="h-full overflow-y-auto" {...anchorData(refBase, name)}>
      <div className="space-y-6 px-5 py-5">
        <header className="space-y-3">
          <div className="flex items-start gap-3 pr-8">
            <IconTile tone={isEdge ? 'edge' : 'node'} size="lg">
              {member.icon ? (
                <SchemaIcon svg={member.icon} className="h-5 w-5" />
              ) : isEdge ? (
                <Spline />
              ) : (
                <Box />
              )}
            </IconTile>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold tracking-tight">{name}</h2>
                {isEdge && <Chip tone="outline">edge</Chip>}
                {!local && <Chip tone="outline">{originLabel(ref.origin)}</Chip>}
                <AnchorButton
                  domainId={bundle.domainId}
                  anchorRef={{ ref: refBase, kind: 'schema', file: span?.file }}
                  excerpt={name}
                  className="ml-auto"
                />
              </div>
              {(span?.doc ?? member.description) && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {span?.doc ?? member.description}
                </p>
              )}
            </div>
          </div>

          {(member.extendsRefs ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pl-11">
              {(member.extendsRefs ?? []).map((parent) => {
                const navigable = resolveClass(bundle, parent) !== undefined
                const target =
                  parent.origin === ir.domain
                    ? `class.${parent.name}`
                    : `class.${classRefKey(parent)}`
                return (
                  <button
                    key={classRefKey(parent)}
                    type="button"
                    disabled={!navigable}
                    onClick={() => navigable && selectClass(target, bundle.domainId)}
                  >
                    <Chip tone="outline">
                      extends {parent.name}
                      {parent.origin === ir.domain ? '' : ` · ${originLabel(parent.origin)}`}
                    </Chip>
                  </button>
                )
              })}
            </div>
          )}
        </header>

        {/* No "Relationship" label: the header already reads `<Name> · edge`, and the card
            below is unmistakably the relationship. The heading only cost a row. */}
        {isEdge && (member.endpoints?.length ?? 0) >= 2 && (
          <EdgeRelationship bundle={bundle} endpoints={member.endpoints!} edgeName={name} />
        )}

        {properties.length > 0 && (
          <Group label="Properties">
            <Surface className="divide-y overflow-hidden">
              {properties.map(([propertyName, value]) => (
                <PropertyRow
                  key={propertyName}
                  bundle={bundle}
                  refBase={refBase}
                  pname={propertyName}
                  schema={value as JsonSchema}
                  optional={!(member.required ?? []).includes(propertyName)}
                />
              ))}
            </Surface>
          </Group>
        )}

        {methods.length > 0 && (
          <Group label="Methods">
            <div className="space-y-2.5">
              {methods.map(([methodName, method]) => (
                <MethodCard
                  key={methodName}
                  bundle={bundle}
                  owner={name}
                  ownerKind="class"
                  handlerOwnerLocal={local}
                  refBase={refBase}
                  mname={methodName}
                  method={method}
                />
              ))}
            </div>
          </Group>
        )}

        {classViews.length > 0 && (
          <Group label="Views">
            <div className="flex flex-col gap-0.5">
              {classViews.map((view) => (
                <ViewRow
                  key={view.slug}
                  domainId={bundle.domainId}
                  view={view}
                  icon={member.icon}
                />
              ))}
            </div>
          </Group>
        )}

        {inherited.length > 0 && (
          <InheritedSection bundle={bundle} groups={inherited} originIcon={originIcon} />
        )}

        {properties.length === 0 && methods.length === 0 && inherited.length === 0 && !isEdge && (
          <EmptyState title="No properties or methods" hint="This Class declares no own members." />
        )}
      </div>
    </div>
  )
}
