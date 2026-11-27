/**
 * What exists, for the Inspector's Structure lens: a Class as it is declared — what it is, its
 * Properties and their marks, the relationships it stands in — and a relationship's two ends.
 * Pure over the bundle and the reader's words; methods, call rules and Policies are not
 * structure and never appear here.
 */
import type { IrClass, IrEndpoint, JsonSchema, StudioSchemaBundle } from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { nodePathAccepts } from '@shared/contracts/schema'
import { classRefKey } from '@shared/schema/identity'

import { describe, friendlyFieldType } from '@/lib/value-type'

import { cardLabel, classSelectionId, originLabel } from '../../schema-studio/detail/model'
import {
  ancestryOfClass,
  inheritedGroupsOfClass,
  isKernelImplementationClass,
  type KernelRole,
  kernelRolesOfClass,
  resolveClass,
} from '../../schema-studio/inheritance'
import { moduleHues, moduleLabel, moduleOfMember } from '../../schema-studio/modules'
import { endsHolding } from '../lenses/deletion'
import { type Lifetime, lifetimesOf } from '../lenses/lifetimes'
import { type DomainRules, ruleView, sitesOn } from '../rules/model'
import {
  articleOf,
  countsMany,
  countWords,
  NO_TERMS,
  pluralName,
  relationPhrase,
  type Terms,
} from './words'

/**
 * A Class named on the page, with the selection that opens it and what it wears wherever it is
 * named: its icon, in its module's hue, as the canvas draws its card.
 */
export interface ClassLink {
  /** the selection id that opens it */
  readonly target: string
  readonly name: string
  /** the short name of its Domain, when it is not the Domain on screen */
  readonly domain?: string
  /** whether the bundle carries its definition, so opening it shows something */
  readonly open: boolean
  /** its authored icon, as SVG markup */
  readonly icon?: string
  /** it is a relationship, which wears the relationship's glyph and hue */
  readonly relationship?: true
  /** its module's hue; none for a Class at the Schema's root or of another Domain */
  readonly hue?: number
}

/** A piece of a sentence: words, or a Class said by a name that opens it. */
export type Phrase = string | { readonly link: ClassLink; readonly text: string }

export type MarkKind = 'required' | 'immutable' | 'automatic' | 'searchable'

/** What kind of value a Property or a field holds: each wears its own mark. */
export type ValueKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'url'
  | 'email'
  | 'choice'
  | 'reference'
  | 'list'
  | 'object'
  | 'state'
  | 'binary'
  | 'value'

/** A value's type: in words, its kind, and the Classes it refers to when it is a reference. */
export interface ValueType {
  /** `Text`, `Date and time`, `Reference to Host` */
  readonly type: string
  readonly kind: ValueKind
  /** the Classes a reference accepts */
  readonly refs?: readonly ClassLink[]
}

/** A Property's mark: its kind, its label, and what it guarantees in a sentence. */
export interface PropertyMark {
  readonly kind: MarkKind
  readonly label: string
  readonly meaning: string
}

/** A state Property's declared machine. */
export interface StateMachine {
  readonly initial?: string
  /** the declared states, in the order the machine reaches them from its initial state */
  readonly states: readonly string[]
  readonly transitions: readonly {
    readonly from: string
    readonly event: string
    readonly to: string
  }[]
}

export interface PropertyLine extends ValueType {
  readonly name: string
  readonly description?: string
  readonly marks: readonly PropertyMark[]
  readonly state?: StateMachine
  /** the Class that declares it, when the Class on screen inherits it */
  readonly from?: ClassLink
  /** its comment anchor: `<declaring Class's selection id>.property.<name>` */
  readonly anchor: string
}

