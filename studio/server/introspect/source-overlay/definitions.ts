/**
 * Source links for SDK Query and Mutation definitions, and what each one does to which
 * Class. Nothing in the SDK declares a definition's effects outside its `build`: this
 * reading follows the builder, the Class handles and the Query handles where they go,
 * through helpers and closures, and names the places it cannot follow instead of
 * guessing.
 */
import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type Project,
  type SourceFile,
} from 'ts-morph'

import type {
  DefinitionEffect,
  DefinitionLink,
  DefinitionPrecondition,
  DefinitionPreconditionKind,
  IrClass,
  PreconditionCondition,
  PreconditionTerm,
  PreconditionTermName,
  SchemaIR,
  SourceGap,
} from '../../../shared/contracts/schema'

import { isIrClassRef, classRefKey } from '../../../shared/schema/identity'
import {
  quotedSource,
  flowCache,
  flowSession,
  isCallable,
  isFunctionFlow,
  isObjectFlow,
  type Callable,
  type Flow,
  type FlowCache,
  type FlowLanguage,
  type FunctionFlow,
  type Reading,
} from './flow'
import {
  authoredTypeScriptFiles,
  bindingName,
  curriedFactory,
  declarationOf,
  leadingDoc,
  nodeKey,
  objectPropertyValue,
  propertyKey,
  relToRoot,
  resolveObjectLiteral,
  tryAddFile,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

export interface DefinitionReading {
  definitions: DefinitionLink[]
  /** `nodeKey` of each `define…()(…)` call → its declared id. */
  idByDeclaration: Map<string, string>
}

const KERNEL_ORIGIN = 'kernel.astrale.ai'
/** Edge ends accepting these name no relation: they accept any Node (SDK S2). */
const GENERIC_ENDS = new Set([`${KERNEL_ORIGIN}:class.Node`, `${KERNEL_ORIGIN}:class.Identity`])

type Role = NonNullable<DefinitionEffect['role']>

/** Classes handed as a value: a handle (`d.Issue`, `Admin.classes.Issue`) or a set of rows. */
interface Rows {
  readonly kind: 'rows'
  /** local names or exact imported keys */
  readonly classes: readonly string[]
  readonly role: Role
  /** a Class handle, before any read narrows it */
  readonly handle: boolean
  /** where a handle is written: its read starts there */
  readonly at?: Node
  /** one branch gives these Classes, another gives what the reading cannot tell */
  readonly partial?: true
}

/** One row in a read's callback: its Properties and named relations, or an Edge's ends. */
interface Row {
  readonly kind: 'row'
  readonly classes: readonly string[]
  readonly role: Role
  readonly edge: boolean
}

/** A Query V6 under construction: the Classes it names so far. */
interface QueryV6 {
  readonly kind: 'v6'
  readonly named: readonly string[]
  readonly expanded: boolean
  /**
   * the `Query.from` it starts at, while that names its Nodes by id only: the first
   * expand or Class filter names their Class
   */
  readonly unnamed?: string
}

/** `Query`, the Query V6 builder. */
interface QueryFactory {
  readonly kind: 'query'
}

/**
 * What a value is to a definition's reading: a resolved Domain or its Classes (the
 * closure form), the Query handles `d`, Classes and rows, the Mutation builder and its
 * verbs, a Query V6, string literals, or a list of these.
 */
type Value =
  | { readonly kind: 'domain'; readonly origin: string | undefined; readonly alias?: string }
  | { readonly kind: 'dependencies' }
  | { readonly kind: 'classes'; readonly origin: string | undefined; readonly alias?: string }
  | { readonly kind: 'handles' }
  | { readonly kind: 'document' }
  | Rows
  | Row
  | {
      readonly kind: 'method'
      readonly of: Rows | Row | QueryV6 | QueryFactory
      readonly name: string
    }
  | { readonly kind: 'builder' }
  | { readonly kind: 'expect' }
  | { readonly kind: 'verb'; readonly name: string }
  | { readonly kind: 'steps' }
  | { readonly kind: 'literal'; readonly values: readonly string[] }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<Flow<Value> | undefined> }
  | QueryFactory
  | QueryV6

const DOMAIN: Value = { kind: 'domain', origin: undefined }
const HANDLES: Value = { kind: 'handles' }
const BUILDER: Value = { kind: 'builder' }
const STEPS: Value = { kind: 'steps' }
const QUERY: QueryFactory = { kind: 'query' }

const WRITES: Readonly<Record<string, DefinitionEffect['kind']>> = {
  createNode: 'create',
  updateNode: 'update',
  deleteNode: 'delete',
  createEdge: 'create',
  updateEdge: 'update',
  deleteEdge: 'delete',
  transition: 'transition',
  'expect.node': 'expect',
  'expect.edge': 'expect',
}
/** Preconditions over a range of rows: `expect.none(d.Issue.where(…))`. */
const GUARDS = new Set(['expect.none', 'expect.exists', 'expect.count', 'expect.unchanged'])
/**
 * What each precondition verb takes, by the SDK's names: the parts of its input object, or its
 * arguments in order; `props` opens into `equals` and `absent`; `options` is the index of
 * `{ name }`, which the deprecated `expect.query` does not take.
 */
const PRECONDITION_PARTS: Readonly<
  Record<
    DefinitionPreconditionKind,
    {
      readonly input?: readonly PreconditionTermName[]
      readonly props?: true
      readonly args?: readonly PreconditionTermName[]
      readonly options?: number
    }
  >
> = {
  node: { input: ['node'], props: true, options: 1 },
  edge: { input: ['source', 'target', 'slug'], props: true, options: 1 },
  none: { args: ['range'], options: 1 },
  exists: { args: ['range'], options: 1 },
  count: { args: ['range', 'bounds'], options: 2 },
  unchanged: { args: ['range', 'ids'], options: 2 },
  query: { input: ['query', 'equals'] },
}
/** Row-set methods that return a narrower set; their callbacks receive one row. */
const NARROWING = new Set([
  'where',
  'orderBy',
  'with',
  'ref',
  'includeWithheld',
  'distinct',
  'withEdge',
  'reachable',
  'union',
])
/** Row-set methods that read: what they return reads nothing more. */
const READING = new Set([
  'get',
  'find',
  'first',
  'page',
  'all',
  'exists',
  'count',
  'is',
  'some',
  'every',
  'none',
  'atLeast',
  'atMost',
  'exactly',
])
/** A Node handle's own members: none names a relation. */
const ROW_MEMBERS = new Set(['id', 'path', '$class', 'via', 'is', 'isExactly'])
/** A Query V6's bindings, which name no Class. */
const V6_BINDINGS = new Set(['edge', 'source', 'target', 'node'])

function literal(flow: Flow<Value> | undefined): readonly string[] | undefined {
  return flow?.kind === 'literal' ? flow.values : undefined
}

function single(flow: Flow<Value> | undefined): string | undefined {
  const values = literal(flow)
  return values?.length === 1 ? values[0] : undefined
}

