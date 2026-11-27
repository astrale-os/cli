/**
 * Behavior lens: what happens. Three bands read left to right — the outside world, the
 * functions, the graph — and no line crosses one: Integrations stand left, functions
 * (Methods and Domain functions) in the middle as rows of their module, and the Classes they
 * change right. Relationships are not drawn as nodes: every Edge write is drawn as `links` or
 * `unlinks` on each end Class the same mutation does not itself create or delete, the line
 * naming the relationship; the end it does create or delete carries the Edge in that write.
 *
 * - Every card carries its answer: a Class counts the functions behind each verb, an
 *   Integration the functions and operations that reach it, a module its functions; a
 *   function's row wears a dot per verb and a plug when it reaches outside.
 * - At rest a function links straight to what it changes, one link per verb, its mutations
 *   folded into the link; the canvas carries them as one ribbon per module and target. A
 *   focus on a function or a mutation, or the `mutations` option, draws the mutations
 *   between, in a column of their own.
 * - A function links once to each Integration it reaches, naming the operations it calls; the
 *   link warns when another attempt may repeat one of them.
 * - A target most functions reach is a hub: its links are ambient, and its card says so.
 * - A call between functions is a mark on the caller, drawn while lit.
 * - What the source reading cannot follow is said on the node ("can't tell"), never left out.
 * - A mutation the Domain declares and no function's handler reaches is listed and, with the
 *   mutations drawn, stands in their column saying so: nothing leads to it.
 * - A Publication's bundle holds no handler sources: each function links instead to what its
 *   declaration names — the Class a Method works on, the Classes its input and its output
 *   name — and no row says it cannot tell what nothing reads (the level says so once).
 *
 * Read from the source overlay — handler links, each definition's effects, Integration
 * declarations — and the Schema for what an Edge's ends accept and what a signature names.
 *
 * Options:
 * - `mutations` draws every mutation between the functions that use it and what it changes.
 * - `reads` also draws what each function reads, dashed.
 * - `calls` draws every call between functions.
 */

import type {
  DefinitionEffect,
  DefinitionLink,
  HandlerLink,
  IntegrationLink,
  IrCallable,
  IrClass,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import { callableOutputSchema, nodePathsIn } from '@shared/contracts/schema'
import { publicationOf } from '@shared/contracts/versions'
import { classRefKey, type IrClassRef } from '@shared/schema/identity'

import type {
  LensOption,
  LensOptions,
  Scene,
  SceneBadge,
  SceneEntry,
  SceneFold,
  SceneGroup,
  SceneLink,
  SceneNode,
  SceneRow,
  SceneSign,
  SceneTally,
  VerbTone,
} from '../scene/types'

import { callableKeyOf, effectClass } from '../../schema-studio/definitions'
import { isKernelClass, resolveClass } from '../../schema-studio/inheritance'
import { integrationTarget, replayLabel } from '../../schema-studio/integrations'
import { moduleHues, moduleLabel, moduleOfMember } from '../../schema-studio/modules'
import { listed } from '../scene/types'
import { consequencesOf } from './deletion'
import { classTarget, endpointRefs, lineage, originShort } from './structure'

export const BEHAVIOR_OPTIONS: LensOption[] = [
  {
    id: 'mutations',
    label: 'Mutations',
    description:
      'Draw every mutation between the functions that use it and what it changes; off, only the selected function’s',
    default: false,
    icon: 'mutations',
  },
  {
    id: 'reads',
    label: 'Reads',
    description: 'Also draw the Classes each function reads, dashed',
    default: false,
    icon: 'reads',
  },
  {
    id: 'calls',
    label: 'Calls',
    description: 'Draw every call between functions; off, only the selected function’s',
    default: false,
    icon: 'calls',
  },
]

/** The columns the flow reads in, left to right: outside, functions, mutations, the graph. */
const COLUMN = { integrations: 0, functions: 1, mutations: 2, changed: 3 } as const

/** The bands' headings: what each one holds. */
const BANDS = [
  { column: COLUMN.integrations, label: 'Outside world' },
  { column: COLUMN.functions, label: 'Functions' },
  { column: COLUMN.changed, label: 'Graph' },
]

/** A target reached by this share of the functions, and by at least `HUB_LEAST`, is a hub. */
export const HUB_SHARE = 0.5
export const HUB_LEAST = 16

const SCHEMA_DIR = 'schema'

export type ChangeVerb = 'create' | 'update' | 'delete' | 'transition' | 'link' | 'unlink'

/** What a link says, as its label reads. */
export const VERB_WORDS: Record<ChangeVerb, string> = {
  create: 'creates',
  update: 'updates',
  delete: 'deletes',
  transition: 'moves state',
  link: 'links',
  unlink: 'unlinks',
}

/** What a Class's tally says each verb did to it, before `by N`. */
const VERB_PASSIVE: Record<ChangeVerb, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  transition: 'state moved',
  link: 'linked',
  unlink: 'unlinked',
}

const VERB_ORDER: readonly ChangeVerb[] = [
  'create',
  'update',
  'transition',
  'link',
  'unlink',
  'delete',
]

/** What one mutation does to one end: a Class, or every Class a union end accepts. */
export interface Change {
  verb: ChangeVerb
  /**
   * The Kernel does it, not the mutation: a link that goes with a Node the mutation deletes
   * (`detach`), unlinked from the Classes at its other end.
   */
  consequence?: true
  /** the Class nodes it lands on, by selection id, sorted */
  nodes: string[]
  /** the relationships written there, by selection id: linked, unlinked, or created or deleted with the Node */
  relationships: string[]
  /** a transition's states, `from → to` or `→ to`, where the reading tells them */
  moves: string[]
}

