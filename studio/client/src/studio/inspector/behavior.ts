/**
 * What happens, for the Inspector's Behavior lens: what changes a Class and how its state
 * moves; what a function changes, reaches and calls; what a mutation or query does; what an
 * Integration offers and who reaches it. Read from the source overlay (handler links, the
 * effects of each definition, Integration declarations), never from the Schema alone: what
 * the reading cannot follow is said, never left out.
 */
import type {
  DefinitionEffect,
  DefinitionLink,
  DefinitionPrecondition,
  DefinitionPreconditionKind,
  HandlerLink,
  IntegrationReplay,
  IrCallable,
  IrEndpoint,
  IrMethod,
  JsonSchema,
  PreconditionCondition,
  PreconditionTerm,
  SourceGap,
  StudioSchemaBundle,
} from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { nodePathsIn } from '@shared/contracts/schema'
import { classRefKey } from '@shared/schema/identity'

import { describe, fieldChildren } from '@/lib/value-type'

import type { Lifetime } from '../lenses/lifetimes'

import {
  callableKeyOf,
  definitionTarget,
  effectClass,
  reachUsers,
} from '../../schema-studio/definitions'
import {
  ancestryOfClass,
  inheritedGroupsOfClass,
  resolveClass,
} from '../../schema-studio/inheritance'
import { integrationTarget, replayLabel, replayMeaning } from '../../schema-studio/integrations'
import { edgeEndsOf, edgeVerb, readsHandlers } from '../lenses/behavior'
import { type Consequence, consequencesOf, type DeletionOutcome } from '../lenses/deletion'
import {
  acceptsOf,
  type ClassLink,
  classLink,
  type Phrase,
  inner,
  type StateMachine,
  structureOf,
  type ValueType,
  valueTypeOf,
} from './structure'
import { callableTargetOf, type InspectorTarget } from './target'
import { articleOf, NO_TERMS, type Terms } from './words'

/** A function or Method named on the page, with the selection that opens it. */
export interface CallableLink {
  readonly target: string
  /** `Class.method`, or a function's name */
  readonly key: string
  readonly kind?: 'action' | 'workflow'
}

/** A mutation or query named on the page. */
export interface DefinitionRef {
  readonly target: string
  readonly id: string
  readonly kind: 'query' | 'mutation'
}

/** The change a write makes to a Class. */
export type ChangeVerb = 'create' | 'update' | 'delete' | 'transition' | 'link' | 'unlink'

/** A function that makes one kind of change, with the definitions that make it. */
export interface ChangeBy {
  readonly fn: CallableLink
  readonly definitions: readonly DefinitionRef[]
  /** the relationship a link or unlink writes */
  readonly relationships: readonly ClassLink[]
  /** the ancestor the change names, when it names no end or Class that is the Class alone */
  readonly through?: ClassLink
  /**
   * a deletion's links that stop it, as the Kernel's lifetimes say: those it is refused while
   * the Node has, and those the reading cannot tell it deletes first
   */
  readonly blocked?: readonly DeletionMeets[]
}

/** What becomes of a deleted Node's links of some relationships, as the Kernel's lifetimes say. */
export type DeletionMeets = { readonly relationships: readonly ClassLink[] } & (
  | { readonly outcome: Exclude<DeletionOutcome, 'unlinked'> }
  | {
      readonly outcome: 'unlinked'
      /**
       * the lifetime of the links the mutation unlinks itself: `restrict`, they would refuse the
       * deletion were they left; `detach`, they would go with the Node anyway
       */
      readonly lifetime: Lifetime
    }
)

export interface ChangeGroup {
  readonly verb: ChangeVerb
  /** `Create a Host`, `Link a Host` */
  readonly label: string
  /** functions whose mutations name the Class itself */
  readonly by: readonly ChangeBy[]
  /** functions whose mutations may: they name an ancestor, or an end that accepts other Classes too */
  readonly may: readonly ChangeBy[]
}

/** A declared transition, and the functions that make it where the source says so. */
export interface LifecycleStep {
  readonly from: string
  readonly event: string
  readonly to: string
  /** functions whose mutations make this step, `from` and event as written */
  readonly by: readonly CallableLink[]
  /** functions whose mutations write this step as declared but name the Class only through a base */
  readonly base: readonly { readonly fn: CallableLink; readonly through: ClassLink }[]
  /** functions whose mutations write the event without the state it leaves: any step on it */
  readonly may: readonly CallableLink[]
}

/**
 * Functions that may make any step on some events, stated once for the lifecycle rather than
 * under each step: their mutations write the event without the state it leaves, and name the
 * Class itself (`event`) or only through a base (`base`).
 */
export interface LooseMoves {
  readonly by: readonly CallableLink[]
  readonly events: readonly string[]
  readonly reason: 'event' | 'base'
}

export interface Lifecycle {
  readonly property: string
  readonly initial?: string
  readonly states: readonly string[]
  readonly steps: readonly LifecycleStep[]
  /** the `may` of every step, grouped by the functions that share the same events and reason */
  readonly loose: readonly LooseMoves[]
  /** functions that move the state by an event the reading cannot tell */
  readonly untold: readonly CallableLink[]
}