function classesOf(flow: Flow<Value> | undefined): readonly string[] | undefined {
  return flow?.kind === 'rows' || flow?.kind === 'row' ? flow.classes : undefined
}

/** The Classes a value or a list of values names; undefined when one of them is unknown. */
function classListOf(flow: Flow<Value> | undefined): readonly string[] | undefined {
  if (flow?.kind !== 'list') return classesOf(flow)
  const classes: string[] = []
  for (const item of flow.items) {
    const named = classListOf(item)
    if (!named) return undefined
    classes.push(...named)
  }
  return classes
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function propertyOf(flow: Flow<Value> | undefined, name: string): Flow<Value> | undefined {
  return flow && isObjectFlow(flow) ? flow.properties.get(name) : undefined
}

/** A to-one end's relation, named from the Classes the near end accepts (SDK S2). */
interface Relation {
  readonly edge: string
  readonly far: readonly string[]
  readonly own: boolean
}

/** The Domain's Classes as the reading resolves names against them. */
interface Model {
  readonly ir: SchemaIR | null
  /** dependency alias → origin */
  readonly dependencies: ReadonlyMap<string, string>
  classOf(origin: string | undefined, name: string): string | undefined
  isEdge(key: string): boolean
  /** each end of an Edge Class: the Classes it accepts; undefined without the IR */
  endsOf(edge: string): ReadonlyArray<readonly string[]> | undefined
  relation(classes: readonly string[], name: string): Relation | undefined
  /** a state Property's transitions: `from → event → to` */
  machine(
    key: string,
    property: string,
  ): Readonly<Record<string, Readonly<Record<string, string>>>> | undefined
}

function modelOf(ir: SchemaIR | null, dependencies: ReadonlyMap<string, string>): Model {
  const local = ir?.domain
  const declared = (key: string): IrClass | undefined =>
    ir?.classes[key] ?? ir?.importedClassesByKey[key as keyof SchemaIR['importedClassesByKey']]
  const keyOf = (ref: unknown): string | undefined =>
    isIrClassRef(ref) ? (ref.origin === local ? ref.name : classRefKey(ref)) : undefined
  const accepts = (end: NonNullable<IrClass['endpoints']>[number]): string[] =>
    end.refs ? end.refs.map(keyOf).filter((key): key is string => key !== undefined) : end.types
  const satisfied = new Map<string, readonly string[]>()
  /** A Class and every Class it extends. */
  const satisfies = (key: string): readonly string[] => {
    let keys = satisfied.get(key)
    if (keys) return keys
    const found = new Set<string>([key])
    const queue = [key]
    while (queue.length > 0) {
      const next = declared(queue.pop()!)
      for (const ref of next?.extendsRefs ?? []) {
        const parent = keyOf(ref)
        if (parent && !found.has(parent)) {
          found.add(parent)
          queue.push(parent)
        }
      }
    }
    keys = [...found]
    satisfied.set(key, keys)
    return keys
  }
  let relations: Map<string, Map<string, Relation[]>> | undefined
  const relationsAt = () => {
    if (relations) return relations
    relations = new Map()
    const edges: Array<[string, IrClass, boolean]> = [
      ...Object.entries(ir?.classes ?? {}).map(([key, cls]): [string, IrClass, boolean] => [
        key,
        cls,
        true,
      ]),
      ...Object.entries(ir?.importedClassesByKey ?? {}).map(
        ([key, cls]): [string, IrClass, boolean] => [key, cls, false],
      ),
    ]
    for (const [edge, cls, own] of edges) {
      const ends = cls.type === 'edge' ? cls.endpoints : undefined
      if (!ends || ends.length !== 2) continue
      ends.forEach((end, index) => {
        const other = ends[1 - index]!
        if (end.cardinality?.max !== 1) return
        const far = accepts(other)
        if (far.some((key) => GENERIC_ENDS.has(key))) return
        for (const at of accepts(end)) {
          const byName = relations!.get(at) ?? new Map<string, Relation[]>()
          relations!.set(at, byName)
          byName.set(other.name, [...(byName.get(other.name) ?? []), { edge, far, own }])
        }
      })
    }
    return relations
  }
  const properties = (key: string) =>
    satisfies(key).some((ancestor) => declared(ancestor)?.properties !== undefined)
      ? new Set(
          satisfies(key).flatMap((ancestor) => Object.keys(declared(ancestor)?.properties ?? {})),
        )
      : new Set<string>()

  return {
    ir,
    dependencies,
    classOf: (origin, name) => {
      if (origin === undefined || origin === local) {
        return !ir || ir.classes[name] ? name : undefined
      }
      return `${origin}:class.${name}`
    },
    isEdge: (key) => declared(key)?.type === 'edge',
    endsOf: (edge) => {
      const ends = declared(edge)?.endpoints
      return ends && ends.length === 2 ? ends.map(accepts) : undefined
    },
    relation: (classes, name) => {
      if (!ir) return undefined
      const edges = new Set<string>()
      const far = new Set<string>()
      let own = true
      for (const cls of classes) {
        if (properties(cls).has(name)) continue
        const candidates = satisfies(cls).flatMap((key) => relationsAt().get(key)?.get(name) ?? [])
        // the Domain's own relations shadow its dependencies'; a name two ends claim names neither
        const owned = candidates.filter((candidate) => candidate.own)
        const shadowed = owned.length > 0 ? owned : candidates
        const distinct = new Map(shadowed.map((candidate) => [candidate.edge, candidate]))
        if (distinct.size !== 1) continue
        const [relation] = distinct.values()
        edges.add(relation!.edge)
        relation!.far.forEach((key) => far.add(key))
        own &&= relation!.own
      }
      if (edges.size !== 1) return undefined
      return { edge: [...edges][0]!, far: [...far], own }
    },
    machine: (key, property) => {
      for (const ancestor of satisfies(key)) {
        const metadata = declared(ancestor)?.propertyMetadata?.[property] as
          | { state?: { transitions?: Record<string, Record<string, string>> } }
          | undefined
        if (metadata?.state?.transitions) return metadata.state.transitions
      }
      return undefined
    },
  }
}

/** The Classes an Edge reaches from `near` rows: its other end, or the end `direction` names. */
function farOf(model: Model, edge: string, near: readonly string[], direction: string | undefined) {
  const ends = model.endsOf(edge)
  if (!ends) return []
  const [source, target] = ends as [readonly string[], readonly string[]]
  if (direction === 'outgoing') return target
  if (direction === 'incoming') return source
  const touches = (end: readonly string[]) => near.some((cls) => end.includes(cls))
  const far = [...(touches(source) ? target : []), ...(touches(target) ? source : [])]
  return far.length > 0 ? far : [...source, ...target]
}

/** The ends an Edge leaves from in a direction: both ends when it is not written. */
function nearOf(model: Model, edge: string, direction: string | undefined): readonly string[] {
  const ends = model.endsOf(edge)
  if (!ends) return []
  const [source, target] = ends as [readonly string[], readonly string[]]
  if (direction === 'outgoing') return source
  if (direction === 'incoming') return target
  return [...source, ...target]
}

/** A definition's reading: its effects and the language its values are read in. */
function definitionLanguage(args: {
  kind: DefinitionLink['kind']
  model: Model
  domainRoot: string
}): {
  language: FlowLanguage<Value>
  effects: DefinitionEffect[]
  preconditions: ReadonlyMap<string, DefinitionPrecondition>
  /** the `Query.from` sites whose Nodes nothing after them gives a Class */
  unnamed: () => ReadonlyArray<{ at: Node; text: string }>
} {
  const { kind, model, domainRoot } = args
  const reads = kind === 'query'
  const effects: DefinitionEffect[] = []
  const recorded = new Set<string>()
  // one per `expect` call, by `nodeKey`, in the order the reading meets them
  const preconditions = new Map<string, DefinitionPrecondition>()
  // a site the reading evaluates again keeps what an earlier evaluation named
  const byId = new Map<string, { at: Node; text: string }>()
  const rooted = new Set<string>()
  // module-level names being evaluated, so two that name each other end
  const resolving = new Set<string>()

  const record = (effect: Omit<DefinitionEffect, 'file' | 'line'>, at: Node) => {
    const file = relToRoot(domainRoot, at.getSourceFile().getFilePath())
    const line = at.getStartLineNumber()
    // a read is one per Class and role; a write or a precondition one per place
    const key =
      effect.kind === 'read'
        ? `read|${effect.class}|${effect.role}`
        : `${effect.kind}|${effect.class}|${effect.verb}|${file}:${line}|${effect.property}|${effect.from}|${effect.event}`
    if (recorded.has(key)) return
    recorded.add(key)
    effects.push({ ...effect, file, line })
  }
  const read = (classes: readonly string[], verb: string, role: Role, at: Node) => {
    if (!reads) return
    for (const cls of classes) record({ kind: 'read', class: cls, verb, role }, at)
  }

  /** Where a call's verb is written: its name, so each link of a chain has its own line. */
  const siteOf = (expression: CallExpression): Node => {
    const callee = unwrapExpression(expression.getExpression())
    return Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : expression
  }

  /** Read each callback argument with the row it receives. */
  const callbacks = (expression: CallExpression, row: Row, reading: Reading<Value>) => {
    for (const argument of expression.getArguments()) {
      const flow = reading.evaluate(argument)
      if (flow && isFunctionFlow(flow)) reading.visit(flow, [row], argument)
      const through = propertyOf(flow, 'through')
      if (through && isFunctionFlow(through)) reading.visit(through, [row], argument)
    }
  }

  /** A Class handle, read where it is written; a destructured one, where it is used. */
  const handle = (classes: readonly string[], at: Node): Rows => ({
    kind: 'rows',
    classes,
    role: 'root',
    handle: true,
    ...(Node.isBindingElement(at) ? {} : { at }),
  })

  const rowOf = (rows: Rows | Row): Row => ({
    kind: 'row',
    classes: rows.classes,
    role: rows.role,
    edge: rows.classes.length > 0 && rows.classes.every(model.isEdge),
  })

  /** What a verb's options write under `name`, when they are written as an object. */
  const writtenProperty = (options: Node | undefined, name: string): Node | undefined => {
    const property = options && resolveObjectLiteral(options)?.getProperty(name)
    return property && objectPropertyValue(property)
  }

  /**
   * What a verb needs of a node: its value, or what the authored helper it calls returns
   * even when nothing handed to that helper is followed (`query: clientEdge(input.id)`).
   */
  const demand = (node: Node | undefined, reading: Reading<Value>): Flow<Value> | undefined => {
    if (!node) return undefined
    const value = reading.evaluate(node)
    const call = value ? undefined : unwrapExpression(node)
    if (!call || !Node.isCallExpression(call)) return value
    const helper = reading.evaluate(call.getExpression())
    if (!helper || !isFunctionFlow(helper)) return undefined
    const flows = call.getArguments().map((argument) => reading.evaluate(argument))
    return reading.visit(helper, flows, call)
  }

  /** The Classes a verb names; a gap where a branch names one it cannot tell, and its reason. */
  const named = (
    flow: Flow<Value> | undefined,
    written: Node,
    at: Node,
    reading: Reading<Value>,
    what: string,
  ): { classes?: readonly string[]; gap?: string } => {
    const classes = classesOf(flow)
    const gap = !classes
      ? `${what} the reading cannot tell: ${quotedSource(written)}`
      : flow?.kind === 'rows' && flow.partial
        ? `${what} the reading cannot tell in every branch: ${quotedSource(written)}`
        : undefined
    if (gap) reading.gap(at, gap)
    return { ...(classes ? { classes } : {}), ...(gap ? { gap } : {}) }
  }

  /**
   * The precondition an `expect` call states, once per call whichever readings reach it: the
   * Classes each reading names, its parts and name as the call writes them, and what of it the
   * reading cannot tell.
   */
  const state = (
    name: string,
    expression: CallExpression,
    at: Node,
    classes: readonly string[] | undefined,
    gap: string | undefined,
  ) => {
    const key = nodeKey(expression)
    const known = preconditions.get(key)
    if (known) {
      known.classes = unique([...known.classes, ...(classes ?? [])])
      if (gap && !known.gap?.includes(gap)) known.gap = known.gap ? `${known.gap}; ${gap}` : gap
      return
    }
    const kind = name.slice('expect.'.length) as DefinitionPreconditionKind
    const written = writtenPrecondition(kind, expression)
    const gaps = [gap, ...written.gaps].filter((reason): reason is string => reason !== undefined)
    const under = conditionsAround(expression)
    preconditions.set(key, {
      kind,
      classes: [...(classes ?? [])],
      ...(written.name === undefined ? {} : { name: written.name }),
      terms: written.terms,
      file: relToRoot(domainRoot, at.getSourceFile().getFilePath()),
      line: at.getStartLineNumber(),
      ...(under.length > 0 ? { under } : {}),
      ...(gaps.length > 0 ? { gap: gaps.join('; ') } : {}),
    })
  }

  /** A builder verb: the Classes it writes or requires, and the builder it returns. */
  const verb = (name: string, expression: CallExpression, reading: Reading<Value>) => {
    const args = expression.getArguments()
    const at = siteOf(expression)
    const options = args[0] && reading.evaluate(args[0])
    const effect = WRITES[name]
    if (effect) {
      const written = writtenProperty(args[0], 'class')
      const flow = propertyOf(options, 'class') ?? demand(written, reading)
      const { classes, gap } = named(
        flow,
        written ?? args[0] ?? expression,
        at,
        reading,
        'names a Class',
      )
      if (classes && effect === 'transition') transition(classes, options, at)
      else for (const cls of classes ?? []) record({ kind: effect, class: cls, verb: name }, at)
      if (effect === 'expect') state(name, expression, at, classes, gap)
      return name === 'createNode' ? undefined : BUILDER
    }
    if (GUARDS.has(name)) {
      const range = options ?? demand(args[0], reading)
      const { classes, gap } = named(range, args[0] ?? expression, at, reading, 'expects a range')
      for (const cls of classes ?? []) record({ kind: 'expect', class: cls, verb: name }, at)
      state(name, expression, at, classes, gap)
      return BUILDER
    }
    if (name === 'expect.query') {
      const written = writtenProperty(args[0], 'query')
      const given = propertyOf(options, 'query')
      const query = given?.kind === 'v6' ? given : demand(written, reading)
      if (query?.kind !== 'v6' || query.named.length === 0) {
        const text = quotedSource(written ?? args[0] ?? expression)
        const gap = `expects a Query whose Classes the reading cannot tell: ${text}`
        reading.gap(at, gap)
        state(name, expression, at, undefined, gap)
      } else {
        for (const cls of query.named) record({ kind: 'expect', class: cls, verb: name }, at)
        state(name, expression, at, query.named, undefined)
      }
      return BUILDER
    }
    reading.gap(at, `calls \`mutation.${name}\`, which the reading does not know`)
    return BUILDER
  }

  /** One effect per transition the literals and the Class's state machine allow. */
  const transition = (classes: readonly string[], input: Flow<Value> | undefined, at: Node) => {
    const property = single(propertyOf(input, 'property'))
    const froms = literal(propertyOf(input, 'from'))
    const events = literal(propertyOf(input, 'event'))
    for (const cls of classes) {
      const machine = property === undefined ? undefined : model.machine(cls, property)
      const target = (from: string | undefined, event: string | undefined) => {
        if (!machine || event === undefined) return undefined
        if (from !== undefined) return machine[from]?.[event]
        const targets = unique(
          Object.values(machine).flatMap((events) => (events[event] ? [events[event]] : [])),
        )
        return targets.length === 1 ? targets[0] : undefined
      }
      let any = false
      for (const from of froms ?? [undefined]) {
        for (const event of events ?? [undefined]) {
          const to = target(from, event)
          // a pair the state machine has no transition for is a branch the source rules out
          if (machine && from !== undefined && event !== undefined && to === undefined) continue
          any = true
          record(
            {
              kind: 'transition',
              class: cls,
              verb: 'transition',
              ...(property === undefined ? {} : { property }),
              ...(from === undefined ? {} : { from }),
              ...(event === undefined ? {} : { event }),
              ...(to === undefined ? {} : { to }),
            },
            at,
          )
        }
      }
      if (!any) {
        record(
          {
            kind: 'transition',
            class: cls,
            verb: 'transition',
            ...(property === undefined ? {} : { property }),
          },
          at,
        )
      }
    }
  }

  /** A read method on rows or a row: what it reads, and the rows it narrows to. */
  const method = (
    value: Extract<Value, { kind: 'method' }>,
    expression: CallExpression,
    reading: Reading<Value>,
  ): Flow<Value> | undefined => {
    const { of, name } = value
    const args = expression.getArguments()
    const at = siteOf(expression)
    if (of.kind === 'query') {
      const from = args[0] && reading.evaluate(args[0])
      const named: string[] = []
      const written = args[0] && resolveObjectLiteral(args[0])
      let root: string | undefined
      for (const list of ['nodes', 'edges'] as const) {
        const items = propertyOf(from, list)
        const property = written?.getProperty(list)
        if (items?.kind !== 'list' && !property) continue
        let unknown = items?.kind !== 'list'
        for (const item of items?.kind === 'list' ? items.items : []) {
          const classes = classesOf(item)
          if (classes) named.push(...classes)
          else unknown = true
        }
        if (!unknown) continue
        const text = quotedSource(
          (property && objectPropertyValue(property)) ?? args[0] ?? expression,
        )
        if (list === 'edges') {
          reading.gap(at, `reads Edges of a Class the reading cannot tell: ${text}`)
          continue
        }
        // Nodes by id: an expand or a Class filter after them names their Class
        root = nodeKey(at)
        byId.set(root, { at, text })
      }
      read(named, 'Query.from', 'root', at)
      return {
        kind: 'v6',
        named: unique(named),
        expanded: false,
        ...(root ? { unnamed: root } : {}),
      }
    }
    if (of.kind === 'v6') {
      const options = args[0] && reading.evaluate(args[0])
      if (name === 'expand') {
        const via = propertyOf(options, 'via')
        const edges = classListOf(via)
        if (!edges) {
          const written = args[0] && resolveObjectLiteral(args[0])?.getProperty('via')
          const text = (written && objectPropertyValue(written)) ?? args[0] ?? expression
          reading.gap(at, `expands through Classes the reading cannot tell: ${quotedSource(text)}`)
          return { ...of, expanded: true }
        }
        const direction = single(propertyOf(options, 'direction'))
        // Nodes the source names by id are the Nodes the first expand leaves from
        const root = !of.expanded && of.unnamed ? byId.get(of.unnamed) : undefined
        const near = root ? unique(edges.flatMap((edge) => nearOf(model, edge, direction))) : []
        if (root && near.length > 0) {
          read(near, 'Query.from', 'root', root.at)
          rooted.add(of.unnamed!)
        }
        read(edges, 'Query.expand', 'traverse', at)
        for (const edge of edges)
          read(farOf(model, edge, [], direction), 'Query.expand', 'traverse', at)
        return { kind: 'v6', named: unique([...of.named, ...near, ...edges]), expanded: true }
      }
      if (name === 'filter') {
        const written = propertyOf(options, 'class')
        const classes = classesOf(written)
        if (classes) {
          read(classes, 'Query.filter', of.expanded ? 'traverse' : 'root', at)
          if (!of.expanded && of.unnamed) rooted.add(of.unnamed)
          return { kind: 'v6', named: unique([...of.named, ...classes]), expanded: of.expanded }
        }
      }
      return of
    }
    if (of.kind === 'row') {
      if (name === 'via') {
        const edges = classListOf(args[0] && reading.evaluate(args[0]))
        if (!edges) {
          if (reads)
            reading.gap(
              at,
              `walks an Edge the reading cannot tell: ${quotedSource(args[0] ?? expression)}`,
            )
          return undefined
        }
        const direction = single(propertyOf(args[1] && reading.evaluate(args[1]), 'direction'))
        const far = unique(edges.flatMap((edge) => farOf(model, edge, of.classes, direction)))
        read(edges, 'via', 'traverse', at)
        read(far, 'via', 'traverse', at)
        return { kind: 'rows', classes: far, role: 'traverse', handle: false }
      }
      // `is` and `isExactly` narrow the row to a Class, and read its conditions on it
      const narrowed = classesOf(args[0] && reading.evaluate(args[0]))
      if (!narrowed) {
        if (reads)
          reading.gap(
            at,
            `narrows to a Class the reading cannot tell: ${quotedSource(args[0] ?? expression)}`,
          )
        return undefined
      }
      read(narrowed, name, of.role, at)
      const conditions = args[1] && reading.evaluate(args[1])
      if (conditions && isFunctionFlow(conditions))
        reading.visit(
          conditions,
          [{ kind: 'row', classes: narrowed, role: of.role, edge: false }],
          args[1]!,
        )
      return undefined
    }
    // a set of rows
    if (of.handle) read(of.classes, name, of.role, of.at ?? at)
    if (name === 'union') {
      const other = args[0] && reading.evaluate(args[0])
      const classes = classesOf(other)
      if (!classes) {
        if (reads)
          reading.gap(
            at,
            `reads a union with a Class the reading cannot tell: ${quotedSource(args[0] ?? expression)}`,
          )
        return { ...of, handle: false }
      }
      read(classes, 'union', of.role, at)
      return {
        kind: 'rows',
        classes: unique([...of.classes, ...classes]),
        role: of.role,
        handle: false,
      }
    }
    callbacks(expression, rowOf(of), reading)
    return NARROWING.has(name) ? { ...of, handle: false } : undefined
  }

  const evaluateName = (identifier: Node, reading: Reading<Value>): Flow<Value> | undefined => {
    const declaration = declarationOf(identifier)
    if (declaration && Node.isImportSpecifier(declaration)) {
      const module = declaration.getImportDeclaration().getModuleSpecifierValue()
      if (module === '@astrale-os/sdk' || module.startsWith('@astrale-os/sdk/')) {
        const imported = declaration.getName()
        if (imported === 'Query') return QUERY
        if (imported === 'K') return { kind: 'domain', origin: KERNEL_ORIGIN }
        return undefined
      }
    } else if (!declaration || declaration.getFirstAncestor(isCallable)) {
      // a parameter or a local the reading does not bind holds nothing it can tell
      return undefined
    }
    // a module-level constant: a literal, a list, an object of these, or another name
    const key = nodeKey(declaration)
    if (resolving.has(key)) return undefined
    const resolved = valueOfIdentifier(identifier)
    const value = resolved && unwrapExpression(resolved)
    if (
      !value ||
      !(
        Node.isStringLiteral(value) ||
        Node.isNoSubstitutionTemplateLiteral(value) ||
        Node.isArrayLiteralExpression(value) ||
        Node.isObjectLiteralExpression(value) ||
        Node.isIdentifier(value) ||
        Node.isPropertyAccessExpression(value)
      )
    ) {
      return undefined
    }
    resolving.add(key)
    try {
      return reading.evaluate(value)
    } finally {
      resolving.delete(key)
    }
  }

  const language: FlowLanguage<Value> = {
    member: (value, name, at, reading) => {
      switch (value.kind) {
        case 'domain':
          if (name === 'classes')
            return { kind: 'classes', origin: value.origin, alias: value.alias }
          return name === 'dependencies' && value.origin === undefined && value.alias === undefined
            ? { kind: 'dependencies' }
            : undefined
        case 'dependencies':
          return { kind: 'domain', origin: model.dependencies.get(name), alias: name }
        case 'classes': {
          const origin = value.origin
          // a dependency whose origin the reading lacks: its Class by a name one origin holds
          if (origin === undefined && value.alias !== undefined) {
            const keys = Object.keys(model.ir?.importsByKey ?? {}).filter((key) =>
              key.endsWith(`:class.${name}`),
            )
            return keys.length === 1 ? handle(keys, at) : undefined
          }
          const cls = model.classOf(origin, name)
          return cls ? handle([cls], at) : undefined
        }
        case 'handles': {
          // fixed names first, then the Domain's own Classes, then its dependencies
          if (name === 'kernel') return { kind: 'classes', origin: KERNEL_ORIGIN }
          if (name === 'document') return { kind: 'document' }
          if (name === 'core' || name === 'origin') return undefined
          const own = model.classOf(undefined, name)
          if (own && (model.ir || !model.dependencies.has(name))) return handle([own], at)
          if (model.dependencies.has(name))
            return { kind: 'classes', origin: model.dependencies.get(name) }
          if (reads) reading.gap(at, `reads \`d.${name}\`, which names no Class the reading knows`)
          return undefined
        }
        case 'rows':
          // a handle's key names its Class
          if (name === 'key' && value.handle) return value
          return NARROWING.has(name) || READING.has(name)
            ? { kind: 'method', of: value, name }
            : undefined
        case 'row': {
          if (name === 'via' || name === 'is' || name === 'isExactly')
            return { kind: 'method', of: value, name }
          if (ROW_MEMBERS.has(name)) return undefined
          if (value.edge) {
            // an Edge row's ends, by role
            const ends = value.classes.flatMap((edge) => {
              const declared =
                model.ir?.classes[edge] ?? model.ir?.importedClassesByKey[edge as never]
              const index = declared?.endpoints?.findIndex((end) => end.name === name) ?? -1
              return index < 0 ? [] : (model.endsOf(edge)?.[index] ?? [])
            })
            if (ends.length === 0) return undefined
            read(ends, name, 'traverse', at)
            return { kind: 'row', classes: unique(ends), role: 'traverse', edge: false }
          }
          const relation = model.relation(value.classes, name)
          if (!relation) return undefined
          read([relation.edge, ...relation.far], name, 'traverse', at)
          return { kind: 'rows', classes: relation.far, role: 'traverse', handle: false }
        }
        case 'builder':
          return name === 'expect' ? { kind: 'expect' } : { kind: 'verb', name }
        case 'expect':
          return { kind: 'verb', name: `expect.${name}` }
        case 'query':
          return name === 'from' ? { kind: 'method', of: value, name } : undefined
        case 'v6':
          return V6_BINDINGS.has(name) ? undefined : { kind: 'method', of: value, name }
        case 'list':
          return undefined
        default:
          return undefined
      }
    },
    call: (value, expression, reading) => {
      if (value.kind === 'verb') return verb(value.name, expression, reading)
      if (value.kind === 'method') return method(value, expression, reading)
      if (value.kind === 'document' && reads)
        reading.gap(expression, 'reads a Query document, whose Classes the reading cannot tell')
      return undefined
    },
    evaluate: (node, reading) => {
      if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
        return { kind: 'literal', values: [node.getLiteralText()] }
      if (Node.isArrayLiteralExpression(node)) {
        const items: Array<Flow<Value> | undefined> = []
        for (const element of node.getElements()) {
          if (!Node.isSpreadElement(element)) {
            items.push(reading.evaluate(element))
            continue
          }
          const spread = reading.evaluate(element.getExpression())
          if (spread?.kind === 'list') items.push(...spread.items)
          else items.push(undefined)
        }
        return { kind: 'list', items }
      }
      if (Node.isIdentifier(node)) return evaluateName(node, reading)
      return undefined
    },
    names: (value) => (value.kind === 'literal' ? value.values : undefined),
    decide: (condition, reading) => {
      const test = unwrapExpression(condition)
      if (!Node.isBinaryExpression(test)) return undefined
      const operator = test.getOperatorToken().getKind()
      const equal =
        operator === SyntaxKind.EqualsEqualsEqualsToken || operator === SyntaxKind.EqualsEqualsToken
      const unequal =
        operator === SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === SyntaxKind.ExclamationEqualsToken
      if (!equal && !unequal) return undefined
      const left = single(reading.evaluate(test.getLeft()))
      const right = single(reading.evaluate(test.getRight()))
      if (left === undefined || right === undefined) return undefined
      return (left === right) === equal
    },
    // a literal or a list is what every branch gives, or nothing; rows keep what a branch names
    either: (left, right) => {
      if (left.kind === 'literal' || left.kind === 'list') {
        if (right?.kind !== left.kind) return undefined
        return left.kind === 'literal'
          ? { kind: 'literal', values: unique([...left.values, ...(right as typeof left).values]) }
          : { kind: 'list', items: [...left.items, ...(right as typeof left).items] }
      }
      if (left.kind === 'rows') {
        if (right?.kind !== 'rows') return { ...left, partial: true }
        const partial = left.partial || right.partial
        return {
          kind: 'rows',
          classes: unique([...left.classes, ...right.classes]),
          role: left.role === right.role ? left.role : 'traverse',
          handle: left.handle && right.handle,
          ...(left.at ? { at: left.at } : {}),
          ...(partial ? { partial } : {}),
        }
      }
      if (left.kind === 'v6' && right?.kind === 'v6') {
        const byId = left.unnamed ?? right.unnamed
        return {
          kind: 'v6',
          named: unique([...left.named, ...right.named]),
          expanded: left.expanded || right.expanded,
          ...(byId ? { unnamed: byId } : {}),
        }
      }
      return left
    },
    holds: (value) =>
      reads
        ? value.kind === 'handles' || value.kind === 'rows'
        : value.kind === 'builder' || value.kind === 'expect' || value.kind === 'verb',
    // a helper handed anything but a bare literal may write, read or name a Class
    follows: (value) =>
      value.kind === 'literal'
        ? false
        : value.kind === 'list'
          ? value.items.some((item) => item !== undefined && item.kind !== 'literal')
          : true,
    describe: (flow) => {
      switch (flow.kind) {
        case 'builder':
          return 'the Mutation builder'
        case 'expect':
          return "the Mutation builder's preconditions"
        case 'verb':
          return `\`mutation.${flow.name}\``
        case 'handles':
          return 'the Query handles'
        case 'rows':
          return `the ${flow.classes.join(' | ')} rows`
        case 'function':
          return 'a function'
        case 'object':
          return reads
            ? 'an object holding the Query handles'
            : 'an object holding the Mutation builder'
        default:
          return 'a value'
      }
    },
    signature: (value) => {
      switch (value.kind) {
        case 'domain':
          return `D:${value.origin ?? ''}:${value.alias ?? ''}`
        case 'classes':
          return `K:${value.origin ?? ''}:${value.alias ?? ''}`
        case 'rows':
          return `r:${value.classes.join('|')}:${value.role}:${value.handle ? 'h' : ''}${value.partial ? '?' : ''}`
        case 'row':
          return `w:${value.classes.join('|')}:${value.role}:${value.edge ? 'e' : ''}`
        case 'method':
          return `m:${value.name}:${language.signature(value.of)}`
        case 'verb':
          return `v:${value.name}`
        case 'literal':
          return `l:${value.values.join('|')}`
        case 'list':
          return `[${value.items
            .map((item) =>
              item === undefined
                ? ''
                : isFunctionFlow(item) || isObjectFlow(item)
                  ? '?'
                  : language.signature(item),
            )
            .join(',')}]`
        case 'v6':
          return `q:${value.named.join('|')}:${value.expanded ? 'x' : ''}:${value.unnamed ?? ''}`
        default:
          return value.kind
      }
    },
  }
  const unnamed = () => [...byId].flatMap(([key, site]) => (rooted.has(key) ? [] : [site]))
  return { language, effects, preconditions, unnamed }
}

/**
 * The properties an object written as a literal holds, through the spreads and `const` names the
 * reading can open; the parts it cannot open (a spread of a computed value, a computed key).
 */
function writtenObject(
  node: Node,
  seen = new Set<string>(),
): { properties: Map<string, Node>; unopened: Node[] } | undefined {
  const object = resolveObjectLiteral(node)
  if (!object || seen.has(nodeKey(object))) return undefined
  seen.add(nodeKey(object))
  const properties = new Map<string, Node>()
  const unopened: Node[] = []
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = writtenObject(property.getExpression(), seen)
      if (!spread) {
        unopened.push(property)
        continue
      }
      for (const [key, value] of spread.properties) properties.set(key, value)
      unopened.push(...spread.unopened)
      continue
    }
    const key = propertyKey(property)
    const value = objectPropertyValue(property)
    if (key === undefined || !value) unopened.push(property)
    else properties.set(key, value)
  }
  return { properties, unopened }
}