export interface MutationModel {
  /** `mutation.<id>` */
  id: string
  definition: DefinitionLink
  label: string
  changes: Change[]
  /** what its deletions do besides, as the Kernel's lifetimes say: the links that go with them */
  consequences: Change[]
  /** where the reading cannot tell what it does */
  gaps: string[]
}

export interface FunctionModel {
  /** `function.<Class>.<method>` or `function.<name>` */
  id: string
  /** `Class.method` or the function's name, as handlers key it */
  key: string
  label: string
  /** the Class a Method is declared on */
  owner?: string
  module: string
  link?: HandlerLink
  abstract: boolean
  /** the mutations its handler reaches, by selection id, in the handler's order */
  mutations: string[]
  /** the Class nodes it reads, by selection id */
  reads: string[]
  /** the Integration operations it reaches, `key.operation` */
  calls: string[]
  /** the functions it calls, by selection id */
  callees: string[]
  /** where the reading cannot tell what it does */
  gaps: string[]
  /**
   * the Class nodes its declaration names, by selection id: read only from a bundle with no
   * handler sources, where it is all that says what the function reaches
   */
  names?: Signature
}

/** What a function's declaration names, by selection id: true whatever its handler does. */
export interface Signature {
  /** the Class a Method is declared on */
  on?: string
  /** the Classes its input points at */
  input: string[]
  /** the Classes its output points at */
  output: string[]
}

export interface BehaviorModel {
  domain: string
  /** whether the bundle holds the handler sources what a function does is read from */
  handlers: boolean
  functions: FunctionModel[]
  /** every mutation the Domain declares or a function reaches */
  mutations: ReadonlyMap<string, MutationModel>
  /**
   * the declared mutations no function's handler reaches, by selection id, by name; none
   * when the bundle holds no handler sources, where what uses a mutation cannot be told
   */
  unused: readonly string[]
  /** every Class a change, a read or a signature lands on, and every relationship written, by selection id */
  classes: ReadonlyMap<string, IrClassRef>
  /** every Integration declared or reached, by key; absent when only reached */
  integrations: ReadonlyMap<string, IntegrationLink | undefined>
}

const WRITES: ReadonlySet<DefinitionEffect['kind']> = new Set([
  'create',
  'update',
  'delete',
  'transition',
])

/** A relationship as a mark names it: bare at home, with its Domain elsewhere. */
function relationshipName(ref: IrClassRef, domain: string): string {
  return ref.origin === domain ? ref.name : `${originShort(ref.origin)}.${ref.name}`
}

function moveOf(effect: DefinitionEffect): string | undefined {
  if (effect.to === undefined) return undefined
  return effect.from === undefined ? `→ ${effect.to}` : `${effect.from} → ${effect.to}`
}

/** One end of an Edge a mutation writes. */
export interface EdgeEnd {
  /** the Classes the end accepts */
  readonly accepts: readonly IrClassRef[]
  /** the Node write of the same mutation that creates (deletes) the Node at this end with the Edge */
  readonly carrier?: DefinitionEffect
}

/**
 * The ends of the Edge `effect` writes, in endpoint order, or nothing when it writes no Edge. An
 * end the same mutation creates (deletes) a Node of — a Class the end accepts, or one extending
 * it — is carried by that Node write, which carries one end of each Edge at most: a self
 * relationship written with one Node of its Class so carries one end, not both. Every other end
 * is linked (unlinked; updated, for an Edge update) as every Class it accepts.
 */
export function edgeEndsOf(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  effect: DefinitionEffect,
): EdgeEnd[] | undefined {
  const domain = bundle.ir!.domain
  const member = resolveClass(bundle, effectClass(domain, effect.class))
  if (member?.type !== 'edge') return undefined
  const writes =
    effect.kind === 'create' || effect.kind === 'delete'
      ? (definition.effects ?? []).flatMap((other) => {
          if (other.kind !== effect.kind) return []
          const ref = effectClass(domain, other.class)
          return resolveClass(bundle, ref)?.type === 'node'
            ? [{ effect: other, lineage: lineage(bundle, ref) }]
            : []
        })
      : []
  const carried = new Set<DefinitionEffect>()
  return (member.endpoints ?? []).flatMap((endpoint): EdgeEnd[] => {
    const accepts = endpointRefs(endpoint, member.origin)
    if (accepts.length === 0) return []
    const carrier = writes.find(
      (write) =>
        !carried.has(write.effect) &&
        accepts.some((accepted) => write.lineage.has(classRefKey(accepted))),
    )?.effect
    if (carrier) carried.add(carrier)
    return [{ accepts, ...(carrier ? { carrier } : {}) }]
  })
}

/** What an Edge write does to an end it does not carry: links, unlinks, else updates. */
export function edgeVerb(effect: DefinitionEffect): 'link' | 'unlink' | 'update' {
  return effect.kind === 'create' ? 'link' : effect.kind === 'delete' ? 'unlink' : 'update'
}

/**
 * What a mutation changes, from its effects. A Node write lands on its Class. Every Edge write
 * lands on each of its ends (`edgeEndsOf`): an end a Node write of the mutation carries is part of
 * that write; every other is linked, unlinked or updated, the relationship named.
 */