export interface ClassBehavior {
  readonly kind: 'class'
  readonly name: string
  readonly relationship: boolean
  /** whether the bundle holds the handler sources what changes it is read from (`readsHandlers`) */
  readonly handlers: boolean
  readonly groups: readonly ChangeGroup[]
  readonly lifecycles: readonly Lifecycle[]
  /** mutations that change it but no function's handler reaches */
  readonly unreached: readonly DefinitionRef[]
  /** functions whose queries or preconditions read it, without changing it */
  readonly readers: readonly CallableLink[]
  /** mutations whose reading names a Class it cannot tell: any of them may change it too */
  readonly untold: readonly DefinitionRef[]
  /** the Methods declared on it, then the contracts it inherits, each with the Class that declares it */
  readonly methods: readonly MethodLine[]
  /** the Domain functions whose input points at it */
  readonly functions: readonly CallableLink[]
}

/** A Method a Class has: its own, or a contract a base declares (`from`). */
export interface MethodLine {
  readonly fn: CallableLink
  readonly name: string
  readonly static: boolean
  readonly abstract: boolean
  readonly from?: ClassLink
  /** whether the bundle declares it, so opening it shows something: an imported base's does not */
  readonly open: boolean
}

/** A field of an input or output, in words. */
export interface FieldLine extends ValueType {
  readonly name: string
  readonly required: boolean
  readonly description?: string
}

/** What an effect line says: a write or a read. A precondition is read whole (`PreconditionLine`). */
export type SaidEffect = DefinitionEffect & {
  readonly kind: Exclude<DefinitionEffect['kind'], 'expect'>
}

/** One thing a definition does, in source order. */
export interface EffectLine {
  readonly kind: SaidEffect['kind']
  /** the change it makes, whose word opens `words`; none for a read */
  readonly verb?: ChangeVerb
  /** `creates an Operation`, `moves an Operation from accepted to succeeded on commit` */
  readonly words: readonly Phrase[]
  readonly relationship?: ClassLink
  readonly file: string
  readonly line: number
  /** a Node deletion's links, by what becomes of them: refused, untold, unlinked, detached */
  readonly deletion?: readonly DeletionMeets[]
  /** a link's two roles, when both ends accept the same Class: either end reads alike */
  readonly selfRoles?: readonly [string, string]
  /** how many of the source's effects it stands for, when it stands for more than one */
  readonly times?: number
}

/**
 * A mutation's writes as they read best: its Node writes first, in source order, then each
 * relationship's link writes once, by verb. A self relationship's writes at either end read as
 * one row naming both roles; the unlinks a Node deletion makes itself read under that deletion,
 * as the relationships it unlinks, and nowhere else. Every effect is in a row: `times` counts
 * the effects a row stands for.
 */
export function arrangeWrites(effects: readonly EffectLine[]): EffectLine[] {
  const nodes = effects.filter((effect) => effect.relationship === undefined)
  const unlinkedByDelete = new Set(
    nodes.flatMap((effect) =>
      (effect.deletion ?? [])
        .filter((meets) => meets.outcome === 'unlinked')
        .flatMap((meets) => meets.relationships.map((link) => link.target)),
    ),
  )
  const links = new Map<string, EffectLine[]>()
  for (const effect of effects) {
    if (effect.relationship === undefined) continue
    if (effect.kind === 'delete' && unlinkedByDelete.has(effect.relationship.target)) continue
    const key = `${effect.kind} ${effect.relationship.target}`
    links.set(key, [...(links.get(key) ?? []), effect])
  }
  return [
    ...nodes,
    ...[...links.values()].map(([first, ...rest]) =>
      rest.length === 0 ? first! : { ...first!, times: rest.length + 1 },
    ),
  ]
}

export interface DefinitionStep {
  readonly definition: DefinitionRef
  readonly name?: string
  readonly doc?: string
  readonly effects: readonly EffectLine[]
  /** what a mutation requires before it writes, in source order; a query states none */
  readonly preconditions: readonly PreconditionLine[]
  readonly gaps: readonly SourceGap[]
}

/**
 * A precondition a mutation's `build` states (`mutation.expect.<kind>`): the Kernel refuses the
 * mutation where it does not hold. Read from the source as written, and checked against nothing.
 */
export interface PreconditionLine {
  readonly kind: DefinitionPreconditionKind
  /** the Classes it requires something of; none where the reading cannot tell */
  readonly classes: readonly ClassLink[]
  /** the name a refusal carries, where the source gives one */
  readonly name?: string
  /** its parts as the source writes them, in the order the SDK takes them */
  readonly terms: readonly PreconditionTerm[]
  /** the conditions and loops it is stated under, outermost first; none on every path */
  readonly under?: readonly PreconditionCondition[]
  /** the mutations that state it: one a helper they share states is read once, with each */
  readonly mutations: readonly DefinitionRef[]
  readonly file: string
  readonly line: number
  /** why the reading cannot tell all of it */
  readonly gap?: string
}

export interface OperationReach {
  /** `integration.<key>` */
  readonly target: string
  readonly integration: string
  readonly operation: string
  readonly replay: readonly IntegrationReplay[]
  /** what another attempt may do, as a label: none when every attempt is safe */
  readonly label?: string
  readonly meaning?: string
}