/**
 * A node's source on one line: its comments left out, and a formatter's line breaks, trailing
 * commas and indentation folded.
 */
function folded(node: Node): string {
  const start = node.getStart()
  const text = node.getText()
  const comments = new Map<number, number>()
  for (const child of node.getDescendants()) {
    for (const range of [...child.getLeadingCommentRanges(), ...child.getTrailingCommentRanges()])
      if (range.getPos() >= start && range.getEnd() <= node.getEnd())
        comments.set(range.getPos(), range.getEnd())
  }
  let code = ''
  let at = start
  for (const [pos, end] of [...comments].sort(([left], [right]) => left - right)) {
    if (pos < at) continue
    code += text.slice(at - start, pos - start)
    at = end
  }
  code += text.slice(at - start)
  return code
    .replace(/,\s*\n\s*([)\]])/g, '$1')
    .replace(/,\s*\n\s*\}/g, ' }')
    .replace(/([([])\s*\n\s*/g, '$1')
    .replace(/\s*\n\s*([)\]]|\.(?!\.))/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/** What a part stands for: the initialiser of a `const` this file names by it, or the part. */
function standsFor(node: Node, seen = new Set<string>()): Node {
  const value = unwrapExpression(node)
  const declaration = Node.isIdentifier(value) ? declarationOf(value) : undefined
  const list = declaration?.getParent()
  const initializer =
    declaration &&
    Node.isVariableDeclaration(declaration) &&
    Node.isIdentifier(declaration.getNameNode()) &&
    declaration.getSourceFile() === node.getSourceFile() &&
    list &&
    Node.isVariableDeclarationList(list) &&
    list.getDeclarationKind() === VariableDeclarationKind.Const
      ? declaration.getInitializer()
      : undefined
  if (!initializer || isCallable(unwrapExpression(initializer)) || seen.has(nodeKey(initializer)))
    return node
  seen.add(nodeKey(initializer))
  return standsFor(initializer, seen)
}

/** A part as the source writes it, on one line. */
function termText(node: Node): string {
  return folded(standsFor(node))
}

/**
 * Whether the source writes an object out: a literal, or a choice between such, whose spreads it
 * writes out too (`{ equals, ...(previous === undefined ? { absent } : {}) }`).
 */
function writtenOut(node: Node, seen = new Set<string>()): boolean {
  const value = unwrapExpression(standsFor(node))
  if (seen.has(nodeKey(value))) return false
  seen.add(nodeKey(value))
  if (Node.isConditionalExpression(value))
    return writtenOut(value.getWhenTrue(), seen) && writtenOut(value.getWhenFalse(), seen)
  const object = resolveObjectLiteral(value)
  return (
    object !== undefined &&
    object
      .getProperties()
      .every(
        (property) =>
          !Node.isSpreadAssignment(property) || writtenOut(property.getExpression(), seen),
      )
  )
}

/**
 * What an `expect` call writes of its precondition: its parts by the SDK's names, the name a
 * refusal carries, and each part the reading cannot open.
 */
function writtenPrecondition(
  kind: DefinitionPreconditionKind,
  call: CallExpression,
): { terms: PreconditionTerm[]; name?: string; gaps: string[] } {
  const parts = PRECONDITION_PARTS[kind]
  const args = call.getArguments()
  const terms: PreconditionTerm[] = []
  const gaps: string[] = []
  const add = (term: PreconditionTermName, node: Node | undefined) => {
    if (node) terms.push({ term, text: termText(node) })
  }
  const unopened = (what: string, node: Node) =>
    gaps.push(`${what} a value the reading cannot open: ${quotedSource(standsFor(node))}`)
  parts.args?.forEach((term, index) => add(term, args[index]))
  if (parts.input) {
    const input = args[0] && writtenObject(args[0])
    if (!input) unopened('states its condition as', args[0] ?? call)
    else {
      for (const part of input.unopened) unopened('takes part of its condition from', part)
      for (const term of parts.input) add(term, input.properties.get(term))
      const props = parts.props && input.properties.get('props')
      const conditions = props && writtenObject(props)
      if (conditions?.unopened.length === 0) {
        add('equals', conditions.properties.get('equals'))
        add('absent', conditions.properties.get('absent'))
      } else if (props) {
        // a choice the source writes out reads as written; a computed value is a gap
        add('props', props)
        if (!writtenOut(props)) unopened('states its Properties as', props)
      }
    }
  }
  const options = parts.options === undefined ? undefined : args[parts.options]
  if (!options) return { terms, gaps }
  const written = writtenObject(options)
  const given = written?.properties.get('name')
  const name = given && literalText(given)
  if (!written || (given && name === undefined))
    gaps.push(
      `names its failure with a value the reading cannot tell: ${quotedSource(given ?? options)}`,
    )
  return { terms, ...(name === undefined ? {} : { name }), gaps }
}

/** The array methods that call their callback once per item. */
const ITERATES = new Set([
  'forEach',
  'map',
  'flatMap',
  'filter',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'reduce',
  'reduceRight',
])

/** Whether a statement leaves its block on every path without throwing. */
function leaves(statement: Node | undefined): boolean {
  if (!statement) return false
  if (
    Node.isReturnStatement(statement) ||
    Node.isContinueStatement(statement) ||
    Node.isBreakStatement(statement)
  )
    return true
  return Node.isBlock(statement) && leaves(statement.getStatements().at(-1))
}

/**
 * The conditions and loops `node` is stated under in the function it is written in, outermost
 * first: each branch it is written in, each guard before it in a block it is in, each loop. A
 * callback an array calls once per item (`ids.forEach(…)`) is a loop of that function, read
 * through; any other function ends the reading. A guard that throws is no condition: where it
 * throws, nothing is built. Read as written: a branch the reading decides still reads as a
 * branch, and a helper called under a condition does not hand it to what the helper states.
 */
function conditionsAround(node: Node): PreconditionCondition[] {
  const under: PreconditionCondition[] = []
  const condition = (
    kind: PreconditionCondition['kind'],
    source: Node,
    text = folded(source),
  ): PreconditionCondition => ({ kind, source: text, line: source.getStartLineNumber() })
  let child: Node = node
  let parent = node.getParent()
  while (parent) {
    if (isCallable(parent)) {
      const call = parent.getParent()
      const callee = call && Node.isCallExpression(call) && unwrapExpression(call.getExpression())
      if (
        !call ||
        !callee ||
        !Node.isPropertyAccessExpression(callee) ||
        !ITERATES.has(callee.getName()) ||
        !call.getArguments().some((argument) => unwrapExpression(argument) === parent)
      )
        break
      under.unshift(condition('each', callee.getExpression()))
      child = call
      parent = call.getParent()
      continue
    }
    const here: PreconditionCondition[] = []
    if (Node.isIfStatement(parent)) {
      if (child === parent.getThenStatement()) here.push(condition('when', parent.getExpression()))
      else if (child === parent.getElseStatement())
        here.push(condition('unless', parent.getExpression()))
    } else if (Node.isConditionalExpression(parent)) {
      if (child === parent.getWhenTrue()) here.push(condition('when', parent.getCondition()))
      else if (child === parent.getWhenFalse())
        here.push(condition('unless', parent.getCondition()))
    } else if (Node.isBinaryExpression(parent) && child === parent.getRight()) {
      const operator = parent.getOperatorToken().getKind()
      const left = parent.getLeft()
      if (operator === SyntaxKind.AmpersandAmpersandToken) here.push(condition('when', left))
      else if (operator === SyntaxKind.BarBarToken) here.push(condition('unless', left))
      else if (operator === SyntaxKind.QuestionQuestionToken)
        here.push(condition('when', left, `${folded(left)} == null`))
    } else if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) {
      const choice = parent.getParent()?.getParent()
      if (Node.isSwitchStatement(choice)) {
        const subject = folded(choice.getExpression())
        const cases = (clauses: readonly Node[]) =>
          clauses
            .flatMap((clause) =>
              Node.isCaseClause(clause) ? [`${subject} === ${folded(clause.getExpression())}`] : [],
            )
            .join(' || ')
        if (Node.isCaseClause(parent))
          here.push(condition('when', parent.getExpression(), cases([parent])))
        else {
          const others = cases(choice.getClauses())
          if (others) here.push(condition('unless', choice.getExpression(), others))
        }
      }
    } else if (Node.isCatchClause(parent) && child === parent.getBlock()) {
      const attempt = parent.getParent()
      if (Node.isTryStatement(attempt)) {
        const first = attempt.getTryBlock().getStatements()[0]
        here.push(condition('caught', first ?? attempt, first ? folded(first) : 'try {}'))
      }
    } else if (
      (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) &&
      child === parent.getStatement()
    ) {
      here.push(condition('each', parent.getExpression()))
    } else if (Node.isForStatement(parent) && child === parent.getStatement()) {
      const test = parent.getCondition()
      here.push(test ? condition('each', test) : condition('each', parent, 'for (;;)'))
    } else if (
      (Node.isWhileStatement(parent) || Node.isDoStatement(parent)) &&
      child === parent.getStatement()
    ) {
      here.push(condition('each', parent.getExpression()))
    }
    // a guard before it that leaves the block on one side leaves it stated on the other only
    if (Node.isBlock(parent) || Node.isCaseClause(parent) || Node.isDefaultClause(parent))
      for (const sibling of parent.getStatements()) {
        if (sibling === child) break
        if (!Node.isIfStatement(sibling)) continue
        const otherwise = sibling.getElseStatement()
        if (!otherwise && leaves(sibling.getThenStatement()))
          here.push(condition('unless', sibling.getExpression()))
        else if (otherwise && leaves(otherwise) && !leaves(sibling.getThenStatement()))
          here.push(condition('when', sibling.getExpression()))
      }
    under.unshift(...here)
    child = parent
    parent = parent.getParent()
  }
  return under
}