/** One relationship a Class stands in, said from the Class's end. */
export interface RelationshipLine {
  readonly relationship: ClassLink
  readonly end: 'source' | 'target'
  /** the role of the end the Class stands at */
  readonly role: string
  /** `A Fleet contains any number of FleetResources`; its Classes open */
  readonly sentence: readonly Phrase[]
  /** the sentence in parts, as its row draws it */
  readonly says: Predicate
  /** what else the relationship declares: `no self`, `acyclic` */
  readonly constraints: readonly string[]
  /** the ancestor whose end the Class stands at, when the end does not name the Class itself */
  readonly through?: ClassLink
  /** how many Classes the Class's own end accepts, when it accepts more than one */
  readonly endAccepts?: number
}

/** How many: in words (`exactly one`) and as the Schema writes it (`1`, `0..*`). */
export interface Count {
  readonly words: string
  readonly declared: string
}

export interface EndLine {
  readonly end: 'source' | 'target'
  readonly role: string
  readonly accepts: readonly ClassLink[]
  /** how many links a Node at this end has */
  readonly count: Count
  /** what deleting a Node at this end does to the link; none when the lifetimes are not read */
  readonly lifetime?: { readonly lifetime: Lifetime; readonly declared: boolean }
}

/**
 * What a relationship says of a Node at one end, in parts: the reader's verb (`contains`) or
 * `has` with the other end's role when it says more than its Classes' names, how many, and the
 * other end's Classes.
 */
export interface Predicate {
  readonly verb: string
  /** the other end's role, when the verb is `has` and the role says more than its Classes */
  readonly role?: string
  readonly count: Count
  readonly others: readonly ClassLink[]
}

interface Identity {
  readonly name: string
  /** its comment anchor: `class.X`, `edge.X`, an imported `class.<key>` */
  readonly anchor: string
  /** the source file that declares it, when the Domain on screen does */
  readonly file?: string
  readonly description?: string
  /** its module's name, when it lives in one */
  readonly module?: string
  /** the short name of the Domain that declares it, when it is not the one on screen */
  readonly domain?: string
  /** the Kernel bases that say what it is, however far up they are */
  readonly roles: readonly KernelRole[]
  readonly parents: readonly ClassLink[]
  /** the parents' own ancestors, nearest first */
  readonly ancestors: readonly ClassLink[]
  readonly properties: readonly PropertyLine[]
}

export interface ClassStructure extends Identity {
  readonly kind: 'class'
  readonly relationships: readonly RelationshipLine[]
  /** what deleting one of its Nodes does to its links; none when the lifetimes are not read */
  readonly deletion?: Deletion
}

/**
 * What deleting a Node does to the links it stands in, over the relationships of the Domain on
 * screen: those that go with it (`detach`), and those that refuse its deletion unless the same
 * change deletes them (`restrict`).
 */
export interface Deletion {
  readonly detaches: readonly DeletionLine[]
  readonly restricts: readonly DeletionLine[]
}

/** One end a Class's Nodes stand at, with what deleting one does to the link. */
export interface DeletionLine {
  readonly relationship: ClassLink
  readonly role: string
  /** the Classes at the other end */
  readonly others: readonly ClassLink[]
  /** every Node there has such a link: deleting one always meets it */
  readonly always: boolean
  /** the end declares its lifetime, rather than taking the one the Kernel derives */
  readonly declared: boolean
  /** the ancestor the end accepts, when it does not name the Class itself */
  readonly through?: ClassLink
  /** the end accepts any Node */
  readonly any?: true
}

export interface RelationshipStructure extends Identity {
  readonly kind: 'relationship'
  readonly directed: boolean
  readonly ends: readonly [EndLine, EndLine]
  /** the relationship said from each end */
  readonly sentences: readonly (readonly Phrase[])[]
  readonly constraints: readonly string[]
}

export type Structure = ClassStructure | RelationshipStructure

const ENDS = ['source', 'target'] as const

/** The Class a reference names, as a link, wearing its icon and its module's hue. */
export function classLink(bundle: StudioSchemaBundle, ref: IrClassRef): ClassLink {
  const domain = bundle.ir?.domain
  const cls = resolveClass(bundle, ref)
  const local = ref.origin === domain
  const relationship = cls?.type === 'edge'
  const hue = local && !relationship ? hueOf(bundle, ref.name) : undefined
  return {
    target: classSelectionId(ref, domain),
    name: ref.name,
    ...(local ? {} : { domain: originLabel(ref.origin) }),
    open: cls !== undefined,
    ...(cls?.icon === undefined ? {} : { icon: cls.icon }),
    ...(relationship ? { relationship: true as const } : {}),
    ...(hue === undefined ? {} : { hue }),
  }
}