function changesOf(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  classes: Map<string, IrClassRef>,
): { changes: Change[]; consequences: Change[]; gaps: string[] } {
  const domain = bundle.ir!.domain
  const gaps = (definition.gaps ?? []).map((gap) => gap.reason)
  const writes = (definition.effects ?? []).flatMap((effect) => {
    if (!WRITES.has(effect.kind)) return []
    const ref = effectClass(domain, effect.class)
    const member = resolveClass(bundle, ref)
    if (!member) {
      gaps.push(`the schema does not resolve ${effect.class}`)
      return []
    }
    return [{ effect, ref, member }]
  })

  const changes = new Map<string, Change>()
  const land = (verb: ChangeVerb, refs: readonly IrClassRef[]): Change => {
    const nodes = [...new Set(refs.map((ref) => classTarget(ref, domain)))].sort()
    for (const ref of refs) classes.set(classTarget(ref, domain), ref)
    const key = `${verb}|${nodes.join(',')}`
    const found = changes.get(key)
    if (found) return found
    const change: Change = { verb, nodes, relationships: [], moves: [] }
    changes.set(key, change)
    return change
  }
  const nodeWrites = new Map<DefinitionEffect, Change>()
  for (const { effect, ref, member } of writes) {
    if (member.type !== 'node') continue
    const change = land(effect.kind as ChangeVerb, [ref])
    const move = effect.kind === 'transition' ? moveOf(effect) : undefined
    if (move && !change.moves.includes(move)) change.moves.push(move)
    nodeWrites.set(effect, change)
  }
  for (const { effect, ref, member } of writes) {
    if (member.type !== 'edge') continue
    const relationship = classTarget(ref, domain)
    classes.set(relationship, ref)
    for (const end of edgeEndsOf(bundle, definition, effect) ?? []) {
      const change =
        (end.carrier && nodeWrites.get(end.carrier)) || land(edgeVerb(effect), end.accepts)
      if (!change.relationships.includes(relationship)) change.relationships.push(relationship)
    }
  }
  // The links that go with each Node it deletes, unlinked from the Classes at their other end.
  const consequences = new Map<string, Change>()
  for (const { effect, member } of writes) {
    if (member.type !== 'node' || effect.kind !== 'delete') continue
    for (const end of consequencesOf(bundle, definition, effect) ?? []) {
      if (end.outcome !== 'detached') continue
      const nodes = [...new Set(end.others.map((ref) => classTarget(ref, domain)))].sort()
      for (const ref of end.others) classes.set(classTarget(ref, domain), ref)
      const relationship = classTarget(end.relationship, domain)
      classes.set(relationship, end.relationship)
      const key = nodes.join(',')
      const change = consequences.get(key) ?? {
        verb: 'unlink' as const,
        consequence: true as const,
        nodes,
        relationships: [],
        moves: [],
      }
      if (!change.relationships.includes(relationship)) change.relationships.push(relationship)
      consequences.set(key, change)
    }
  }
  const ordered = (list: Iterable<Change>) =>
    [...list].sort(
      (left, right) =>
        VERB_ORDER.indexOf(left.verb) - VERB_ORDER.indexOf(right.verb) ||
        left.nodes.join(',').localeCompare(right.nodes.join(',')),
    )
  return { changes: ordered(changes.values()), consequences: ordered(consequences.values()), gaps }
}

/** A mutation that states preconditions, marked with their count: read from source, not checked. */
function preconditionSigns(mutation: MutationModel): SceneSign[] {
  const stated = mutation.definition.preconditions?.length ?? 0
  if (stated === 0) return []
  return [
    {
      shape: 'glyph',
      glyph: 'precondition',
      text: String(stated),
      tone: 'what',
      title: `${stated} ${stated === 1 ? 'precondition' : 'preconditions'}, read from source, not checked`,
    },
  ]
}

/**
 * Whether a bundle holds the handler sources what its functions read, write and call is read
 * from. A Publication's holds its Schema only: nothing of what its functions do is read.
 */
export function readsHandlers(bundle: StudioSchemaBundle): boolean {
  return publicationOf(bundle.domainId) === undefined
}

const models = new WeakMap<StudioSchemaBundle, BehaviorModel>()