export interface FunctionBehavior {
  readonly kind: 'function'
  readonly key: string
  /** whether the bundle holds the handler sources what it does is read from (`readsHandlers`) */
  readonly handlers: boolean
  readonly flavor?: 'action' | 'workflow'
  readonly static: boolean
  readonly abstract: boolean
  /** false for a stub (`todo()`), undefined when no handler is linked */
  readonly implemented?: boolean
  /** a handler is declared but the reading could not find its file */
  readonly unlinked?: boolean
  /** the Kernel operations its handler calls directly (`::update`, `createNode`) */
  readonly kernelCalls: readonly string[]
  /** the Class a Method is declared on, or the Classes a function's input points at */
  readonly on: readonly ClassLink[]
  readonly description?: string
  readonly input: readonly FieldLine[]
  readonly output: ValueType & { readonly fields: readonly FieldLine[] }
  /** the mutations its handler reaches, by id: the reading does not give their order */
  readonly changes: readonly DefinitionStep[]
  /** what those mutations require before they write, each once */
  readonly preconditions: readonly PreconditionLine[]
  readonly reads: readonly DefinitionStep[]
  readonly reaches: readonly OperationReach[]
  readonly calls: readonly CallableLink[]
  readonly calledBy: readonly CallableLink[]
  readonly untold: readonly SourceGap[]
  readonly source?: { readonly file: string; readonly line?: number }
}

export interface DefinitionBehavior extends DefinitionStep {
  readonly kind: 'definition'
  /** the Classes its `build` names, whether or not an effect was read on each */
  readonly names: readonly ClassLink[]
  readonly usedBy: readonly CallableLink[]
  readonly source: { readonly file: string; readonly line: number }
}

export interface IntegrationBehavior {
  readonly kind: 'integration'
  readonly key: string
  readonly id?: string
  readonly doc?: string
  /** the name its declaration is bound to in source */
  readonly binding?: string
  /** whether its declaration was read; when not, its operations are those its users name */
  readonly declared: boolean
  readonly operations: readonly {
    readonly name: string
    readonly replay: readonly IntegrationReplay[]
    readonly label?: string
    readonly meaning?: string
    readonly users: readonly CallableLink[]
  }[]
  /** functions whose reading cannot tell every operation they reach */
  readonly untold: readonly CallableLink[]
  readonly source?: { readonly file: string; readonly line?: number }
}

export type Behavior = ClassBehavior | FunctionBehavior | DefinitionBehavior | IntegrationBehavior

// ── the overlay, indexed once per bundle ──

interface Index {
  readonly callables: ReadonlyMap<string, CallableLink>
  readonly links: ReadonlyMap<string, HandlerLink>
  readonly definitions: ReadonlyMap<string, DefinitionLink>
  /** definition id → callable keys whose handlers reach it */
  readonly users: ReadonlyMap<string, readonly string[]>
  readonly callers: ReadonlyMap<string, readonly string[]>
}

const indexes = new WeakMap<StudioSchemaBundle, Index>()

function indexOf(bundle: StudioSchemaBundle): Index {
  let index = indexes.get(bundle)
  if (index === undefined) {
    const { handlerLinks, definitions } = bundle.overlay
    index = {
      callables: new Map(
        handlerLinks.map((link) => [callableKeyOf(link), callableOf(callableKeyOf(link), link)]),
      ),
      links: new Map(handlerLinks.map((link) => [callableKeyOf(link), link])),
      definitions: new Map(definitions.map((definition) => [definition.id, definition])),
      users: reachUsers(handlerLinks, (link) => link.definitions),
      callers: reachUsers(handlerLinks, (link) => link.calls),
    }
    indexes.set(bundle, index)
  }
  return index
}

function callableOf(key: string, link: HandlerLink | undefined): CallableLink {
  return { target: callableTargetOf(key), key, ...(link === undefined ? {} : { kind: link.kind }) }
}

const callable = (index: Index, key: string) =>
  index.callables.get(key) ?? callableOf(key, undefined)

const definitionRef = (definition: Pick<DefinitionLink, 'kind' | 'id'>): DefinitionRef => ({
  target: definitionTarget(definition),
  id: definition.id,
  kind: definition.kind,
})

const byKey = (left: { key: string }, right: { key: string }) => left.key.localeCompare(right.key)

// ── Behavior of a target ──

export function behaviorOf(
  bundle: StudioSchemaBundle,
  target: InspectorTarget,
  terms: Terms = NO_TERMS,
): Behavior | undefined {
  switch (target.kind) {
    case 'class':
      return classBehavior(bundle, target.ref, terms)
    case 'function':
      return functionBehavior(bundle, target, terms)
    case 'definition':
      return definitionBehavior(bundle, target.definition, terms)
    case 'integration':
      return integrationBehavior(bundle, target.integration.key)
    default:
      return undefined
  }
}

const WRITES: Partial<Record<DefinitionEffect['kind'], ChangeVerb>> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  transition: 'transition',
}

const VERB_ORDER: readonly ChangeVerb[] = [
  'create',
  'update',
  'transition',
  'link',
  'unlink',
  'delete',
]

function changeLabel(
  verb: ChangeVerb,
  name: string,
  relationship: boolean,
  terms: Terms,
  key: string,
) {
  const a = `${articleOf(name, terms.noun(key)).toLowerCase()} ${name}`
  if (relationship)
    return { create: `Make ${a} link`, update: `Update ${a} link`, delete: `Remove ${a} link` }[
      verb as 'create'
    ]
  return {
    create: `Create ${a}`,
    update: `Update ${a}`,
    transition: `Move ${a}’s state`,
    link: `Link ${a}`,
    unlink: `Unlink ${a}`,
    delete: `Delete ${a}`,
  }[verb]
}

/**
 * What changes a Class: the functions whose handlers reach a mutation that writes it, by
 * verb. A write that names one of its ancestors changes it too (`through`); an Edge written
 * with an end that accepts it links, unlinks or updates it, unless the same mutation creates
 * or deletes the Node at that end with the Edge (`edgeEndsOf`, as the canvas draws it).
 */