function definitionKind(call: CallExpression): DefinitionLink['kind'] | undefined {
  const factory = curriedFactory(call)
  if (factory === 'defineQuery') return 'query'
  if (factory === 'defineMutation') return 'mutation'
  return undefined
}

/** A string written as a literal, or as a module-level constant holding one. */
function literalText(node: Node | undefined): string | undefined {
  const value = node && unwrapExpression(node)
  if (!value) return undefined
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))
    return value.getLiteralText()
  if (!Node.isIdentifier(value)) return undefined
  const resolved = valueOfIdentifier(value)
  const constant = resolved && unwrapExpression(resolved)
  return constant &&
    (Node.isStringLiteral(constant) || Node.isNoSubstitutionTemplateLiteral(constant))
    ? constant.getLiteralText()
    : undefined
}

/** An authored function a node is, or names. */
function callableOf(node: Node | undefined): Callable | undefined {
  const value = node && unwrapExpression(node)
  if (!value) return undefined
  if (isCallable(value)) return value
  if (!Node.isIdentifier(value)) return undefined
  const resolved = valueOfIdentifier(value)
  const callable = resolved && unwrapExpression(resolved)
  return callable && isCallable(callable) ? callable : undefined
}

/** The `build` of a defined Query or Mutation's options, written as a property or a method. */
function definedBuild(call: CallExpression): Callable | undefined {
  const options = call.getArguments()[1]
  const object = options && resolveObjectLiteral(options)
  const property = object?.getProperty('build')
  return callableOf(property && objectPropertyValue(property))
}

