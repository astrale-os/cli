import type { IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { Binary, ChevronRight, Info, type LucideIcon, Waves } from 'lucide-react'
import { type HTMLAttributes, type ReactNode, type Ref, useEffect, useState } from 'react'

import { AnchorButton, useRevealedAnchor } from '@/components/anchor'
import { TRIGGER_TONE } from '@/components/method-auth'
import { Chip, DescriptionText, MetaGrid, Row, Surface } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { describe, typeLabel } from '@/lib/format'
import { fieldChildren, friendlyFieldType, methodGlyph } from '@/lib/friendly'
import { handlerLinkFor, methodAuth } from '@/lib/method-auth'
import {
  type ParsedPolicyCheck,
  parsePolicyCheck,
  policyDescription,
  policyObjectLabel,
} from '@/lib/policy'
import { useUI } from '@/lib/store'
import { anchorData } from '@/lib/targets'
import { cn } from '@/lib/utils'

import type { MemberOwner, MethodEntry, PropertyEntry } from './model'

import { originLabel } from './model'

// ── The list card every member kind sits in ──
// `data-member-list` is what lets a row's targeting outline draw INSIDE the row
// (see styles.css): the card clips, and a ring drawn outside the first row lost its top.
export function MemberList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Surface data-member-list="" className={cn('divide-y overflow-hidden', className)}>
      {children}
    </Surface>
  )
}

