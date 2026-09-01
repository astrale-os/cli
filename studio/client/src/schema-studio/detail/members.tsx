import type { HandlerLink, IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { classRefKey } from '@shared/types'
import { ArrowUpRight, Box, Globe, Hexagon, Info, Layers } from 'lucide-react'

import { AnchorButton, RevealedAnchor } from '@/components/anchor'
import { MethodAuthBadge } from '@/components/method-auth'
import {
  Chip,
  DetailsDisclosure,
  Group,
  IconTile,
  MetaGrid,
  Row,
  Surface,
} from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { describe, TypeChip, typeLabel } from '@/lib/format'
import { friendlyType, methodGlyph } from '@/lib/friendly'
import { handlerLinkFor } from '@/lib/method-auth'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { type ClassTier, type InheritedGroup } from '../inheritance'
import { SchemaIcon } from '../schema-icon'
import { originLabel } from './model'

// ── Property row ──
// A property/method's parsed description (JSDoc/comment), tucked behind a small
// glyph so it's there on hover without spelling every doc out inline. An "i", not
// a "?", because the optional marker next to it already IS a question mark.
function DocHint({ doc }: { doc: string }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Description"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {doc}
      </HoverCardContent>
    </HoverCard>
  )
}

export function PropertyRow({
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
  /** Canonical required membership; omitted only when the caller has no membership context. */
  optional?: boolean
}) {
  const pref = `${refBase}.property.${pname}`
  const pdoc = bundle.overlay.sourceSpans[pref]?.doc
  const ft = friendlyType(schema, optional)
  const Icon = ft.icon
  const d = describe(schema)

  return (
    <RevealedAnchor anchorRef={pref}>
      <Row
        dense
        anchorRef={pref}
        anchorExcerpt={pname}
        // name and type sit at opposite edges now, so the row tints under the cursor
        // to keep the eye on one line while it crosses the gap between them
        className="rounded-none hover:bg-accent/50"
        // A bare glyph, not an IconTile: at one line a tinted 24px square is taller
        // than the text it labels and turns the list into a column of buttons.
        leading={<Icon className="h-3.5 w-3.5 shrink-0 text-schema-node" />}
        title={
          <span className="flex items-center gap-1.5">
            <span className="truncate">
              {pname}
              {/* `?` rather than an "optional" pill — the same mark the method params
                  use, and it rides along with the name instead of costing a chip's width */}
              {ft.optional && (
                <span className="font-normal text-muted-foreground" title="optional">
                  ?
                </span>
              )}
            </span>
            {pdoc && <DocHint doc={pdoc} />}
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
            domainId={bundle.domainId}
            anchorRef={{ ref: pref, kind: 'schema', file: bundle.overlay.sourceSpans[pref]?.file }}
            excerpt={pname}
          />
        }
      />
    </RevealedAnchor>
  )
}

// ── Method card ──
export function MethodCard({
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
    <RevealedAnchor anchorRef={mref}>
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
              <span className={cn(overridden && 'text-muted-foreground line-through')}>
                {mname}
              </span>
              <MethodAuthBadge method={method} />
              {doc && <DocHint doc={doc} />}
              {method.inheritance === 'sealed' && <Chip tone="warning">sealed</Chip>}
              {method.inheritance === 'abstract' && <Chip tone="fn">contract</Chip>}
              {overridden && <Chip tone="default">overridden</Chip>}
              {contractOnly && <Chip tone="warning">needs handler</Chip>}
              {unlinked && <Chip tone="default">unlinked</Chip>}
            </span>
          }
          trailing={
            <AnchorButton
              domainId={bundle.domainId}
              anchorRef={{
                ref: mref,
                kind: 'schema',
                file: bundle.overlay.sourceSpans[mref]?.file,
              }}
              excerpt={`${owner}.${mname}`}
            />
          }
        />

        <div className="pl-10 pt-1.5">
          <DetailsDisclosure label="Details">
            <MethodDetails method={method} link={link} owner={owner} />
          </DetailsDisclosure>
        </div>
      </Surface>
    </RevealedAnchor>
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
  const params = Object.entries(method.input.properties ?? {})
  const required = new Set(method.input.required ?? [])
  return (
    <div className="space-y-3 pb-1">
      {/* params: name + type */}
      {params.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Input
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {params.map(([pn, ps]) => {
              const optional = !required.has(pn)
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
        <span className="text-[11px] text-muted-foreground">returns </span>
        {method.output.mode === 'binary' ? (
          <Chip tone="outline">Binary</Chip>
        ) : method.output.mode === 'stream' ? (
          <span className="inline-flex items-center gap-1.5">
            <Chip tone="outline">Stream</Chip>
            <TypeChip schema={method.output.item} />
          </span>
        ) : (
          <TypeChip schema={method.output.schema} />
        )}
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
              Acts on the <span className="font-medium text-foreground/80">{owner} type</span>.{' '}
              <span className="text-muted-foreground">(static)</span>
            </>
          ) : (
            <>
              Acts on a single <span className="font-medium text-foreground/80">{owner}</span>.{' '}
              <span className="text-muted-foreground">(instance)</span>
            </>
          )}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}

// ── Inherited section: members a Class gets from base Classes. Rendered at the same weight —
// real PropertyRow / MethodCard (icons, friendly types, the method details
// disclosure) — grouped under each source Class and marked inherited by a
// tier-coloured left rail + a clickable Class header. They're load-bearing,
// so they read that way; the rail just says where they come from.
export function InheritedSection({
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
    <Group label="Inherited">
      <div className="space-y-5">
        {groups.map((g) => {
          const tileTone = g.tier === 'local' ? 'fn' : g.tier === 'external' ? 'node' : 'muted'
          const refBase =
            g.ref.origin === bundle.ir?.domain ? `class.${g.owner}` : `class.${classRefKey(g.ref)}`
          return (
            <div key={refBase} className="border-l pl-3.5">
              {/* Base Class header — substantial and navigable. */}
              <button
                type="button"
                onClick={() => selectClass(refBase, bundle.domainId)}
                title={g.origin ?? 'this domain'}
                className="group/ih mb-2.5 flex w-full items-center gap-2.5 text-left"
              >
                <IconTile tone={tileTone} size="sm">
                  <ClassGlyph tier={g.tier} iconSvg={originIcon(g.origin)} />
                </IconTile>
                <span className="text-[13px] font-semibold tracking-tight">{g.owner}</span>
                <Chip tone={g.tier === 'local' ? 'fn' : 'outline'}>
                  {g.tier === 'local' ? 'base class' : originLabel(g.origin)}
                </Chip>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {/* full-weight members — identical treatment to the member's own */}
              <div className="space-y-2.5">
                {g.props.length > 0 && (
                  <Surface className="divide-y overflow-hidden">
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
                    owner={g.owner}
                    ownerKind="class"
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

function ClassGlyph({ tier, iconSvg }: { tier: ClassTier; iconSvg?: string }) {
  if (tier === 'local') return <Box />
  if (iconSvg) return <SchemaIcon svg={iconSvg} className="h-4 w-4" />
  return tier === 'kernel' ? <Hexagon /> : <Globe />
}