const HUES = new WeakMap<StudioSchemaBundle, ReadonlyMap<string, number>>()

/** A local Class's module hue, as the canvas paints its card: none at the Schema's root. */
function hueOf(bundle: StudioSchemaBundle, name: string): number | undefined {
  const module = moduleOfMember(bundle, 'class', name)
  if (module === 'root') return undefined
  let hues = HUES.get(bundle)
  if (hues === undefined) {
    hues = moduleHues(bundle)
    HUES.set(bundle, hues)
  }
  return hues.get(module)
}

/** The structure of a Class or relationship, as declared and inherited. */
export function structureOf(
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
  terms: Terms = NO_TERMS,
): Structure | undefined {
  const cls = resolveClass(bundle, ref)
  const ir = bundle.ir
  if (cls === undefined || ir === null) return undefined
  const local = ref.origin === ir.domain
  const kind = cls.type === 'edge' ? 'edge' : 'class'
  const module = local ? moduleOfMember(bundle, kind, ref.name) : 'root'
  const levels = ancestryOfClass(bundle, cls.extendsRefs ?? [])
  const anchor = local ? `${kind}.${ref.name}` : `class.${classRefKey(ref)}`
  const span = local ? bundle.overlay.sourceSpans[anchor] : undefined
  const description = span?.doc ?? cls.description
  const identity: Identity = {
    name: ref.name,
    anchor,
    ...(span?.file === undefined ? {} : { file: span.file }),
    ...(description === undefined ? {} : { description }),
    ...(module === 'root' ? {} : { module: moduleLabel(module, 'schema') }),
    ...(local ? {} : { domain: originLabel(ref.origin) }),
    roles: kernelRolesOfClass(bundle, cls.extendsRefs ?? []),
    parents: (levels[0] ?? []).map((parent) => classLink(bundle, parent)),
    ancestors: levels
      .slice(1)
      .flat()
      .map((ancestor) => classLink(bundle, ancestor)),
    properties: propertiesOf(bundle, anchor, ref, cls),
  }
  if (cls.type !== 'edge' || cls.endpoints === undefined || cls.endpoints.length < 2) {
    const deletion = deletionOf(bundle, ref)
    return {
      kind: 'class',
      ...identity,
      relationships: relationshipsOf(bundle, ref, terms),
      ...(deletion === undefined ? {} : { deletion }),
    }
  }
  const designation = terms.relation(classRefKey(ref))
  const endpoints = [cls.endpoints[0]!, cls.endpoints[1]!] as const
  const lifetimes = lifetimesOf(bundle)?.get(classRefKey(ref))
  const endAt = (index: 0 | 1): EndLine => ({
    ...endLine(bundle, endpoints[index], ENDS[index]),
    ...(lifetimes === undefined
      ? {}
      : { lifetime: { lifetime: lifetimes.ends[index], declared: lifetimes.declared[index] } }),
  })
  return {
    kind: 'relationship',
    ...identity,
    directed: cls.orientation !== 'undirected',
    ends: [endAt(0), endAt(1)],
    sentences: ([0, 1] as const).map((index) => {
      const subjects = acceptsOf(bundle, endpoints[index]).map((each) => classLink(bundle, each))
      const says = predicateOf(
        bundle,
        designation,
        ENDS[index],
        endpoints[index],
        endpoints[1 - index]!,
      )
      return [
        ...subjectPhrases(bundle, terms, subjects),
        ...predicate(bundle, terms, says, endpoints[index]),
      ]
    }),
    constraints: constraintWords(cls),
  }
}