function classBehavior(bundle: StudioSchemaBundle, ref: IrClassRef, terms: Terms): ClassBehavior {
  const index = indexOf(bundle)
  const cls = resolveClass(bundle, ref)!
  const relationship = cls.type === 'edge'
  const self = classRefKey(ref)
  const ancestors = ancestryOfClass(bundle, cls.extendsRefs ?? []).flat()
  const ancestorOf = new Map(ancestors.map((each) => [classRefKey(each), each]))
  /**
   * How an effect's Class bears on the selected one: it names the Class (`sure`), one of its
   * ancestors, or a relationship one of whose ends it does not carry accepts it — `sure` when
   * that end accepts the Class alone.
   */
  const bearing = (definition: DefinitionLink, effect: DefinitionEffect): Bearing | undefined => {
    const named = effectClass(bundle.ir?.domain ?? '', effect.class)
    const key = classRefKey(named)
    if (key === self) return { as: 'self', sure: true }
    const ancestor = ancestorOf.get(key)
    if (ancestor !== undefined)
      return { as: 'self', sure: false, through: classLink(bundle, ancestor) }
    if (relationship) return undefined
    const ends = (edgeEndsOf(bundle, definition, effect) ?? []).flatMap((end) =>
      end.carrier === undefined ? [end.accepts.map(classRefKey)] : [],
    )
    if (ends.length === 0) return undefined
    const link = classLink(bundle, named)
    if (ends.some((keys) => keys.includes(self)))
      return {
        as: 'edge',
        edge: link,
        sure: ends.some((keys) => keys.length === 1 && keys[0] === self),
      }
    const viaAncestor = ends
      .flat()
      .map((each) => ancestorOf.get(each))
      .find((each) => each !== undefined)
    return viaAncestor === undefined
      ? undefined
      : { as: 'edge', edge: link, sure: false, through: classLink(bundle, viaAncestor) }
  }

  const groups = new Map<ChangeVerb, Map<string, Changing>>()
  const unreached = new Map<string, DefinitionRef>()
  const readers = new Set<string>()
  const moves: Move[] = []
  const untold: DefinitionRef[] = []
  for (const definition of bundle.overlay.definitions) {
    const users = index.users.get(definition.id) ?? []
    if (definition.kind === 'mutation' && (definition.gaps?.length ?? 0) > 0)
      untold.push(definitionRef(definition))
    for (const effect of definition.effects ?? []) {
      const found = bearing(definition, effect)
      if (found === undefined) continue
      const write = WRITES[effect.kind]
      if (write === undefined) {
        if (found.as === 'self') for (const user of users) readers.add(user)
        continue
      }
      const verb: ChangeVerb = found.as === 'edge' ? edgeVerb(effect) : write
      if (verb === 'transition')
        moves.push({
          effect,
          users,
          sure: found.sure,
          ...(found.through === undefined ? {} : { through: found.through }),
        })
      if (users.length === 0) unreached.set(definition.id, definitionRef(definition))
      const byFn = groups.get(verb) ?? new Map<string, Changing>()
      groups.set(verb, byFn)
      for (const user of users) {
        const entry: Changing = byFn.get(user) ?? {
          definitions: new Map(),
          relationships: new Map(),
          blocked: new Map(),
          sure: false,
        }
        if (verb === 'delete' && found.as === 'self')
          for (const meets of deletionMeets(bundle, definition, effect, BLOCKING) ?? []) {
            const relationships = entry.blocked.get(meets.outcome) ?? new Map()
            for (const link of meets.relationships) relationships.set(link.target, link)
            entry.blocked.set(meets.outcome, relationships)
          }
        entry.definitions.set(definition.id, {
          ref: definitionRef(definition),
          sure: found.sure || (entry.definitions.get(definition.id)?.sure ?? false),
        })
        if (found.as === 'edge')
          entry.relationships.set(found.edge.target, {
            link: found.edge,
            sure: found.sure || (entry.relationships.get(found.edge.target)?.sure ?? false),
          })
        entry.sure ||= found.sure
        if (found.through !== undefined) entry.through ??= found.through
        byFn.set(user, entry)
      }
    }
  }
  const changers = new Set([...groups.values()].flatMap((byFn) => [...byFn.keys()]))
  return {
    kind: 'class',
    name: ref.name,
    relationship,
    handlers: readsHandlers(bundle),
    groups: VERB_ORDER.flatMap((verb) => {
      const byFn = groups.get(verb)
      if (byFn === undefined || byFn.size === 0) return []
      const entries = [...byFn.entries()]
        .map(([key, entry]) => ({ entry, by: changeBy(index, key, entry) }))
        .sort((left, right) => left.by.fn.key.localeCompare(right.by.fn.key))
      return [
        {
          verb,
          label: changeLabel(verb, ref.name, relationship, terms, self),
          by: entries.filter(({ entry }) => entry.sure).map(({ by }) => by),
          may: entries.filter(({ entry }) => !entry.sure).map(({ by }) => by),
        },
      ]
    }),
    lifecycles: lifecyclesOf(bundle, ref, moves, index),
    unreached: [...unreached.values()],
    readers: [...readers]
      .filter((key) => !changers.has(key))
      .sort()
      .map((key) => callable(index, key)),
    untold,
    methods: methodsOf(bundle, ref, index),
    functions: Object.entries(bundle.ir?.functions ?? {})
      .filter(([, fn]) => nodePathsIn(fn.input).some((each) => classRefKey(each) === self))
      .map(([name]) => callable(index, name))
      .sort(byKey),
  }
}