/** What every function of the Domain does, read once per bundle. */
export function behaviorModel(bundle: StudioSchemaBundle): BehaviorModel {
  const cached = models.get(bundle)
  if (cached) return cached
  const ir = bundle.ir!
  const domain = ir.domain
  const overlay = bundle.overlay
  const definitions = new Map(overlay.definitions.map((definition) => [definition.id, definition]))
  const classes = new Map<string, IrClassRef>()
  const mutations = new Map<string, MutationModel>()
  const mutationOf = (definition: DefinitionLink): MutationModel => {
    const id = `mutation.${definition.id}`
    const found = mutations.get(id)
    if (found) return found
    const model = {
      id,
      definition,
      label: definition.name ?? definition.id,
      ...changesOf(bundle, definition, classes),
    }
    mutations.set(id, model)
    return model
  }

  const sourced = readsHandlers(bundle)
  const handlers = new Map(overlay.handlerLinks.map((link) => [callableKeyOf(link), link]))
  const callables: {
    key: string
    owner?: string
    name: string
    member?: IrClass
    declared: IrCallable
    abstract: boolean
  }[] = [
    ...Object.entries(ir.classes).flatMap(([owner, member]) =>
      Object.entries(member.methods).map(([name, method]) => ({
        key: `${owner}.${name}`,
        owner,
        name,
        member,
        declared: method,
        abstract: method.abstract,
      })),
    ),
    ...Object.entries(ir.functions).map(([name, fn]) => ({
      key: name,
      name,
      declared: fn,
      abstract: false,
    })),
  ]
  // The Class nodes a signature names, by selection id, each kept for its card.
  const nodesOf = (refs: readonly IrClassRef[]) =>
    refs.flatMap((ref) => {
      if (resolveClass(bundle, ref)?.type !== 'node') return []
      const target = classTarget(ref, domain)
      classes.set(target, ref)
      return [target]
    })

  const functions = callables.map((callable): FunctionModel => {
    const { key, owner, name, member, declared, abstract } = callable
    const link = handlers.get(key)
    const gaps: string[] = []
    if (!link && !abstract && sourced) gaps.push('no handler was found for it')
    if (link?.unlinked) gaps.push('its handler file could not be followed')
    for (const gap of link?.integrationGaps ?? []) gaps.push(gap.reason)
    const used: string[] = []
    const reads = new Set<string>()
    for (const id of link?.definitions ?? []) {
      const definition = definitions.get(id)
      if (!definition) {
        gaps.push(`it reaches ${id}, which the reading cannot find`)
        continue
      }
      for (const effect of definition.effects ?? []) {
        if (effect.kind !== 'read' && effect.kind !== 'expect') continue
        const ref = effectClass(domain, effect.class)
        if (resolveClass(bundle, ref)?.type !== 'node') continue
        const target = classTarget(ref, domain)
        reads.add(target)
        classes.set(target, ref)
      }
      if (definition.kind !== 'mutation') continue
      const mutation = mutationOf(definition)
      used.push(mutation.id)
      for (const gap of mutation.gaps) gaps.push(`${mutation.label}: ${gap}`)
    }
    return {
      id: `function.${key}`,
      key,
      label: name,
      ...(owner ? { owner } : {}),
      module: owner
        ? moduleOfMember(bundle, member?.type === 'edge' ? 'edge' : 'class', owner, SCHEMA_DIR)
        : moduleOfMember(bundle, 'function', name, SCHEMA_DIR),
      ...(link ? { link } : {}),
      abstract,
      mutations: used,
      reads: [...reads].sort(),
      calls: [...new Set(link?.integrations ?? [])].sort(),
      callees: [...new Set(link?.calls ?? [])].sort().map((callee) => `function.${callee}`),
      gaps,
      ...(sourced
        ? {}
        : {
            names: {
              ...(member?.type === 'node' ? { on: nodesOf([member.ref])[0] } : {}),
              input: nodesOf(nodePathsIn(declared.input)),
              output: nodesOf(nodePathsIn(callableOutputSchema(declared))),
            },
          }),
    }
  })
  functions.sort(
    (left, right) => left.module.localeCompare(right.module) || left.key.localeCompare(right.key),
  )

  const integrations = new Map<string, IntegrationLink | undefined>(
    overlay.integrations.map((integration) => [integration.key, integration]),
  )
  for (const fn of functions) {
    for (const call of fn.calls) {
      const key = call.slice(0, call.lastIndexOf('.'))
      if (!integrations.has(key)) integrations.set(key, undefined)
    }
  }

  // A mutation no handler reaches is still the Domain's: it is read like the others.
  const reached = new Set(functions.flatMap((fn) => fn.mutations))
  const unused = sourced
    ? overlay.definitions
        .filter((definition) => definition.kind === 'mutation')
        .map(mutationOf)
        .filter((mutation) => !reached.has(mutation.id))
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((mutation) => mutation.id)
    : []

  const model = { domain, handlers: sourced, functions, mutations, unused, classes, integrations }
  models.set(bundle, model)
  return model
}

/** Every Class node a function's declaration names, by selection id, each once. */
export function namedBy({ names }: FunctionModel): string[] {
  if (names === undefined) return []
  const { on, input, output } = names
  return [...new Set([...(on === undefined ? [] : [on]), ...input, ...output])]
}

/** What a function's declaration says of `node`: `works on`, `input`, `output`, as they apply. */
function signatureWords({ names }: FunctionModel, node: string): string {
  if (names === undefined) return ''
  return [
    ...(names.on === node ? ['works on'] : []),
    ...(names.input.includes(node) ? ['input'] : []),
    ...(names.output.includes(node) ? ['output'] : []),
  ].join(' · ')
}

/** Every Class node a function changes, through any of its mutations, by selection id. */
export function changedBy(model: BehaviorModel, fn: FunctionModel): string[] {
  return [
    ...new Set(
      fn.mutations.flatMap(
        (id) => model.mutations.get(id)?.changes.flatMap((change) => change.nodes) ?? [],
      ),
    ),
  ].sort()
}

/**
 * The focus that changes what the lens draws, from what is selected: a function that uses a
 * mutation, or a mutation. With every mutation drawn, none does.
 */
export function behaviorFocus(
  bundle: StudioSchemaBundle,
  options: LensOptions,
  selected: string | undefined,
): string | undefined {
  if (!selected || options.mutations === true || !bundle.ir) return undefined
  const model = behaviorModel(bundle)
  if (selected.startsWith('function.'))
    return model.functions.find((fn) => fn.id === selected)?.mutations.length ? selected : undefined
  if (selected.startsWith('mutation.')) return model.mutations.has(selected) ? selected : undefined
  return undefined
}

const operationOf = (call: string) => {
  const dot = call.lastIndexOf('.')
  return { key: call.slice(0, dot), name: call.slice(dot + 1) }
}

/** A Class as a mark names it: bare at home, with its Domain elsewhere. */
const className = (model: BehaviorModel, id: string) => {
  const ref = model.classes.get(id)
  return ref ? relationshipName(ref, model.domain) : id
}