/** What else a relationship declares, in a word each. */
function constraintWords(cls: IrClass): string[] {
  return [
    ...(cls.constraints?.noSelf ? ['no self'] : []),
    ...(cls.constraints?.acyclic ? ['acyclic'] : []),
  ]
}

function endLine(
  bundle: StudioSchemaBundle,
  endpoint: IrEndpoint,
  end: 'source' | 'target',
): EndLine {
  return {
    end,
    role: endpoint.name,
    accepts: acceptsOf(bundle, endpoint).map((ref) => classLink(bundle, ref)),
    count: countOf(endpoint.cardinality),
  }
}

/** An end's count, in words and as written. */
const countOf = (count: IrEndpoint['cardinality']): Count => ({
  words: countWords(count),
  declared: count === undefined ? '0..*' : declared(count),
})

/** A count as the Schema writes it: `0..*`, `1..*`, `0..1`, `1`. */
const declared = (count: { min: number; max: number | null }) =>
  count.max === null ? `${count.min}..*` : cardLabel(count)

/** The exact Classes an end accepts: its refs, else its local names. */
export function acceptsOf(bundle: StudioSchemaBundle, endpoint: IrEndpoint): IrClassRef[] {
  if (endpoint.refs !== undefined)
    return endpoint.refs.flatMap((ref) =>
      ref.kind === 'class' ? [{ origin: ref.origin, kind: 'class' as const, name: ref.name }] : [],
    )
  const domain = bundle.ir?.domain ?? ''
  return endpoint.types.map((name) => ({ origin: domain, kind: 'class' as const, name }))
}

/** The Kernel Key of a linked Class. */
const keyOf = (bundle: StudioSchemaBundle, link: ClassLink) => {
  const token = link.target.slice('class.'.length)
  return token.includes(':class.') ? token : `${bundle.ir?.domain}:class.${token}`
}

/** Phrases joined as a list: `A, B or C`. */
function joined(items: readonly Phrase[], word: 'and' | 'or'): Phrase[] {
  return items.flatMap((item, index) =>
    index === 0 ? [item] : [index === items.length - 1 ? ` ${word} ` : ', ', item],
  )
}

/** Classes named in the singular or the plural, each opening its Class. */
function named(
  bundle: StudioSchemaBundle,
  terms: Terms,
  links: readonly ClassLink[],
  many: boolean,
): Phrase[] {
  return joined(
    links.map((link): Phrase => ({
      link,
      text: many ? pluralName(link.name, terms.noun(keyOf(bundle, link))) : link.name,
    })),
    'or',
  )
}

/** A sentence's subject: `A Fleet`, `A Role, Group or User`. */
function subjectPhrases(
  bundle: StudioSchemaBundle,
  terms: Terms,
  subjects: readonly ClassLink[],
): Phrase[] {
  const first = subjects[0]
  if (first === undefined) return ['A Node']
  return [
    `${articleOf(first.name, terms.noun(keyOf(bundle, first)))} `,
    ...named(bundle, terms, subjects, false),
  ]
}

/**
 * What a relationship says of a Node at `end`: the reader's reading of it with the count of the
 * other end's Classes (`contains any number of FleetResources`); where the reader has no
 * reading that end can say, the other end's declared role and Classes (`has at most one parent
 * Issue`, the role left out when it is the Class's own name: `has any number of Instances`).
 */
function predicateOf(
  bundle: StudioSchemaBundle,
  designation: ReturnType<Terms['relation']>,
  end: 'source' | 'target',
  own: IrEndpoint,
  other: IrEndpoint,
): Predicate {
  const count = countOf(own.cardinality)
  const others = acceptsOf(bundle, other).map((ref) => classLink(bundle, ref))
  const phrase = relationPhrase(designation, end)
  if (phrase !== undefined) return { verb: phrase, count, others }
  const role = other.name.replaceAll('_', ' ')
  const sole = others.length === 1 && others[0]!.name.toLowerCase() === role.toLowerCase()
  return { verb: 'has', ...(sole ? {} : { role }), count, others }
}