/** A Class's Methods: those it declares, then the contracts each base declares, nearest first. */
function methodsOf(bundle: StudioSchemaBundle, ref: IrClassRef, index: Index): MethodLine[] {
  const cls = resolveClass(bundle, ref)
  const domain = bundle.ir?.domain
  if (cls === undefined) return []
  const line = (
    owner: IrClassRef,
    name: string,
    method: IrMethod,
    from?: ClassLink,
  ): MethodLine => ({
    fn: callable(index, `${owner.name}.${name}`),
    name,
    static: method.static,
    abstract: method.abstract,
    ...(from === undefined ? {} : { from }),
    open: owner.origin === domain,
  })
  return [
    ...Object.entries(cls.methods).map(([name, method]) => line(ref, name, method)),
    ...inheritedGroupsOfClass(bundle, ref).flatMap((group) =>
      group.methods.map(({ name, method }) =>
        line(group.ref, name, method, classLink(bundle, group.ref)),
      ),
    ),
  ]
}

type Bearing =
  | { readonly as: 'self'; readonly sure: boolean; readonly through?: ClassLink }
  | {
      readonly as: 'edge'
      readonly edge: ClassLink
      readonly sure: boolean
      readonly through?: ClassLink
    }

interface Changing {
  readonly definitions: Map<string, { readonly ref: DefinitionRef; readonly sure: boolean }>
  readonly relationships: Map<string, { readonly link: ClassLink; readonly sure: boolean }>
  /** a deletion's blocking links, by outcome, then by relationship */
  readonly blocked: Map<DeletionOutcome, Map<string, ClassLink>>
  sure: boolean
  through?: ClassLink
}

interface Move {
  readonly effect: DefinitionEffect
  readonly users: readonly string[]
  readonly sure: boolean
  /** the base the effect names, when it names the Class only through one */
  readonly through?: ClassLink
}

function changeBy(index: Index, key: string, entry: Changing): ChangeBy {
  return {
    fn: callable(index, key),
    definitions: [...entry.definitions.values()]
      .filter((each) => each.sure || !entry.sure)
      .map((each) => each.ref),
    relationships: [...entry.relationships.values()]
      .filter((each) => each.sure || !entry.sure)
      .map((each) => each.link),
    ...(entry.sure || entry.through === undefined ? {} : { through: entry.through }),
    ...(entry.blocked.size === 0
      ? {}
      : {
          blocked: BLOCKING.flatMap((outcome) => {
            const relationships = entry.blocked.get(outcome)
            return relationships ? [{ outcome, relationships: [...relationships.values()] }] : []
          }),
        }),
  }
}

/**
 * The state Properties of a Class, own or inherited, with the functions that move each: a
 * transition whose source writes its `from` bears on that step alone — it makes it (`by`), or
 * may when it names the Class through a base (`base`); one that writes only its event may make
 * any step on that event (`may`, said once in `loose`); one that writes neither is untold.
 */
function lifecyclesOf(
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
  moves: readonly Move[],
  index: Index,
): Lifecycle[] {
  const structure = structureOf(bundle, ref)
  if (structure === undefined) return []
  const keys = (found: readonly Move[]) =>
    [...new Set(found.flatMap((move) => move.users))].sort().map((key) => callable(index, key))
  return structure.properties.flatMap((property) => {
    if (property.state === undefined) return []
    const machine: StateMachine = property.state
    const own = moves.filter((move) => move.effect.property === property.name)
    const steps = machine.transitions.map((step): LifecycleStep => {
      const found = own.filter(
        (move) =>
          move.effect.event === step.event &&
          (move.effect.to === undefined || move.effect.to === step.to),
      )
      const written = found.filter((move) => move.effect.from === step.from)
      const by = keys(written.filter((move) => move.sure))
      const sure = new Set(by.map((each) => each.key))
      const base = new Map<string, { fn: CallableLink; through: ClassLink }>()
      for (const move of written)
        if (!move.sure && move.through !== undefined)
          for (const key of move.users)
            if (!sure.has(key)) base.set(key, { fn: callable(index, key), through: move.through })
      return {
        ...step,
        by,
        base: [...base.values()].sort((left, right) => (left.fn.key < right.fn.key ? -1 : 1)),
        may: keys(found.filter((move) => move.effect.from === undefined)).filter(
          (each) => !sure.has(each.key) && !base.has(each.key),
        ),
      }
    })
    return [
      {
        property: property.name,
        ...(machine.initial === undefined ? {} : { initial: machine.initial }),
        states: machine.states,
        steps,
        loose: looseOf(steps, own, (key) => callable(index, key)),
        untold: keys(own.filter((move) => move.effect.event === undefined)),
      },
    ]
  })
}

/**
 * The steps' `may`, said once: each function with the events it may make any step on, and
 * whether it names the Class itself or only a base, then functions sharing both grouped, in
 * the order of their first event in the machine.
 */
function looseOf(
  steps: readonly LifecycleStep[],
  moves: readonly Move[],
  link: (key: string) => CallableLink,
): LooseMoves[] {
  const events = new Map<string, Set<string>>()
  for (const step of steps)
    for (const each of step.may) {
      const found = events.get(each.key) ?? new Set<string>()
      found.add(step.event)
      events.set(each.key, found)
    }
  const groups = new Map<
    string,
    { keys: string[]; events: string[]; reason: LooseMoves['reason'] }
  >()
  for (const [key, found] of events) {
    const reason = moves.some(
      (move) => move.users.includes(key) && move.sure && move.effect.from === undefined,
    )
      ? 'event'
      : 'base'
    const ordered = [...new Set(steps.map((step) => step.event))].filter((event) =>
      found.has(event),
    )
    const id = `${reason}|${ordered.join('|')}`
    const group = groups.get(id) ?? { keys: [], events: ordered, reason }
    group.keys.push(key)
    groups.set(id, group)
  }
  return [...groups.values()].map((group) => ({
    by: group.keys.sort().map(link),
    events: group.events,
    reason: group.reason,
  }))
}