const functionsWord = (count: number) => `${count} ${count === 1 ? 'function' : 'functions'}`

function functionBadges(fn: FunctionModel): SceneBadge[] {
  const badges: SceneBadge[] = []
  if (fn.link?.kind === 'workflow') badges.push({ label: 'workflow', tone: 'fn' })
  if (fn.abstract) badges.push({ label: 'abstract' })
  if (fn.link && !fn.link.implemented) badges.push({ label: 'not implemented' })
  if (fn.gaps.length > 0)
    badges.push({ label: 'can’t tell', tone: 'warning', title: fn.gaps.join('\n') })
  return badges
}

/** Each verb a function's mutations do, in verb order, to the Class nodes it lands on. */
function verbsOf(model: BehaviorModel, fn: FunctionModel): Map<ChangeVerb, Set<string>> {
  const verbs = new Map<ChangeVerb, Set<string>>()
  for (const id of fn.mutations)
    for (const change of model.mutations.get(id)?.changes ?? [])
      for (const node of change.nodes)
        verbs.set(change.verb, (verbs.get(change.verb) ?? new Set()).add(node))
  return new Map(
    VERB_ORDER.filter((verb) => verbs.has(verb)).map((verb) => [verb, verbs.get(verb)!]),
  )
}

/** The Integration operations a function calls another attempt may repeat. */
function unsafeOf(model: BehaviorModel, calls: readonly string[]): string[] {
  return calls.filter((call) => {
    const { key, name } = operationOf(call)
    return model.integrations
      .get(key)
      ?.operations?.find((operation) => operation.name === name)
      ?.replay?.includes('unsafe')
  })
}

/**
 * The marks a function's row wears: a dot per verb, a plug when it reaches an Integration,
 * the functions it calls, and "can't tell" where the reading cannot follow it.
 */
function functionSigns(
  model: BehaviorModel,
  fn: FunctionModel,
  callees: readonly string[],
): SceneSign[] {
  const signs: SceneSign[] = [...verbsOf(model, fn)].map(([verb, nodes]) => ({
    shape: 'dot',
    tone: verb as VerbTone,
    title: `${VERB_WORDS[verb]} ${listed([...nodes].map((node) => className(model, node)))}`,
  }))
  if (fn.calls.length > 0) {
    const unsafe = unsafeOf(model, fn.calls)
    signs.push({
      shape: 'glyph',
      glyph: 'integration',
      tone: unsafe.length > 0 ? 'warning' : 'call',
      title: [
        `reaches ${listed(fn.calls)}`,
        ...(unsafe.length > 0 ? [`another attempt may repeat ${unsafe.join(', ')}`] : []),
      ].join('; '),
    })
  }
  if (callees.length > 0) {
    signs.push({
      shape: 'text',
      text: `calls ${callees.length}`,
      tone: 'call',
      title: `calls ${listed(callees.map((callee) => callee.slice('function.'.length)))}`,
    })
  }
  if (fn.gaps.length > 0)
    signs.push({
      shape: 'text',
      text: '?',
      tone: 'warning',
      title: `can’t tell: ${fn.gaps.join('; ')}`,
    })
  return signs
}

/**
 * What a change link reads under its verb: the states it moves between, and the relationship
 * it writes when the write is the Edge's own (links, unlinks). The Edges a Node is created or
 * deleted with, and a move whose states the reading cannot tell, are read in the Inspector:
 * a link reads one label.
 */
function changeMarks(model: BehaviorModel, change: Change): string[] {
  const own = change.verb !== 'create' && change.verb !== 'delete'
  return [
    ...change.moves,
    ...(own
      ? change.relationships.map((id) => relationshipName(model.classes.get(id)!, model.domain))
      : []),
  ]
}

/**
 * A change as a link from `from`, one per verb and end. A consequence — a link that goes with a
 * Node deleted — is a link of its own, dashed: the Kernel does it, not the mutation.
 */
function changeLink(
  from: string,
  { verb, nodes, consequence }: Pick<Change, 'verb' | 'nodes' | 'consequence'>,
  marks: readonly string[],
  opens: string,
  hubs: ReadonlySet<string>,
): SceneLink {
  return {
    id: `change:${from}:${consequence ? 'with-' : ''}${verb}:${nodes.join(',')}`,
    opens,
    kind: 'change',
    // the Kernel's word for a link that goes with a deleted Node
    label: consequence ? 'detaches' : VERB_WORDS[verb],
    from: { nodes: [from] },
    to: { nodes: [...nodes] },
    directed: true,
    tone: verb as VerbTone,
    ...(consequence ? { dashed: true } : {}),
    ...(marks.length > 0 ? { marks: [...marks] } : {}),
    ...(nodes.every((node) => hubs.has(node)) ? { ambient: true } : {}),
  }
}

/** What a hub's card says of it. */
const hubBadge = (reached: number, of: number, verb: string): SceneBadge => ({
  label: 'most functions',
  tone: 'muted',
  title: `${reached} of ${of} functions ${verb} it: its lines stay faint until one is lit`,
})

/** The Behavior Index's groups beside the modules. */
const INTEGRATIONS_GROUP = 'index.integrations'
const MUTATIONS_GROUP = 'index.mutations'

/** What a mutation no function's handler reaches says of itself. */
const UNUSED = 'no function uses it'

/**
 * What the Behavior Index lists: the functions by module and the Integrations they reach, as
 * the canvas draws them, and every mutation a function uses, behind its kind chip — selected,
 * one is drawn between its functions and what it changes, as the `mutations` option draws it.
 * Classes are not listed: what a function changes is read from it.
 */