/** A predicate as the sentence says it, its Classes in the singular or the plural. */
function predicate(
  bundle: StudioSchemaBundle,
  terms: Terms,
  says: Predicate,
  own: IrEndpoint,
): Phrase[] {
  const many = countsMany(own.cardinality)
  return [
    ` ${says.verb} ${says.count.words} ${says.role === undefined ? '' : `${says.role} `}`,
    ...named(bundle, terms, says.others, many),
  ]
}

/**
 * Every relationship a Class stands in: those whose end names it, then those whose end names
 * one of its ancestors, each said from that end. A relationship whose two ends accept it is
 * said from each. An end that accepts any Node (a Kernel base) is no relationship of the
 * Class's own.
 */
function relationshipsOf(
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
  terms: Terms,
): RelationshipLine[] {
  const ir = bundle.ir!
  const self = classRefKey(ref)
  const ancestors = ancestryOfClass(bundle, resolveClass(bundle, ref)?.extendsRefs ?? []).flat()
  const ancestorOf = new Map(ancestors.map((each) => [classRefKey(each), each]))
  const subject = classLink(bundle, ref)
  const direct: RelationshipLine[] = []
  const inherited: RelationshipLine[] = []
  for (const [name, cls] of Object.entries(ir.classes)) {
    if (cls.type !== 'edge' || cls.endpoints === undefined || cls.endpoints.length < 2) continue
    const edge: IrClassRef = { origin: ir.domain, kind: 'class', name }
    const designation = terms.relation(classRefKey(edge))
    ENDS.forEach((end, index) => {
      const own = cls.endpoints![index]!
      const accepted = acceptsOf(bundle, own)
      const keys = accepted.map(classRefKey)
      const through = keys.includes(self)
        ? undefined
        : keys.map((key) => ancestorOf.get(key)).find((each) => each !== undefined)
      if (!keys.includes(self) && (through === undefined || isKernelImplementationClass(through)))
        return
      const says = predicateOf(bundle, designation, end, own, cls.endpoints![1 - index]!)
      const line: RelationshipLine = {
        relationship: classLink(bundle, edge),
        end,
        role: own.name,
        sentence: [
          ...subjectPhrases(bundle, terms, [subject]),
          ...predicate(bundle, terms, says, own),
        ],
        says,
        constraints: constraintWords(cls),
        ...(through === undefined ? {} : { through: classLink(bundle, through) }),
        ...(accepted.length > 1 ? { endAccepts: accepted.length } : {}),
      }
      ;(through === undefined ? direct : inherited).push(line)
    })
  }
  return [...direct, ...inherited]
}

/** What deleting a Node of the Class does to its links, end by end: those that go, those that refuse. */
function deletionOf(bundle: StudioSchemaBundle, ref: IrClassRef): Deletion | undefined {
  const ends = endsHolding(bundle, ref)
  if (ends === undefined) return undefined
  const lines = ends.map((end) => ({
    lifetime: end.lifetime,
    line: {
      relationship: classLink(bundle, end.relationship),
      role: end.role,
      others: end.others.map((other) => classLink(bundle, other)),
      always: end.always,
      declared: end.declared,
      ...(end.through === undefined ? {} : { through: classLink(bundle, end.through) }),
      ...(end.any ? { any: true as const } : {}),
    } satisfies DeletionLine,
  }))
  return {
    detaches: lines.filter((each) => each.lifetime === 'detach').map((each) => each.line),
    restricts: lines.filter((each) => each.lifetime === 'restrict').map((each) => each.line),
  }
}

/** A constraint site that counts an end's links (`resource · incoming 1`): the ends already say it. */
const COUNTED = / · (?:incoming|outgoing) /

/**
 * The constraints on a Class or relationship that its ends, relationships and Property marks do
 * not already say — no self link, no cycle, unique tuples — in the reader's words where it has
 * them, else as declared.
 */
export function holdsOf(rules: DomainRules, target: string): string[] {
  return sitesOn(rules, target)
    .filter((site) => site.kind === 'what' && !COUNTED.test(site.title))
    .map((site) =>
      site.reading.status === 'read' ? ruleView(site.reading.rule).sentence : site.title,
    )
}

