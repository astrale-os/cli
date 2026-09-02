import type { IrClassRef, StudioSchemaBundle } from '@shared/types'

import { classRefKey, parseClassRefKey } from '@shared/types'
import { Box, MousePointerClick, Spline } from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { Chip, DescriptionText, EmptyState, Group, IconTile } from '@/components/studio-kit'
import { useViewsModel } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorData, schemaMemberRef } from '@/lib/targets'
import { cn } from '@/lib/utils'
import { viewsForClass } from '@/lib/views'

import { ancestryOfClass, isKernelClass, resolveClass } from '../inheritance'
import { SchemaIcon } from '../schema-icon'
import { ViewRow } from '../views-panel'
import { MemberList, MethodRow, PropertyRow } from './members'
import { memberLists, originLabel } from './model'
import { EdgeRelationship } from './relationships'

export function SchemaDetail({
  bundle,
  selected,
}: {
  bundle: StudioSchemaBundle
  selected?: string
}) {
  const ir = bundle.ir
  const viewsModel = useViewsModel(bundle.domainId)

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
  // Own members first, inherited after them under the Class that declares each — one
  // list per kind, so the panel answers "what does it have" before "where from".
  const lists = memberLists(bundle, name, member, local && !isEdge)
  const ancestry = ancestryOfClass(bundle, member.extendsRefs ?? [])
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
                <DescriptionText className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {span?.doc ?? member.description}
                </DescriptionText>
              )}
            </div>
          </div>

          {/* The whole chain, with no word in front of it and no separator inside it: a
              row of Class chips under a Class reads as its bases on its own. The parents
              come first, then THEIR parents, and so on up; the hover says which is which.
              Each Class is a chip that opens it. */}
          {ancestry.length > 0 && (
            <div
              data-class-ancestry=""
              aria-label={`${name} extends`}
              className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-11"
            >
              {ancestry.flatMap((level, depth) =>
                level.map((parent) => (
                  <AncestorChip
                    key={classRefKey(parent)}
                    bundle={bundle}
                    owner={name}
                    parent={parent}
                    depth={depth}
                  />
                )),
              )}
            </div>
          )}
        </header>

        {/* No "Relationship" label: the header already reads `<Name> · edge`, and the card
            below is unmistakably the relationship. The heading only cost a row. */}
        {isEdge && (member.endpoints?.length ?? 0) >= 2 && (
          <EdgeRelationship bundle={bundle} endpoints={member.endpoints!} edgeName={name} />
        )}

        {lists.properties.length > 0 && (
          <Group label="Properties">
            <MemberList>
              {lists.properties.map((entry) => (
                <PropertyRow
                  key={`${entry.owner?.refBase ?? ''}.${entry.name}`}
                  bundle={bundle}
                  refBase={refBase}
                  entry={entry}
                />
              ))}
            </MemberList>
          </Group>
        )}

        {lists.methods.length > 0 && (
          <Group label="Methods">
            <MemberList>
              {lists.methods.map((entry) => (
                <MethodRow
                  key={`${entry.owner?.refBase ?? ''}.${entry.name}`}
                  bundle={bundle}
                  owner={name}
                  refBase={refBase}
                  entry={entry}
                  handlerOwnerLocal={local}
                />
              ))}
            </MemberList>
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

        {lists.properties.length === 0 && lists.methods.length === 0 && !isEdge && (
          <EmptyState title="No properties or methods" hint="This Class declares no own members." />
        )}
      </div>
    </div>
  )
}

// One ancestor: its name, its domain when that is not this one, and a click that opens
// it. The hover spells the relation out — the row carries no word for it — and says
// whether the base is a declared parent or reached further up. A base the bundle cannot
// resolve still names itself, but leads nowhere.
function AncestorChip({
  bundle,
  owner,
  parent,
  depth,
}: {
  bundle: StudioSchemaBundle
  owner: string
  parent: IrClassRef
  depth: number
}) {
  const selectClass = useUI((state) => state.selectClass)
  const local = parent.origin === bundle.ir?.domain
  const kernel = isKernelClass(parent)
  const navigable = resolveClass(bundle, parent) !== undefined
  const target = local ? `class.${parent.name}` : `class.${classRefKey(parent)}`
  const where = local ? '' : ` (${parent.origin})`
  const relation =
    depth === 0
      ? `${owner} extends ${parent.name}${where}`
      : `${owner} inherits ${parent.name}${where} through its bases`
  return (
    <button
      type="button"
      disabled={!navigable}
      title={relation}
      onClick={() => selectClass(target, bundle.domainId)}
      className={cn(
        'rounded-full disabled:cursor-default',
        kernel && 'opacity-70 transition-opacity hover:opacity-100',
      )}
    >
      <Chip
        tone="outline"
        className={cn(
          navigable && 'transition-colors hover:border-foreground/40 hover:text-foreground',
        )}
      >
        {/* the name alone — where it comes from is on the hover, not on the chip */}
        {parent.name}
      </Chip>
    </button>
  )
}