function behaviorIndex(
  model: BehaviorModel,
  nodes: readonly SceneNode[],
  groups: readonly SceneGroup[],
): NonNullable<Scene['index']> {
  const entry = (node: SceneNode, group: string | undefined): SceneEntry => ({
    id: node.id,
    ...(node.anchor ? { anchor: node.anchor } : {}),
    kind: node.kind,
    label: node.label,
    ...(node.sublabel ? { sublabel: node.sublabel } : {}),
    ...(group ? { group } : {}),
    ...(node.tone ? { tone: node.tone } : {}),
    ...(node.icon ? { icon: node.icon } : {}),
    ...(node.keywords ? { keywords: node.keywords } : {}),
  })
  const users = new Map<string, string[]>()
  for (const fn of model.functions)
    for (const id of fn.mutations) users.set(id, [...(users.get(id) ?? []), fn.key])
  const mutations = [...model.mutations.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  )
  return {
    groups: [
      ...groups,
      { id: INTEGRATIONS_GROUP, label: 'Integrations' },
      { id: MUTATIONS_GROUP, label: 'Mutations' },
    ],
    entries: [
      ...nodes.filter((node) => node.kind === 'function').map((node) => entry(node, node.group)),
      ...nodes
        .filter((node) => node.kind === 'integration')
        .map((node) => entry(node, INTEGRATIONS_GROUP)),
      ...mutations.map((mutation) => {
        const verbs = [...new Set(mutation.changes.map((change) => VERB_WORDS[change.verb]))]
        return {
          id: mutation.id,
          kind: 'mutation',
          label: mutation.label,
          ...(users.has(mutation.id)
            ? verbs.length > 0
              ? { sublabel: verbs.join(' · ') }
              : {}
            : { sublabel: UNUSED }),
          group: MUTATIONS_GROUP,
          tone: 'fn' as const,
          icon: { glyph: 'mutation' as const },
          keywords: [mutation.definition.id, ...(users.get(mutation.id) ?? [])],
        }
      }),
    ],
    hiddenKinds: ['mutation'],
  }
}