// ── Properties ──

type Metadata = {
  readonly required?: boolean
  readonly description?: string
  readonly immutable?: 'create' | 'once'
  readonly auto?: { readonly on?: readonly string[] }
  readonly searchable?: true
  readonly state?: {
    readonly initial?: string
    readonly transitions?: Readonly<Record<string, Readonly<Record<string, string>>>>
  }
}

/** A Class's Properties: its own first, then each ancestor's, nearest first. */
function propertiesOf(
  bundle: StudioSchemaBundle,
  anchor: string,
  ref: IrClassRef,
  cls: IrClass,
): PropertyLine[] {
  const own = Object.entries(cls.properties).map(([name, schema]) =>
    propertyLine(bundle, name, schema, cls, `${anchor}.property.${name}`),
  )
  const inherited = inheritedGroupsOfClass(bundle, ref).flatMap((group) => {
    const owner = resolveClass(bundle, group.ref)
    if (owner === undefined) return []
    const from = classLink(bundle, group.ref)
    return group.props.map(([name, schema]) => ({
      ...propertyLine(bundle, name, schema, owner, `${from.target}.property.${name}`),
      from,
    }))
  })
  return [...own, ...inherited]
}

function propertyLine(
  bundle: StudioSchemaBundle,
  name: string,
  schema: JsonSchema,
  owner: IrClass,
  anchor: string,
): PropertyLine {
  const metadata = (owner.propertyMetadata?.[name] ?? {}) as Metadata
  const required = metadata.required ?? (owner.required ?? []).includes(name)
  const description =
    (typeof schema.description === 'string' ? schema.description : undefined) ??
    metadata.description ??
    bundle.overlay.sourceSpans[anchor]?.doc
  const state = machineOf(schema, metadata)
  return {
    name,
    ...(state === undefined ? valueTypeOf(bundle, schema) : { type: 'State', kind: 'state' }),
    ...(description === undefined ? {} : { description }),
    marks: marksOf(required, metadata),
    ...(state === undefined ? {} : { state }),
    anchor,
  }
}

const AUTO_EVENTS: Record<string, string> = { create: 'creation', update: 'each update' }

function marksOf(required: boolean, metadata: Metadata): PropertyMark[] {
  const marks: PropertyMark[] = []
  if (required)
    marks.push({ kind: 'required', label: 'required', meaning: 'Every one has a value.' })
  if (metadata.immutable === 'create')
    marks.push({
      kind: 'immutable',
      label: 'fixed at creation',
      meaning: 'Written only when it is created, never changed after.',
    })
  if (metadata.immutable === 'once')
    marks.push({
      kind: 'immutable',
      label: 'set once',
      meaning: 'Written while it has no value, then never changed or unset.',
    })
  if (metadata.auto !== undefined) {
    const on = (metadata.auto.on ?? []).map((event) => AUTO_EVENTS[event] ?? event)
    marks.push({
      kind: 'automatic',
      label: 'automatic',
      meaning: `The Kernel sets it to the current time on ${on.join(' and ')}.`,
    })
  }
  if (metadata.searchable === true)
    marks.push({ kind: 'searchable', label: 'searchable', meaning: 'Text search reads it.' })
  return marks
}

/**
 * A state Property's machine: its declared transitions, and its states in the order the
 * machine reaches them from its initial state, those it never reaches after.
 */
function machineOf(schema: JsonSchema, metadata: Metadata): StateMachine | undefined {
  const machine = metadata.state
  if (machine === undefined) return undefined
  const transitions = Object.entries(machine.transitions ?? {}).flatMap(([from, events]) =>
    Object.entries(events).map(([event, to]) => ({ from, event, to })),
  )
  const reached: string[] = []
  const queue = machine.initial === undefined ? [] : [machine.initial]
  while (queue.length > 0) {
    const state = queue.shift()!
    if (reached.includes(state)) continue
    reached.push(state)
    queue.push(...transitions.filter((each) => each.from === state).map((each) => each.to))
  }
  const listed = [
    ...(schema.enum ?? []).map(String),
    ...transitions.flatMap(({ from, to }) => [from, to]),
  ]
  return {
    ...(machine.initial === undefined ? {} : { initial: machine.initial }),
    states: [...new Set([...reached, ...listed])],
    transitions,
  }
}