// ── a function ──

function fieldsOf(bundle: StudioSchemaBundle, schema: JsonSchema | undefined): FieldLine[] {
  return fieldChildren(schema).map(({ name, schema: field, optional }) => ({
    name,
    ...valueTypeOf(bundle, field),
    required: !optional,
    ...(typeof field.description === 'string' ? { description: field.description } : {}),
  }))
}

function outputOf(bundle: StudioSchemaBundle, callable: IrCallable): FunctionBehavior['output'] {
  const { output } = callable
  if (output.mode === 'binary') return { type: 'Binary content', kind: 'binary', fields: [] }
  const schema = output.mode === 'stream' ? output.item : output.schema
  const nothing =
    describe(schema).kind === 'unknown' &&
    schema.type === undefined &&
    schema.properties === undefined
  const value: ValueType = nothing
    ? { type: 'Nothing', kind: 'value' }
    : valueTypeOf(bundle, schema)
  return {
    ...value,
    ...(output.mode === 'stream' ? { type: `Stream of ${inner(value.type)}` } : {}),
    fields: fieldsOf(bundle, schema),
  }
}

function functionBehavior(
  bundle: StudioSchemaBundle,
  target: Extract<InspectorTarget, { kind: 'function' }>,
  terms: Terms,
): FunctionBehavior {
  const index = indexOf(bundle)
  const { link, callable: declared } = target
  const domain = bundle.ir?.domain
  const on =
    target.owner !== undefined
      ? [classLink(bundle, { origin: domain ?? '', kind: 'class', name: target.owner })]
      : nodePathsIn(declared.input).map((ref) => classLink(bundle, ref))
  const steps = (link?.definitions ?? []).flatMap((id) => {
    const definition = index.definitions.get(id)
    return definition === undefined ? [] : [definitionStep(bundle, definition, terms)]
  })
  const integrations = bundle.overlay.integrations
  const span =
    bundle.overlay.sourceSpans[
      target.owner === undefined
        ? `function.${target.key}`
        : `class.${target.owner}.method.${target.name}`
    ]
  const file = link?.handlerFile ?? link?.wiringFile ?? span?.file
  const line =
    link?.handlerFile !== undefined
      ? link.handlerLine
      : link?.wiringFile !== undefined
        ? link.wiringLine
        : span?.startLine
  const description = span?.doc ?? declared.description
  return {
    kind: 'function',
    key: target.key,
    handlers: readsHandlers(bundle),
    ...(link === undefined ? {} : { flavor: link.kind, implemented: link.implemented }),
    ...(link?.unlinked === true ? { unlinked: true } : {}),
    kernelCalls: link?.kernelCalls ?? [],
    static: target.static,
    abstract: target.abstract,
    on,
    ...(description === undefined ? {} : { description }),
    input: fieldsOf(bundle, declared.input),
    output: outputOf(bundle, declared),
    changes: steps.filter((step) => step.definition.kind === 'mutation'),
    preconditions: preconditionsOf(steps),
    reads: steps.filter((step) => step.definition.kind === 'query'),
    reaches: (link?.integrations ?? []).map((reached) => {
      const integration = integrations
        .filter((each) => reached.startsWith(`${each.key}.`))
        .sort((left, right) => right.key.length - left.key.length)[0]
      const key = integration?.key ?? reached.slice(0, reached.lastIndexOf('.'))
      const operation = reached.slice(key.length + 1)
      const replay = integration?.operations?.find((each) => each.name === operation)?.replay ?? []
      const label = replayLabel(replay)
      const meaning = replayMeaning(replay)
      return {
        target: integrationTarget(key),
        integration: key,
        operation,
        replay,
        ...(label === undefined ? {} : { label }),
        ...(meaning === undefined ? {} : { meaning }),
      }
    }),
    calls: (link?.calls ?? []).map((key) => callable(index, key)).sort(byKey),
    calledBy: (index.callers.get(target.key) ?? []).map((key) => callable(index, key)),
    untold: [...(link?.integrationGaps ?? []), ...steps.flatMap((step) => step.gaps)],
    ...(file === undefined ? {} : { source: { file, ...(line === undefined ? {} : { line }) } }),
  }
}

// ── a definition ──

function definitionStep(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  terms: Terms,
): DefinitionStep {
  return {
    definition: definitionRef(definition),
    ...(definition.name === undefined ? {} : { name: definition.name }),
    ...(definition.doc === undefined ? {} : { doc: definition.doc }),
    effects: (definition.effects ?? [])
      .filter(
        (effect): effect is SaidEffect =>
          effect.kind === 'read' || (definition.kind === 'mutation' && effect.kind !== 'expect'),
      )
      .map((effect) => {
        const deletion = deletionMeets(bundle, definition, effect)
        return { ...effectLine(bundle, effect, terms), ...(deletion ? { deletion } : {}) }
      }),
    preconditions:
      definition.kind === 'mutation'
        ? (definition.preconditions ?? []).map((stated) =>
            preconditionLine(bundle, definition, stated),
          )
        : [],
    gaps: definition.gaps ?? [],
  }
}