// A member's parsed description (JSDoc/comment), tucked behind a small glyph so it's
// there on hover without spelling every doc out inline. An "i", not a "?", because the
// optional marker next to it already IS a question mark. Non-interactive inside a row
// that is itself a button — a button may not hold another.
function DocHint({ doc, interactive = true }: { doc: string; interactive?: boolean }) {
  const className = 'text-muted-foreground transition-colors hover:text-foreground'
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        {interactive ? (
          <button type="button" aria-label="Description" className={className}>
            <Info className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span role="img" aria-label="Description" className={className}>
            <Info className="h-3.5 w-3.5" />
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs">
        <DescriptionText className="text-[13px] leading-relaxed text-muted-foreground">
          {doc}
        </DescriptionText>
      </HoverCardContent>
    </HoverCard>
  )
}

// `Document.reference`: an inherited member is named by the Class that declares it, in
// the muted weight, so the list reads own-then-inherited without a section break.
function OwnerPrefix({ owner }: { owner?: MemberOwner }) {
  if (!owner) return null
  return (
    <span
      className="font-normal text-muted-foreground"
      title={`inherited from ${owner.name} · ${originLabel(owner.origin)}`}
    >
      {owner.name}.
    </span>
  )
}

// The friendly type on the row; the technical one — and the anchor key — on hover.
function TypeHover({
  label,
  schema,
  optional,
  anchorKey,
}: {
  label: string
  schema?: JsonSchema
  optional?: boolean
  anchorKey?: string
}) {
  const d = describe(schema)
  return (
    <HoverCard openDelay={140}>
      <HoverCardTrigger asChild>
        <span className="cursor-default">{label}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-sm">
        <MetaGrid
          items={[
            { label: 'type', value: typeLabel(d) + (optional ? ' (optional)' : '') },
            ...(anchorKey ? [{ label: 'key', value: anchorKey }] : []),
          ]}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

// ── Field row: one named value — a property, a method's input, a return's field ──
// Name at the left edge, friendly type at the right, as two columns. A structured
// value opens beneath it: its fields are rows of their own, one step in, so an input
// that takes `{ amount, note? }` reads exactly like the properties above it do.
function FieldRow({
  name,
  qualifier,
  schema,
  optional,
  doc,
  depth = 0,
  anchorKey,
  trailing,
  ...wrapper
}: {
  name: string
  qualifier?: ReactNode
  schema: JsonSchema
  optional: boolean
  doc?: string
  depth?: number
  anchorKey?: string
  trailing?: ReactNode
  ref?: Ref<HTMLDivElement>
} & HTMLAttributes<HTMLDivElement>) {
  const ft = friendlyFieldType(schema, optional)
  const Icon = ft.icon
  // three levels is where a schema stops being read and starts being decoded
  const children = depth < 2 ? fieldChildren(schema) : []
  return (
    <div {...wrapper}>
      <Row
        dense
        // name and type sit at opposite edges, so the row tints under the cursor
        // to keep the eye on one line while it crosses the gap between them
        className="rounded-none hover:bg-accent/50"
        // A bare glyph, not an IconTile: at one line a tinted 24px square is taller
        // than the text it labels and turns the list into a column of buttons.
        leading={
          <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 16 }}>
            <Icon className="h-3.5 w-3.5 text-schema-node" />
          </span>
        }
        title={
          <span className="flex items-center gap-1.5">
            <span className="truncate">
              {qualifier}
              {name}
              {/* `?` rather than an "optional" pill — it rides along with the name
                  instead of costing a chip's width */}
              {ft.optional && (
                <span className="font-normal text-muted-foreground" title="optional">
                  ?
                </span>
              )}
            </span>
            {doc && <DocHint doc={doc} />}
          </span>
        }
        subtitle={
          <TypeHover
            label={ft.label}
            schema={schema}
            optional={ft.optional}
            anchorKey={anchorKey}
          />
        }
        trailing={trailing}
      />
      {children.map((child) => (
        <FieldRow
          key={child.name}
          name={child.name}
          schema={child.schema}
          optional={child.optional}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

// ── Property row: a field row that is a comment target of its own ──
export function PropertyRow({
  bundle,
  refBase,
  entry,
}: {
  bundle: StudioSchemaBundle
  refBase: string
  entry: PropertyEntry
}) {
  // an inherited property is commented under the Class that declares it
  const pref = `${entry.owner?.refBase ?? refBase}.property.${entry.name}`
  const span = bundle.overlay.sourceSpans[pref]
  const revealed = useRevealedAnchor(pref)
  return (
    <FieldRow
      {...revealed}
      {...anchorData(pref, entry.name)}
      name={entry.name}
      qualifier={<OwnerPrefix owner={entry.owner} />}
      schema={entry.schema}
      optional={entry.optional}
      doc={span?.doc}
      anchorKey={pref}
      trailing={
        <AnchorButton
          domainId={bundle.domainId}
          anchorRef={{ ref: pref, kind: 'schema', file: span?.file }}
          excerpt={entry.name}
        />
      }
    />
  )
}

// ── Method row: one line closed, the whole contract open ──
// Closed it is the name and nothing else — glyph, name, a status chip when there is
// one — at the weight of a property row, so twenty methods fit where four cards did.
// Open, the row grows into the contract: what it does, the Policy that guards it, the
// input and the return as field rows, and what it runs on.
const GLYPH_TEXT: Record<string, string> = {
  warning: 'text-warning',
  fn: 'text-schema-function',
  primary: 'text-primary',
}

export function MethodRow({
  bundle,
  owner,
  refBase,
  entry,
  handlerOwnerLocal = true,
}: {
  bundle: StudioSchemaBundle
  /** the Class on screen */
  owner: string
  refBase: string
  entry: MethodEntry
  /** whether the Class on screen has handler links to read (an imported one has none) */
  handlerOwnerLocal?: boolean
}) {
  const declaring = entry.owner?.name ?? owner
  const ownerLocal = entry.owner ? entry.owner.local : handlerOwnerLocal
  const mref = `${entry.owner?.refBase ?? refBase}.method.${entry.name}`
  const link = ownerLocal
    ? handlerLinkFor(bundle.overlay.handlerLinks, declaring, entry.name, 'class')
    : undefined
  const span = bundle.overlay.sourceSpans[mref]
  const glyph = methodGlyph(entry.method)
  const Glyph = glyph.icon

  const [open, setOpen] = useState(false)
  // a thread revealed on this method opens it: the row alone would not show what
  // the comment is about
  const revealedNow = useUI((s) => s.revealedRef === mref)
  useEffect(() => {
    if (revealedNow) setOpen(true)
  }, [revealedNow])
  const revealed = useRevealedAnchor(mref)

  const contractOnly = link && !link.implemented
  const unlinked = link?.unlinked

  return (
    <div {...revealed} {...anchorData(mref, `${declaring}.${entry.name}`)} data-method-row="">
      <div className="flex items-center gap-2 px-2.5 py-1 transition-colors hover:bg-accent/50">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <Glyph className={cn('h-3.5 w-3.5 shrink-0', GLYPH_TEXT[glyph.tone])} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px] font-medium leading-5',
              entry.declaredLocally && 'text-muted-foreground line-through',
            )}
          >
            <OwnerPrefix owner={entry.owner} />
            {entry.name}
          </span>
          {/* compact method facts only — the contract itself waits for the click */}
          {entry.method.static && <Chip tone="outline">static</Chip>}
          {entry.method.abstract && <Chip tone="fn">contract</Chip>}
          {entry.declaredLocally && <Chip tone="default">declared locally</Chip>}
          {contractOnly && <Chip tone="warning">needs handler</Chip>}
          {unlinked && <Chip tone="default">unlinked</Chip>}
        </button>
        <AnchorButton
          domainId={bundle.domainId}
          anchorRef={{ ref: mref, kind: 'schema', file: span?.file }}
          excerpt={`${declaring}.${entry.name}`}
        />
      </div>
      {open && (
        <MethodDetail
          bundle={bundle}
          owner={declaring}
          method={entry.method}
          doc={span?.doc ?? entry.method.description}
        />
      )}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

// ── The contract, as one sheet ──
// Three labelled rows — Policy, Input, Returns — and no card, no heading and no rail
// inside them: the label column carries the structure, so the eye reads the facts down
// one edge instead of through a stack of boxes. Technical types, Policy descriptions
// and auth wording wait on hover.
function MethodDetail({
  bundle,
  owner,
  method,
  doc,
}: {
  bundle: StudioSchemaBundle
  owner: string
  method: IrMethod
  /** the source comment when there is one, else the declared description */
  doc?: string
}) {
  const params = fieldChildren(method.input)
  const check = parsePolicyCheck(method.policy)
  return (
    // Keep only the row's small outer gutter. Aligning the detail with the method
    // glyph cost too much width in this narrow panel.
    <div data-method-detail="" className="border-t border-dashed px-2.5 py-2.5 text-[12px]">
      {doc && (
        <DescriptionText
          data-method-doc=""
          className="mb-2.5 text-[13px] leading-relaxed text-muted-foreground"
        >
          {doc}
        </DescriptionText>
      )}
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <Term>Policy</Term>
        <dd className="min-w-0">
          <PolicyLine bundle={bundle} owner={owner} method={method} check={check} />
        </dd>

        <Term>Input</Term>
        <dd className="min-w-0" data-method-input="">
          {params.length === 0 ? (
            <Note>none</Note>
          ) : (
            params.map((param) => (
              <FieldLine
                key={param.name}
                name={param.name}
                schema={param.schema}
                optional={param.optional}
              />
            ))
          )}
        </dd>

        <Term>Returns</Term>
        <dd className="min-w-0" data-method-returns="">
          <ReturnLines output={method.output} />
        </dd>
      </dl>
    </div>
  )
}

function Term({ children }: { children: ReactNode }) {
  return (
    <dt className="pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </dt>
  )
}

// Who may call, on one line; what the Kernel evaluates, on the lines beneath it. The
// check never shares the verdict's line: the column is narrow enough that it wrapped
// more often than not, leaving a separator stranded at the end of the first line.
function PolicyLine({
  bundle,
  owner,
  method,
  check,
}: {
  bundle: StudioSchemaBundle
  owner: string
  method: IrMethod
  check?: ParsedPolicyCheck
}) {
  const verdict = methodAuth(method)
  if (!verdict) return <Note>no authentication contract declared</Note>
  const Icon = verdict.icon
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-x-1.5" title={verdict.blurb}>
        <Icon className={cn('h-3.5 w-3.5 shrink-0', TRIGGER_TONE[verdict.tone])} />
        <span className="font-medium">{verdict.label}</span>
      </div>
      {check ? (
        <PolicyTree bundle={bundle} owner={owner} check={check} />
      ) : method.auth === 'authorized' ? (
        <div>
          <Note>no Policy pinned</Note>
        </div>
      ) : null}
    </div>
  )
}

// `mayEditProfile on this Member` — the Policy at code weight, its description on hover.
function PolicyCheckText({
  bundle,
  owner,
  check,
}: {
  bundle: StudioSchemaBundle
  owner: string
  check: Extract<ParsedPolicyCheck, { kind: 'check' }>
}) {
  const foreign = check.policy.origin !== bundle.ir?.domain
  const description = bundle.ir ? policyDescription(bundle.ir, check.policy) : undefined
  const label = (
    <span
      data-policy-check=""
      className={cn(
        'inline-flex min-w-0 flex-wrap items-baseline gap-x-1',
        description && 'cursor-help',
      )}
    >
      <span className="font-mono text-foreground/90">{check.policy.name}</span>
      {foreign && (
        <span className="text-muted-foreground">· {originLabel(check.policy.origin)}</span>
      )}
      <span className="text-muted-foreground">on {policyObjectLabel(check.object, owner)}</span>
    </span>
  )
  if (!description) return label
  return (
    <HoverCard openDelay={140}>
      <HoverCardTrigger asChild>{label}</HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs">
        <DescriptionText className="text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </DescriptionText>
      </HoverCardContent>
    </HoverCard>
  )
}

// A composition, as declared: the word that joins its branches, then the branches one
// step in.
function PolicyTree({
  bundle,
  owner,
  check,
}: {
  bundle: StudioSchemaBundle
  owner: string
  check: ParsedPolicyCheck
}) {
  if (check.kind === 'check') {
    return (
      <div>
        <PolicyCheckText bundle={bundle} owner={owner} check={check} />
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground">{check.kind === 'allOf' ? 'all of' : 'any of'}</p>
      <div className="space-y-0.5 border-l pl-2.5">
        {check.items.map((item, index) => (
          <PolicyTree key={index} bundle={bundle} owner={owner} check={item} />
        ))}
      </div>
    </div>
  )
}

// One value on one line: glyph, name (or the kind, for a return), its type at the right.
// A structured value's fields follow, one step in — the same idiom as the properties.
function FieldLine({
  name,
  schema,
  optional = false,
  label,
  icon,
  depth = 0,
}: {
  name?: string
  schema?: JsonSchema
  optional?: boolean
  /** printed instead of a name: a return's kind */
  label?: string
  icon?: LucideIcon
  depth?: number
}) {
  const ft = friendlyFieldType(schema, optional)
  const Icon = icon ?? ft.icon
  // three levels is where a schema stops being read and starts being decoded
  const children = depth < 2 ? fieldChildren(schema) : []
  return (
    <div>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 16 }}>
        <Icon className="h-3.5 w-3.5 shrink-0 text-schema-node" />
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
          {label ?? name}
          {name && ft.optional && (
            <span className="font-normal text-muted-foreground" title="optional">
              ?
            </span>
          )}
        </span>
        {name && (
          <span className="ml-auto min-w-0 max-w-[50%] truncate text-right text-muted-foreground">
            <TypeHover label={ft.label} schema={schema} optional={ft.optional} />
          </span>
        )}
      </div>
      {children.map((child) => (
        <FieldLine
          key={child.name}
          name={child.name}
          schema={child.schema}
          optional={child.optional}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

// What comes back: its kind, then a structured value's fields beneath.
function ReturnLines({ output }: { output: IrMethod['output'] }) {
  if (output.mode === 'binary') return <FieldLine label="Binary" icon={Binary} />
  const schema = output.mode === 'stream' ? output.item : output.schema
  const kind = friendlyFieldType(schema).label
  return (
    <FieldLine
      label={output.mode === 'stream' ? `Stream of ${kind}` : kind}
      icon={output.mode === 'stream' ? Waves : undefined}
      schema={schema}
    />
  )
}