const FORMATS: Record<string, string> = {
  'date-time': 'Date and time',
  date: 'Date',
  uri: 'URL',
  email: 'Email',
}

/** A value's type: its words, its kind, and the Classes a reference accepts. */
export function valueTypeOf(bundle: StudioSchemaBundle, schema: JsonSchema | undefined): ValueType {
  const kind = valueKindOf(schema)
  const refs =
    kind === 'reference' && schema !== undefined
      ? nodePathAccepts(describe(schema).kind === 'array' && schema.items ? schema.items : schema)
      : []
  return {
    type: typeWords(schema),
    kind,
    ...(refs.length > 0 ? { refs: refs.map((ref) => classLink(bundle, ref)) } : {}),
  }
}

/** What kind of value a schema holds; a list of references is a reference. */
export function valueKindOf(schema: JsonSchema | undefined): ValueKind {
  if (schema === undefined) return 'value'
  const descriptor = describe(schema)
  const item = descriptor.kind === 'array' && schema.items ? schema.items : schema
  if (descriptor.kind === 'ref' || nodePathAccepts(item).length > 0) return 'reference'
  if (schema.format === 'date-time' || schema['x-astrale-value-kind'] === 'instant')
    return 'datetime'
  if (schema.format === 'date') return 'date'
  if (schema.format === 'uri') return 'url'
  if (schema.format === 'email') return 'email'
  switch (descriptor.kind) {
    case 'enum':
      return 'choice'
    case 'object':
      return 'object'
    case 'array':
      return 'list'
    case 'string':
      return 'text'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'value'
  }
}

/** A type's words inside a phrase (`List of text`): an acronym (`URL`) keeps its case. */
export const inner = (words: string) =>
  /^[A-Z][a-z]/.test(words) ? `${words.charAt(0).toLowerCase()}${words.slice(1)}` : words

/** A value type in words, never JSON Schema: `Text`, `Date and time`, `Reference to Host`. */
export function typeWords(schema: JsonSchema | undefined): string {
  if (schema === undefined) return 'Value'
  const descriptor = describe(schema)
  const accepts = nodePathAccepts(
    descriptor.kind === 'array' && schema.items ? schema.items : schema,
  )
  if (accepts.length > 0) {
    const names = [...new Set(accepts.map((ref) => ref.name))]
    const list =
      names.length > 3 ? `${names.slice(0, 3).join(', ')} or another` : names.join(' or ')
    return descriptor.kind === 'array' ? `List of references to ${list}` : `Reference to ${list}`
  }
  const format = typeof schema.format === 'string' ? FORMATS[schema.format] : undefined
  if (format !== undefined) return format
  if (schema['x-astrale-value-kind'] === 'instant') return 'Date and time'
  if (descriptor.kind === 'enum') {
    const values = descriptor.values.map(String)
    if (values.length === 1) return `Always ${values[0]}`
    return values.length > 4
      ? `One of ${values.slice(0, 4).join(', ')} and ${values.length - 4} more`
      : `One of ${values.join(', ')}`
  }
  if (descriptor.kind === 'object') {
    const fields = Object.keys(descriptor.fields)
    if (fields.length === 0) return 'Object'
    const more = fields.length > 3 ? ` and ${fields.length - 3} more` : ''
    return `Object with ${fields.slice(0, 3).join(', ')}${more}`
  }
  if (descriptor.kind === 'array' && schema.items !== undefined) {
    const item = typeWords(schema.items)
    return item === 'Value' ? 'List' : `List of ${inner(item)}`
  }
  return friendlyFieldType(schema).label
}