function preconditionLine(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  stated: DefinitionPrecondition,
): PreconditionLine {
  const domain = bundle.ir?.domain ?? ''
  return {
    kind: stated.kind,
    classes: stated.classes
      .map((key) => effectClass(domain, key))
      .filter((ref) => resolveClass(bundle, ref) !== undefined)
      .map((ref) => classLink(bundle, ref)),
    ...(stated.name === undefined ? {} : { name: stated.name }),
    terms: stated.terms,
    ...(stated.under === undefined || stated.under.length === 0 ? {} : { under: stated.under }),
    mutations: [definitionRef(definition)],
    file: stated.file,
    line: stated.line,
    ...(stated.gap === undefined ? {} : { gap: stated.gap }),
  }
}

/** A condition a precondition is stated under, as its words go around the source. */
export interface ConditionWords {
  readonly lead: string
  readonly source: string
  /** after the source: what of it the precondition waits on */
  readonly trail?: string
}

const CONDITION_LEADS: Record<PreconditionCondition['kind'], string> = {
  when: 'Only when',
  unless: 'Unless',
  each: 'Once for each of',
  caught: 'Only when',
}

/**
 * A condition in words: `Only when` `input.force`, `Unless` …, `Once for each of`
 * `input.previousTopics`, `Only when` `try { … }` `throws`.
 */
export const conditionWords = (condition: PreconditionCondition): ConditionWords => ({
  lead: CONDITION_LEADS[condition.kind],
  source: condition.source,
  ...(condition.kind === 'caught' ? { trail: 'throws' } : {}),
})

/**
 * The preconditions of several mutations, in the order they are met: one stated where several of
 * them reach it — a helper they share, the same line saying the same — is read once, with each.
 */
export function preconditionsOf(steps: readonly DefinitionStep[]): PreconditionLine[] {
  const found = new Map<string, PreconditionLine>()
  for (const step of steps)
    for (const line of step.preconditions) {
      const same = `${line.file}:${line.line}|${line.kind}|${JSON.stringify(line.terms)}`
      const known = found.get(same)
      found.set(
        same,
        known === undefined
          ? line
          : known.mutations.some((each) => each.id === step.definition.id)
            ? known
            : { ...known, mutations: [...known.mutations, ...line.mutations] },
      )
    }
  return [...found.values()]
}

function definitionBehavior(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  terms: Terms,
): DefinitionBehavior {
  const index = indexOf(bundle)
  return {
    kind: 'definition',
    ...definitionStep(bundle, definition, terms),
    names: definition.classes
      .map((name) => effectClass(bundle.ir?.domain ?? '', name))
      .filter((ref) => resolveClass(bundle, ref) !== undefined)
      .map((ref) => classLink(bundle, ref)),
    usedBy: (index.users.get(definition.id) ?? []).map((key) => callable(index, key)),
    source: { file: definition.file, line: definition.line },
  }
}

/** The order a deletion's links are read in: what stops it first, what goes with it last. */
const OUTCOMES: readonly DeletionOutcome[] = ['refused', 'untold', 'unlinked', 'detached']

/** The outcomes that stop a deletion, or may. */
const BLOCKING = ['refused', 'untold'] as const

/** The order the links a mutation unlinks itself are read in: those that would refuse it first. */
const LIFETIMES: readonly Lifetime[] = ['restrict', 'detach']

/**
 * What a mutation's deletion of a Node does to its links, by outcome, each relationship once:
 * none for any other effect, when the lifetimes are not read, or when the Node stands in none.
 * Those it unlinks itself part by lifetime, those that would refuse the deletion first.
 */
function deletionMeets(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  effect: DefinitionEffect,
  outcomes: readonly DeletionOutcome[] = OUTCOMES,
): DeletionMeets[] | undefined {
  const consequences = consequencesOf(bundle, definition, effect)
  if (consequences === undefined) return undefined
  const linksOf = (ends: readonly Consequence[]) =>
    [
      ...new Map(ends.map((each) => [classRefKey(each.relationship), each.relationship])).values(),
    ].map((ref) => classLink(bundle, ref))
  const meets = outcomes.flatMap((outcome): DeletionMeets[] => {
    const ends = consequences.filter((each) => each.outcome === outcome)
    if (outcome !== 'unlinked') {
      const relationships = linksOf(ends)
      return relationships.length === 0 ? [] : [{ outcome, relationships }]
    }
    // a relationship whose ends the Node may stand at both restricts when either does
    const restricting = new Set(
      ends
        .filter((each) => each.lifetime === 'restrict')
        .map((each) => classRefKey(each.relationship)),
    )
    return LIFETIMES.flatMap((lifetime): DeletionMeets[] => {
      const relationships = linksOf(
        ends.filter(
          (each) => restricting.has(classRefKey(each.relationship)) === (lifetime === 'restrict'),
        ),
      )
      return relationships.length === 0 ? [] : [{ outcome, lifetime, relationships }]
    })
  })
  return meets.length === 0 ? undefined : meets
}

/** `a Host`, `an Operation`: a Class with its article, the name opening it. */
function some(bundle: StudioSchemaBundle, terms: Terms, ref: IrClassRef): Phrase[] {
  const link = classLink(bundle, ref)
  return [
    `${articleOf(ref.name, terms.noun(classRefKey(ref))).toLowerCase()} `,
    { link, text: ref.name },
  ]
}