interface Read {
  id: string
  effects: DefinitionEffect[]
  preconditions: DefinitionPrecondition[]
  gaps: SourceGap[]
}

/**
 * Read one definition: its id and what its `build` does. A defined one names its id
 * first (`defineMutation()('id', { build(input, d, mutation) })`); a projected one
 * returns it from a function of the resolved Domain
 * (`defineMutation()((Domain) => ({ id, build(input, mutation) }))`), whose `build`
 * closes over that function's names.
 */
function readDefinition(
  call: CallExpression,
  kind: DefinitionLink['kind'],
  context: { model: Model; domainRoot: string; cache: FlowCache },
): Read | undefined {
  const { language, effects, preconditions, unnamed } = definitionLanguage({ kind, ...context })
  const session = flowSession(language, context.domainRoot, context.cache)
  const first = call.getArguments()[0]
  const projector = first && callableOf(first)
  let id: string | undefined
  let build: Callable | FunctionFlow<Value> | undefined
  let flows: Array<Value | undefined>
  if (projector) {
    const projected = session.read(projector, [DOMAIN])
    id = single(propertyOf(projected, 'id'))
    const written = propertyOf(projected, 'build')
    build = written && isFunctionFlow(written) ? written : undefined
    flows = kind === 'mutation' ? [undefined, BUILDER] : [undefined]
  } else {
    id = literalText(first)
    build = definedBuild(call)
    flows = [undefined, HANDLES, kind === 'mutation' ? BUILDER : STEPS]
  }
  if (id === undefined) return undefined
  if (build) session.read(build, flows)
  else session.gap(call, 'has no `build` the reading can find')
  for (const { at, text } of unnamed())
    session.gap(at, `starts from Nodes whose Class the source does not name: ${text}`)
  let gaps = session.gaps()
  if (effects.length === 0 && gaps.length === 0) {
    session.gap(
      call,
      `the reading finds nothing its \`build\` ${kind === 'query' ? 'reads' : 'does'}`,
    )
    gaps = session.gaps()
  }
  return { id, effects, preconditions: [...preconditions.values()], gaps }
}

