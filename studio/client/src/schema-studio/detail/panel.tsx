import type { IrClassRef, StudioSchemaBundle } from '@shared/types'

import { classRefKey, parseClassRefKey } from '@shared/types'
import { Box, MousePointerClick, Spline } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { FunctionModel } from '@/lib/functions'

import { AnchorButton } from '@/components/anchor'
import { PolicyLink } from '@/components/policy-link'
import { Chip, DescriptionText, EmptyState, Group, IconTile } from '@/components/studio-kit'
import { buildFunctionsModel, functionGlyph, functionsForClass } from '@/lib/functions'
import { useViewsModel } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorData, schemaMemberRef } from '@/lib/targets'
import { cn } from '@/lib/utils'
import { viewsForClass } from '@/lib/views'

import { FunctionRow } from '../functions-panel'
import { ancestryOfClass, isKernelClass, resolveClass } from '../inheritance'
import { SchemaIcon } from '../schema-icon'
import { ViewRow } from '../views-panel'
import { CallableDetail, MemberList, MethodRow, PropertyRow } from './members'
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
  const functionsModel = useMemo(() => buildFunctionsModel(bundle), [bundle])

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
  if (selected.startsWith('function.')) {
    const name = selected.slice('function.'.length)
    const model = functionsModel.all.find((entry) => entry.name === name)
    return model ? (
      <FunctionDetail bundle={bundle} model={model} selected={selected} />
    ) : (
      <EmptyState title="Not found" hint={selected} />
    )
  }
  if (selected.startsWith('view.')) {
    const name = selected.slice('view.'.length)
    const view = viewsModel.all.find((entry) => entry.slug === name)
    return (
      <div className="h-full overflow-y-auto p-5">
        <h2 className="mb-4 pr-8 text-[15px] font-semibold">{name}</h2>
        {ir.views[name]?.description && (
          <DescriptionText>{ir.views[name].description}</DescriptionText>
        )}
        {view ? (
          <ViewRow domainId={bundle.domainId} view={view} />
        ) : (
          <EmptyState title="No view implementation" />
        )}
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
  const description = span?.doc ?? member.description
  // Own members first, inherited after them under the Class that declares each — one
  // list per kind, so the panel answers "what does it have" before "where from".
  const lists = memberLists(bundle, name, member, local && !isEdge)
  const ancestry = ancestryOfClass(bundle, member.extendsRefs ?? [])
  const classViews = local && !isEdge ? viewsForClass(viewsModel, name) : []
  // Standalone Functions that name this Class. A Method is declared ON the Class and reads
  // as one of its members; a Function merely works on it, so it sits with the Views —
  // the other things that point AT a Class without belonging to it.
  const classFunctions = local && !isEdge ? functionsForClass(functionsModel, name) : []

  return (
    <div
      data-comment-outline-inset=""
      className="h-full overflow-y-auto"
      {...anchorData(refBase, name)}
    >
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
              {description && (
                <ClassDescription key={`${refBase}:${description}`} description={description} />
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

        {Object.keys(member.policies ?? {}).length > 0 && (
          <Group label="Policies">
            <div className="space-y-1.5 text-[13px]">
              {Object.entries(member.policies ?? {}).map(([operation, policy]) => (
                <div key={operation} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">{operation}</span>
                  <PolicyLink policy={policy} domainId={bundle.domainId} />
                </div>
              ))}
            </div>
          </Group>
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

        {classFunctions.length > 0 && (
          <Group label="Functions" hint="declared outside this class">
            <div className="flex flex-col gap-0.5">
              {classFunctions.map((fn) => (
                <FunctionRow key={fn.name} domainId={bundle.domainId} fn={fn} />
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

/**
 * A standalone Function, read on its own page.
 *
 * It answers the three questions a Class card answers for a Method, in the same order:
 * what it IS (the header, with how it is implemented), what it WORKS ON (the Classes its
 * Node-path fields accept, each one a click away) and its CONTRACT (the shared callable
 * sheet — Policy, Input, Returns).
 */
function FunctionDetail({
  bundle,
  model,
  selected,
}: {
  bundle: StudioSchemaBundle
  model: FunctionModel
  selected: string
}) {
  const selectClass = useUI((state) => state.selectClass)
  const Glyph = functionGlyph(model)
  const calls = model.link?.kernelCalls ?? []
  return (
    <div
      data-comment-outline-inset=""
      className="h-full overflow-y-auto"
      {...anchorData(selected, model.name)}
    >
      <div className="space-y-6 px-5 py-5">
        <header className="space-y-3">
          <div className="flex items-start gap-3 pr-8">
            <IconTile tone="fn" size="lg">
              <Glyph />
            </IconTile>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold tracking-tight">{model.name}</h2>
                <Chip tone="outline">function</Chip>
                <AnchorButton
                  domainId={bundle.domainId}
                  anchorRef={{
                    ref: selected,
                    kind: 'schema',
                    ...(model.file ? { file: model.file } : {}),
                  }}
                  excerpt={model.name}
                  className="ml-auto"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {model.link ? (
                  <Chip tone="primary">{model.link.kind}</Chip>
                ) : (
                  <Chip tone="fn">contract only</Chip>
                )}
                {model.contractOnly && <Chip tone="warning">needs handler</Chip>}
                {model.link?.unlinked && <Chip tone="default">unlinked</Chip>}
                {calls.map((call) => (
                  <Chip key={call} tone="outline" className="font-mono">
                    {call}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* What it works on, as the Classes themselves — the one thing a Function's own
            declaration does not say out loud, and the reason it has a place on the canvas. */}
        {model.refs.length > 0 && (
          <Group label="Works on">
            <div className="flex flex-wrap items-center gap-1.5">
              {model.refs.map((ref) => {
                const isLocal = ref.origin === bundle.ir?.domain
                return (
                  <button
                    key={classRefKey(ref)}
                    type="button"
                    title={isLocal ? `Open ${ref.name}` : `${ref.name} (${ref.origin})`}
                    onClick={() =>
                      selectClass(
                        isLocal ? `class.${ref.name}` : `class.${classRefKey(ref)}`,
                        bundle.domainId,
                      )
                    }
                    className="rounded-full"
                  >
                    <Chip
                      tone="outline"
                      className="transition-colors hover:border-foreground/40 hover:text-foreground"
                    >
                      {ref.name}
                    </Chip>
                  </button>
                )
              })}
            </div>
          </Group>
        )}

        <Group label="Contract">
          <CallableDetail
            bundle={bundle}
            owner={bundle.ir?.domain ?? ''}
            method={model.fn}
            doc={model.doc}
          />
        </Group>
      </div>
    </div>
  )
}

function ClassDescription({ description }: { description: string }) {
  const descriptionId = useId()
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    if (expanded) return

    const element = descriptionRef.current
    if (!element) return

    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()

    return () => observer.disconnect()
  }, [description, expanded])

  return (
    <div className="mt-1">
      <DescriptionText
        ref={descriptionRef}
        id={descriptionId}
        className={cn(
          'text-[13px] leading-relaxed text-muted-foreground',
          !expanded && 'line-clamp-3',
        )}
      >
        {description}
      </DescriptionText>
      {overflowing && (
        <button
          type="button"
          aria-controls={descriptionId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
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