/** One effect in words: what the builder verb does to its Class. */
export function effectLine(
  bundle: StudioSchemaBundle,
  effect: SaidEffect,
  terms: Terms = NO_TERMS,
): EffectLine {
  const ref = effectClass(bundle.ir?.domain ?? '', effect.class)
  const cls = resolveClass(bundle, ref)
  const edge = cls?.type === 'edge' && cls.endpoints !== undefined && cls.endpoints.length >= 2
  const relationship = edge ? classLink(bundle, ref) : undefined
  /** An Edge's end: its Class when it accepts one, else its role (`a requester`). */
  const endOf = (endpoint: IrEndpoint): Phrase[] => {
    const accepted = acceptsOf(bundle, endpoint)
    if (accepted.length === 1) return some(bundle, terms, accepted[0]!)
    const role = endpoint.name.replaceAll('_', ' ')
    return [`${articleOf(role, undefined).toLowerCase()} ${role}`]
  }
  const the = (): Phrase[] =>
    edge
      ? [...endOf(cls.endpoints![0]!), ' to ', ...endOf(cls.endpoints![1]!)]
      : some(bundle, terms, ref)
  const words = ((): Phrase[] => {
    switch (effect.kind) {
      case 'create':
        return edge ? ['links ', ...the()] : ['creates ', ...the()]
      case 'delete':
        return edge ? ['unlinks ', ...the()] : ['deletes ', ...the()]
      case 'update':
        return edge ? ['updates the link of ', ...the()] : ['updates ', ...the()]
      case 'transition': {
        const move =
          effect.from !== undefined && effect.to !== undefined
            ? ` from ${effect.from} to ${effect.to}`
            : effect.to !== undefined
              ? ` to ${effect.to}`
              : ''
        const on =
          effect.event === undefined
            ? ', by an event the reading cannot tell'
            : ` on ${effect.event}`
        return ['moves ', ...some(bundle, terms, ref), `${move}${on}`]
      }
      case 'read':
        return effect.role === 'traverse' ? ['walks to ', ...the()] : ['starts at ', ...the()]
    }
  })()
  const verb = changeOf(effect.kind, edge)
  // a self relationship: both ends accept the one same Class, and only their roles tell them apart
  const endpoints = edge ? cls.endpoints!.slice(0, 2) : []
  const ends = endpoints.map((end) => acceptsOf(bundle, end))
  const self =
    ends.length === 2 &&
    ends.every((accepted) => accepted.length === 1) &&
    classRefKey(ends[0]![0]!) === classRefKey(ends[1]![0]!)
  return {
    kind: effect.kind,
    ...(verb ? { verb } : {}),
    words,
    ...(relationship === undefined ? {} : { relationship }),
    ...(self
      ? {
          selfRoles: [
            endpoints[0]!.name.replaceAll('_', ' '),
            endpoints[1]!.name.replaceAll('_', ' '),
          ] as const,
        }
      : {}),
    file: effect.file,
    line: effect.line,
  }
}

/** The change an effect makes, as its words say it: a link's create links, its delete unlinks. */
function changeOf(kind: SaidEffect['kind'], edge: boolean): ChangeVerb | undefined {
  if (kind === 'create') return edge ? 'link' : 'create'
  if (kind === 'delete') return edge ? 'unlink' : 'delete'
  if (kind === 'update' || kind === 'transition') return kind
  return undefined
}

// ── an Integration ──

function integrationBehavior(bundle: StudioSchemaBundle, key: string): IntegrationBehavior {
  const index = indexOf(bundle)
  const integration = bundle.overlay.integrations.find((each) => each.key === key)!
  const users = reachUsers(bundle.overlay.handlerLinks, (link) => link.integrations)
  const prefix = `${key}.`
  const names =
    integration.operations?.map((operation) => operation.name) ??
    [...users.keys()]
      .filter((each) => each.startsWith(prefix))
      .map((each) => each.slice(prefix.length))
      .sort()
  return {
    kind: 'integration',
    key,
    ...(integration.id === undefined ? {} : { id: integration.id }),
    ...(integration.doc === undefined ? {} : { doc: integration.doc }),
    ...(integration.name === undefined ? {} : { binding: integration.name }),
    declared: integration.operations !== undefined,
    operations: names.map((name) => {
      const replay = integration.operations?.find((each) => each.name === name)?.replay ?? []
      const label = replayLabel(replay)
      const meaning = replayMeaning(replay)
      return {
        name,
        replay,
        ...(label === undefined ? {} : { label }),
        ...(meaning === undefined ? {} : { meaning }),
        users: (users.get(`${prefix}${name}`) ?? []).map((each) => callable(index, each)),
      }
    }),
    untold: bundle.overlay.handlerLinks
      .filter((link) => (link.integrationGaps?.length ?? 0) > 0)
      .map((link) => callable(index, callableKeyOf(link)))
      .sort(byKey),
    ...(integration.file === undefined
      ? {}
      : {
          source: {
            file: integration.file,
            ...(integration.line === undefined ? {} : { line: integration.line }),
          },
        }),
  }
}

// ── counts the other lenses offer ──

/** How many functions change a Class: what the switch to Behavior counts. */
export function changersOf(behavior: ClassBehavior): number {
  return new Set(behavior.groups.flatMap((group) => group.by.map((by) => by.fn.key))).size
}

/** How many other functions may change the Class: their mutations name it only through a base or a shared end. */
export function mayChangersOf(behavior: ClassBehavior): number {
  const sure = new Set(behavior.groups.flatMap((group) => group.by.map((by) => by.fn.key)))
  return new Set(
    behavior.groups
      .flatMap((group) => group.may.map((by) => by.fn.key))
      .filter((key) => !sure.has(key)),
  ).size
}