/**
 * Discover `defineQuery()` and `defineMutation()` declarations anywhere in the
 * Domain's authored sources, with what each does to which Class. The ids are the
 * Domain's own; nothing is admitted. Without the IR, Classes keep the names the
 * sources give them and no named relation is followed.
 */
export function readDefinitions(args: {
  domainRoot: string
  project: Project
  ir?: SchemaIR | null
  /** dependency alias → origin, as the Schema declares them */
  dependencies?: Readonly<Record<string, string>>
  cache?: FlowCache
}): DefinitionReading {
  const { domainRoot, project } = args
  const definitions: DefinitionLink[] = []
  const idByDeclaration = new Map<string, string>()
  if (!domainRoot) return { definitions, idByDeclaration }
  const context = {
    model: modelOf(args.ir ?? null, new Map(Object.entries(args.dependencies ?? {}))),
    domainRoot,
    cache: args.cache ?? flowCache(),
  }
  const sources = authoredTypeScriptFiles(domainRoot)
    .map((file) => tryAddFile(project, file))
    .filter((source): source is SourceFile => source !== undefined)

  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const kind = definitionKind(call)
      if (!kind || idByDeclaration.has(nodeKey(call))) continue
      const reading = readDefinition(call, kind, context)
      if (!reading) continue
      const name = bindingName(call)
      const statement = call.getFirstAncestorByKind(SyntaxKind.VariableStatement)
      const doc = statement ? leadingDoc(statement) : undefined
      const link: DefinitionLink = {
        kind,
        id: reading.id,
        file: relToRoot(domainRoot, source.getFilePath()),
        line: call.getStartLineNumber(),
        classes: unique(reading.effects.map((effect) => effect.class)),
      }
      if (name) link.name = name
      if (doc) link.doc = doc
      if (reading.effects.length > 0) link.effects = reading.effects
      if (reading.preconditions.length > 0) link.preconditions = reading.preconditions
      if (reading.gaps.length > 0) link.gaps = reading.gaps
      definitions.push(link)
      idByDeclaration.set(nodeKey(call), reading.id)
    }
  }

  definitions.sort((left, right) => left.id.localeCompare(right.id))
  return { definitions, idByDeclaration }
}