export function projectBehavior(
  bundle: StudioSchemaBundle,
  options: LensOptions,
  focus?: string,
): Scene {
  if (!bundle.ir) {
    return {
      key: `behavior:${bundle.domainId}:empty`,
      nodes: [],
      links: [],
      groups: [],
      folded: [],
    }
  }
  const model = behaviorModel(bundle)
  const { domain, functions, mutations } = model
  const showAll = options.mutations === true
  const showReads = options.reads === true
  const showCalls = options.calls === true
  const hues = moduleHues(bundle, SCHEMA_DIR)

  // The mutations drawn, by the function that uses each: every one, or around the focus.
  const through = (fn: FunctionModel, mutation: string) =>
    showAll || focus === fn.id || focus === mutation

  // A hub is what most functions reach, at rest, through anything.
  const reach = new Map<string, Set<string>>()
  const reached = (target: string, fn: string) =>
    reach.set(target, (reach.get(target) ?? new Set()).add(fn))
  // Without handler sources, what a function reaches is what its declaration names.
  for (const fn of functions) {
    for (const node of model.handlers ? changedBy(model, fn) : namedBy(fn)) reached(node, fn.id)
    for (const call of fn.calls) reached(integrationTarget(operationOf(call).key), fn.id)
  }
  const hubs = new Set(
    [...reach]
      .filter(([, by]) => by.size >= HUB_LEAST && by.size >= functions.length * HUB_SHARE)
      .map(([target]) => target),
  )

  const links: SceneLink[] = []
  const drawnMutations = new Set<string>()
  const targets = new Set<string>()
  const integrationsReached = new Set<string>()
  const functionIds = new Set(functions.map((fn) => fn.id))

  for (const fn of functions) {
    // What its folded mutations change, one link per verb and end.
    const folded = new Map<
      string,
      {
        verb: ChangeVerb
        consequence: boolean
        nodes: string[]
        marks: Set<string>
        by: Set<string>
      }
    >()
    for (const id of fn.mutations) {
      const mutation = mutations.get(id)!
      if (through(fn, id)) {
        drawnMutations.add(id)
        links.push({
          id: `uses:${fn.id}:${id}`,
          opens: id,
          kind: 'uses',
          label: '',
          from: { nodes: [fn.id] },
          to: { nodes: [id] },
          directed: true,
          tone: 'fn',
        })
        continue
      }
      for (const change of [...mutation.changes, ...mutation.consequences]) {
        const key = `${change.consequence ? '~' : ''}${change.verb}|${change.nodes.join(',')}`
        const entry = folded.get(key) ?? {
          verb: change.verb,
          consequence: change.consequence === true,
          nodes: change.nodes,
          marks: new Set<string>(),
          by: new Set<string>(),
        }
        for (const mark of changeMarks(model, change)) entry.marks.add(mark)
        entry.by.add(id)
        folded.set(key, entry)
      }
    }
    for (const { verb, consequence, nodes, marks, by } of folded.values()) {
      for (const node of nodes) targets.add(node)
      links.push(
        changeLink(
          fn.id,
          { verb, nodes, ...(consequence ? { consequence: true } : {}) },
          [...marks],
          by.size === 1 ? [...by][0]! : fn.id,
          hubs,
        ),
      )
    }

    // One link per Integration, naming the operations called on it.
    const called = new Map<string, string[]>()
    for (const call of fn.calls) {
      const { key, name } = operationOf(call)
      called.set(key, [...(called.get(key) ?? []), name])
    }
    for (const [key, names] of called) {
      const target = integrationTarget(key)
      integrationsReached.add(key)
      const unsafe = unsafeOf(
        model,
        names.map((name) => `${key}.${name}`),
      ).map((call) => operationOf(call).name)
      links.push({
        id: `call:${fn.id}:${key}`,
        opens: target,
        kind: 'call',
        label: listed(names),
        from: { nodes: [fn.id] },
        to: { nodes: [target] },
        directed: true,
        tone: unsafe.length > 0 ? 'warning' : 'call',
        ...(unsafe.length > 0
          ? { marks: [`another attempt may repeat ${unsafe.join(', ')}`] }
          : {}),
        ...(hubs.has(target) ? { ambient: true } : {}),
      })
    }

    // A call between two functions is a mark on the caller's row, drawn while lit.
    for (const callee of fn.callees) {
      if (!functionIds.has(callee)) continue
      links.push({
        id: `calls:${fn.id}:${callee}`,
        opens: callee,
        kind: 'call',
        label: 'calls',
        from: { nodes: [fn.id] },
        to: { nodes: [callee] },
        directed: true,
        tone: 'call',
        ...(showCalls ? {} : { latent: true }),
      })
    }

    // A bundle with no handler sources says what each declaration names, and nothing else.
    if (!model.handlers) {
      for (const node of namedBy(fn)) {
        targets.add(node)
        links.push({
          id: `names:${fn.id}:${node}`,
          opens: fn.id,
          kind: 'names',
          label: signatureWords(fn, node),
          from: { nodes: [fn.id] },
          to: { nodes: [node] },
          directed: true,
          tone: 'muted',
          ...(hubs.has(node) ? { ambient: true } : {}),
        })
      }
    }

    if (showReads) {
      for (const node of fn.reads) {
        targets.add(node)
        links.push({
          id: `read:${fn.id}:${node}`,
          opens: fn.id,
          kind: 'read',
          label: 'reads',
          from: { nodes: [fn.id] },
          to: { nodes: [node] },
          directed: true,
          tone: 'muted',
          dashed: true,
        })
      }
    }
  }

  // One no function uses is drawn with the others, or when it is the focus: nothing leads to it.
  for (const id of model.unused) if (showAll || focus === id) drawnMutations.add(id)
  const unused = new Set(model.unused)

  // Each drawn mutation links to what it changes, once, whoever uses it.
  const drawn = [...drawnMutations].sort()
  for (const id of drawn) {
    const mutation = mutations.get(id)!
    for (const change of [...mutation.changes, ...mutation.consequences]) {
      for (const node of change.nodes) targets.add(node)
      links.push(changeLink(id, change, changeMarks(model, change), id, hubs))
    }
  }

  // ── nodes: functions, then mutations, then what they change, then what they reach ──
  const nodes: SceneNode[] = functions.map((fn) => {
    const rows: SceneRow[] = fn.mutations.map((id) => {
      const mutation = mutations.get(id)!
      const verbs = [...new Set(mutation.changes.map((change) => VERB_WORDS[change.verb]))]
      const signs = preconditionSigns(mutation)
      return {
        id,
        label: mutation.label,
        ...(verbs.length > 0 ? { detail: verbs.join(' · ') } : {}),
        ...(signs.length > 0 ? { signs } : {}),
      }
    })
    return {
      id: fn.id,
      ...(fn.owner ? { anchor: `class.${fn.owner}.method.${fn.label}` } : {}),
      kind: 'function',
      shape: 'card',
      column: COLUMN.functions,
      label: fn.label,
      ...(fn.owner ? { sublabel: fn.owner } : {}),
      group: `module.${fn.module}`,
      icon: { glyph: 'function' },
      tone: 'fn',
      counts: fn.mutations.length > 0 ? [{ label: 'mutations', value: fn.mutations.length }] : [],
      badges: functionBadges(fn),
      signs: functionSigns(
        model,
        fn,
        fn.callees.filter((callee) => functionIds.has(callee)),
      ),
      rows,
      keywords: [
        ...(fn.owner ? [fn.owner] : []),
        ...fn.mutations.map((id) => mutations.get(id)!.label),
        ...fn.calls,
      ],
    }
  })

  for (const id of drawn) {
    const mutation = mutations.get(id)!
    nodes.push({
      id,
      kind: 'mutation',
      shape: 'pill',
      column: COLUMN.mutations,
      label: mutation.label,
      ...(unused.has(id)
        ? { sublabel: UNUSED }
        : mutation.gaps.length > 0
          ? { sublabel: 'can’t tell' }
          : {}),
      icon: { glyph: 'mutation' },
      tone: unused.has(id) ? 'muted' : 'fn',
      signs: preconditionSigns(mutation),
      keywords: [mutation.definition.id],
    })
  }

  // What each verb does to each Class, by the functions doing it.
  const doneTo = new Map<string, Map<ChangeVerb, Set<string>>>()
  for (const fn of functions)
    for (const [verb, changed] of verbsOf(model, fn))
      for (const node of changed) {
        const verbs = doneTo.get(node) ?? doneTo.set(node, new Map()).get(node)!
        verbs.set(verb, (verbs.get(verb) ?? new Set()).add(fn.id))
      }
  const modules = [...new Set(functions.map((fn) => fn.module))].sort((left, right) =>
    left.localeCompare(right),
  )
  const classNodes = [...targets]
    .map((id) => ({ id, ref: model.classes.get(id)! }))
    .sort(
      (left, right) =>
        Number(left.ref.origin !== domain) - Number(right.ref.origin !== domain) ||
        left.id.localeCompare(right.id),
    )
  for (const { id, ref } of classNodes) {
    const member = resolveClass(bundle, ref)
    const home = ref.origin === domain
    const changed = reach.get(id)?.size ?? 0
    const verbs = doneTo.get(id)
    const tallies: SceneTally[] = VERB_ORDER.flatMap((verb) => {
      const by = verbs?.get(verb)?.size ?? 0
      return by > 0 ? [{ label: `${VERB_PASSIVE[verb]} by ${by}`, value: by, tone: verb }] : []
    })
    // A Class stands beside the module that declares it, when that module has functions.
    const declared = home ? moduleOfMember(bundle, 'class', ref.name, SCHEMA_DIR) : undefined
    nodes.push({
      id,
      kind: home ? 'class' : isKernelClass(ref) ? 'kernel class' : 'imported class',
      shape: 'card',
      column: COLUMN.changed,
      label: ref.name,
      ...(home ? {} : { sublabel: originShort(ref.origin) }),
      icon: { ...(member?.icon ? { svg: member.icon } : {}), glyph: 'class' },
      tone: home ? 'node' : 'muted',
      counts: changed > 0 ? [{ label: 'functions', value: changed }] : [],
      ...(tallies.length > 0 ? { tallies } : {}),
      ...(hubs.has(id)
        ? { badges: [hubBadge(changed, functions.length, model.handlers ? 'change' : 'name')] }
        : {}),
      ...(declared && modules.includes(declared) ? { beside: `module.${declared}` } : {}),
    })
  }

  for (const key of [...integrationsReached].sort()) {
    const target = integrationTarget(key)
    const integration = model.integrations.get(key)
    const operations = integration?.operations
    const calls = [
      ...new Set(
        functions.flatMap((fn) => fn.calls.filter((call) => operationOf(call).key === key)),
      ),
    ]
    const used = calls.length
    const unsafe = unsafeOf(model, calls).map((call) => operationOf(call).name)
    const by = reach.get(target)?.size ?? 0
    const tallies: SceneTally[] = [
      { label: `reached by ${by}`, value: by, tone: 'call' },
      {
        label: `${used}${operations ? ` of ${operations.length}` : ''} ${(operations?.length ?? used) === 1 ? 'operation' : 'operations'}`,
        value: used,
        tone: 'call',
      },
      ...(unsafe.length > 0
        ? [
            {
              label: `may repeat ${listed(unsafe, 2)}`,
              value: unsafe.length,
              tone: 'warning' as const,
            },
          ]
        : []),
    ]
    nodes.push({
      id: target,
      kind: 'integration',
      shape: 'card',
      column: COLUMN.integrations,
      label: key,
      icon: { glyph: 'integration' },
      tone: 'muted',
      tallies,
      badges: [
        ...(operations
          ? []
          : [
              {
                label: 'can’t tell',
                tone: 'warning' as const,
                title: 'Its declaration could not be read',
              },
            ]),
        ...(hubs.has(target) ? [hubBadge(by, functions.length, 'reach')] : []),
      ],
      ...(operations
        ? {
            rows: operations.map((operation) => {
              const replay = replayLabel(operation.replay)
              return {
                id: `${target}.operation.${operation.name}`,
                label: operation.name,
                ...(replay ? { detail: replay } : {}),
                ...(operation.replay.includes('unsafe') ? { marks: ['unsafe'] } : {}),
              }
            }),
          }
        : {}),
      keywords: [
        ...(integration?.id ? [integration.id] : []),
        ...(operations?.map((o) => o.name) ?? []),
      ],
    })
  }

  // Every module is one box, its functions its rows; the box says how many.
  const groups: SceneGroup[] = modules.map((module) => {
    const count = functions.filter((fn) => fn.module === module).length
    return {
      id: `module.${module}`,
      label: moduleLabel(module, SCHEMA_DIR),
      ...(hues.has(module) ? { hue: hues.get(module)! } : {}),
      members: 'rows',
      caption: functionsWord(count),
    }
  })

  const folded: SceneFold[] = []
  const unchanged = Object.entries(bundle.ir.classes).filter(
    ([name, member]) =>
      member.type === 'node' && !(model.handlers ? doneTo : targets).has(`class.${name}`),
  ).length
  if (unchanged > 0) {
    folded.push({
      label: model.handlers ? 'Unchanged Classes' : 'Classes no function names',
      count: unchanged,
      reason: 'read in the Structure lens',
      lens: 'structure',
    })
  }
  const unreached = [...model.integrations.keys()].filter((key) => !integrationsReached.has(key))
  if (unreached.length > 0) {
    folded.push({
      label: 'Unreached Integrations',
      count: unreached.length,
      reason: 'no function reaches them',
    })
  }

  return {
    key: [
      'behavior',
      bundle.domainId,
      bundle.renderFingerprint,
      showAll ? 'mutations' : (focus ?? ''),
      showReads ? 'reads' : '',
      showCalls ? 'calls' : '',
    ].join(':'),
    nodes,
    links,
    groups,
    folded,
    trunkLabel: 'labels',
    lines: 'ribbons',
    bands: BANDS,
    index: behaviorIndex(model, nodes, groups),
    ...(nodes.length === 0
      ? { empty: 'The Schema declares no function: nothing here runs or changes the graph.' }
      : {}),
  }
}
