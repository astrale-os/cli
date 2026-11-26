/**
 * The Domain outline: a pure reading of one Studio bundle, through one lens, as a
 * tree. It owns no state and renders nothing; `useOutline` walks it and the parts
 * draw it.
 */
import type {
  DefinitionLink,
  HandlerLink,
  IrCallable,
  IrClass,
  IrEndpoint,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import {
  isIrClassRef,
  isIrSchemaRef,
  schemaRefKey,
  type IrSchemaRef,
} from '@shared/schema/identity'

import { buildFunctionsModel } from '@/lib/functions'

import {
  callableKey,
  callableKeyOf,
  callableTarget,
  definitionTarget,
  definitionUsers,
} from '../definitions'
import { cardLabel, originLabel } from '../detail/model'
import { moduleHues, moduleLabel, moduleOfMember } from '../modules'

/**
 * What the outline shows of each module, flat.
 * - `relational`: the data — node Classes, each opening onto the rules on its data,
 *   and the relationships with their ends and constraints.
 * - `functional`: what runs — functions with the Class each is anchored on, then the
 *   queries, mutations and Views.
 */
export type OutlineLens = 'relational' | 'functional'

export const OUTLINE_LENSES: readonly OutlineLens[] = ['relational', 'functional']

export type OutlineKind =
  | 'module'
  | 'class'
  | 'link'
  | 'function'
  | 'query'
  | 'mutation'
  | 'view'
  | 'rule'

export interface OutlineNode {
  /** Unique in the tree: the path of keys from the root. */
  id: string
  kind: OutlineKind
  label: string
  /** A short second reading: a relationship's ends, a function's anchor, a rule's policy. */
  detail?: string
  description?: string
  /** A Class's own icon (raw SVG, sanitized when drawn). */
  svg?: string
  /**
   * The Studio selection this node opens: `class.X`, `function.X`, `view.X`, `policy.K`,
   * `query.<id>`, `mutation.<id>`, `module.<path>`.
   */
  target?: string
  /** True when the node points at a declaration whose home is another row, or no row. */
  reference?: boolean
  /** The hue of the module the node lives in. */
  hue?: number
  children: OutlineNode[]
}

/** The data operations a Class's rules govern, in the order a reader meets them. */
const SLOT_ORDER = ['read', 'traverse', 'create', 'update', 'delete']

const ROOT = 'root'

interface Module {
  path: string
  classes: string[]
  links: string[]
  functions: string[]
  views: string[]
  definitions: DefinitionLink[]
}

function emptyModule(path: string): Module {
  return { path, classes: [], links: [], functions: [], views: [], definitions: [] }
}

function byName(left: string, right: string): number {
  return left.localeCompare(right)
}

function policyRefOf(value: unknown): IrSchemaRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const check = (value as { check?: unknown }).check
  return isIrSchemaRef(check) ? check : undefined
}

/** The handler of each callable, keyed `Class.method` or by the Function's name. */
function handlersByCallable(links: readonly HandlerLink[]): Map<string, HandlerLink> {
  return new Map(links.map((link) => [callableKeyOf(link), link]))
}

/**
 * A definition lives in the module its id names (`issues.comment.delete` → `comment`):
 * the author's own filing. Failing that, with the first local Class its `build` names.
 */
function moduleOfDefinition(
  definition: DefinitionLink,
  classModule: ReadonlyMap<string, string>,
  modulesByName: ReadonlyMap<string, string>,
): string {
  for (const segment of definition.id.split('.').slice(1, -1)) {
    const path = modulesByName.get(segment)
    if (path) return path
  }
  for (const name of definition.classes) {
    const path = classModule.get(name)
    if (path) return path
  }
  return ROOT
}

/** One Class a relationship's end accepts; `origin` only when another Domain declares it. */
interface LinkEnd {
  name: string
  origin?: string
}

/** The Classes an end accepts, by exact ref: an import never passes for a local name. */
function endClasses(domain: string, endpoint: IrEndpoint | undefined): LinkEnd[] {
  if (!endpoint) return []
  if (endpoint.refs === undefined) return endpoint.types.map((name) => ({ name }))
  return endpoint.refs
    .filter(isIrClassRef)
    .map((ref) =>
      ref.origin === domain ? { name: ref.name } : { name: ref.name, origin: ref.origin },
    )
}

/**
 * One end as its row reads: its Classes, bare at home and `origin:Name` when imported,
 * with the count the end declares on its own side. An unconstrained count says nothing.
 */
function endLabel(domain: string, endpoint: IrEndpoint | undefined, side: 'source' | 'target') {
  const ends = endClasses(domain, endpoint)
  const names =
    ends.length === 0
      ? '?'
      : ends
          .map((end) =>
            end.origin === undefined ? end.name : `${originLabel(end.origin)}:${end.name}`,
          )
          .join(' | ')
  const count = cardLabel(endpoint?.cardinality)
  if (count === '*') return names
  return side === 'source' ? `${names} ${count}` : `${count} ${names}`
}

/** A relationship in one line: its ends, then each constraint on it. */
function relationshipLabel(domain: string, link: IrClass): string {
  const [source, target] = link.endpoints ?? []
  const arrow = link.orientation === 'undirected' ? '—' : '→'
  const constraints = [
    link.constraints?.noSelf ? 'no self' : undefined,
    link.constraints?.acyclic ? 'acyclic' : undefined,
  ].filter((value) => value !== undefined)
  return [
    `${endLabel(domain, source, 'source')} ${arrow} ${endLabel(domain, target, 'target')}`,
    ...constraints,
  ].join(' · ')
}

export interface OutlineInput {
  bundle: StudioSchemaBundle
  lens: OutlineLens
  schemaDir?: string
}

/**
 * The outline of one Domain: its modules, each holding flat what the lens shows. A
 * module with nothing in it is left out; declarations outside any module sit beside
 * the modules.
 */
export function buildOutline({ bundle, lens, schemaDir = 'schema' }: OutlineInput): OutlineNode[] {
  const ir = bundle.ir
  if (!ir) return []
  const hues = moduleHues(bundle, schemaDir)
  const modules = new Map<string, Module>()
  const moduleAt = (path: string) => {
    let module = modules.get(path)
    if (!module) {
      module = emptyModule(path)
      modules.set(path, module)
    }
    return module
  }

  const classModule = new Map<string, string>()
  for (const [name, value] of Object.entries(ir.classes)) {
    const path = moduleOfMember(bundle, value.type === 'edge' ? 'edge' : 'class', name, schemaDir)
    classModule.set(name, path)
    moduleAt(path)[value.type === 'edge' ? 'links' : 'classes'].push(name)
  }
  for (const name of Object.keys(ir.functions)) {
    moduleAt(moduleOfMember(bundle, 'function', name, schemaDir)).functions.push(name)
  }
  for (const name of Object.keys(ir.views)) {
    moduleAt(moduleOfMember(bundle, 'view', name, schemaDir)).views.push(name)
  }
  const modulesByName = new Map(
    [...modules.keys()]
      .filter((path) => path !== ROOT)
      .map((path) => [path.split('/').at(-1)!, path]),
  )
  for (const definition of bundle.overlay.definitions) {
    moduleAt(moduleOfDefinition(definition, classModule, modulesByName)).definitions.push(
      definition,
    )
  }

  const handlers = handlersByCallable(bundle.overlay.handlerLinks)
  const definitionsById = new Map(bundle.overlay.definitions.map((value) => [value.id, value]))
  const usersOfDefinition = definitionUsers(bundle.overlay.handlerLinks)
  const anchorsOfFunction = new Map(
    buildFunctionsModel(bundle).all.map((model) => [model.name, model.boundClasses]),
  )

  /** A policy as a rule row names it: bare at home, `origin:Name` when imported. */
  const policyName = (ref: IrSchemaRef) =>
    ref.origin === ir.domain ? ref.name : `${originLabel(ref.origin)}:${ref.name}`

  const node = (
    parent: string,
    key: string,
    value: Omit<OutlineNode, 'id' | 'children'>,
    children: OutlineNode[] = [],
  ): OutlineNode => ({
    id: `${parent}/${key}`,
    ...value,
    children,
  })

  /** The rule on each data operation of a Class, in the order a reader meets them. */
  const dataRules = (parent: string, value: IrClass, hue: number | undefined): OutlineNode[] =>
    Object.entries(value.policies ?? {})
      .sort(([left], [right]) => SLOT_ORDER.indexOf(left) - SLOT_ORDER.indexOf(right))
      .map(([slot, ref]) =>
        node(parent, `rule:${slot}`, {
          kind: 'rule',
          label: slot,
          detail: policyName(ref),
          target: `policy.${schemaRefKey(ref)}`,
          reference: true,
          hue,
        }),
      )

  const classNode = (parent: string, name: string, hue: number | undefined): OutlineNode => {
    const value = ir.classes[name]!
    const id = `${parent}/class:${name}`
    return {
      id,
      kind: 'class',
      label: name,
      ...(value.description ? { description: value.description } : {}),
      ...(value.icon ? { svg: value.icon } : {}),
      target: `class.${name}`,
      hue,
      children: dataRules(id, value, hue),
    }
  }

  const linkNode = (parent: string, name: string, hue: number | undefined): OutlineNode => {
    const value = ir.classes[name]!
    const id = `${parent}/link:${name}`
    return {
      id,
      kind: 'link',
      label: name,
      detail: relationshipLabel(ir.domain, value),
      ...(value.description ? { description: value.description } : {}),
      target: `class.${name}`,
      hue,
      children: dataRules(id, value, hue),
    }
  }

  /** What a function reaches: the functions it calls, the definitions it uses, its rule. */
  const reaches = (
    parent: string,
    key: string,
    callable: IrCallable,
    hue: number | undefined,
  ): OutlineNode[] => {
    const link = handlers.get(key)
    const calls = (link?.calls ?? []).map((other) =>
      node(parent, `calls:${other}`, {
        kind: 'function',
        label: other,
        detail: 'calls',
        target: callableTarget(other),
        reference: true,
        hue,
      }),
    )
    const uses = (link?.definitions ?? []).flatMap((id) => {
      const definition = definitionsById.get(id)
      return definition
        ? [
            node(parent, `uses:${id}`, {
              kind: definition.kind,
              label: definition.name ?? id,
              detail: 'uses',
              target: definitionTarget(definition),
              reference: true,
              hue,
            }),
          ]
        : []
    })
    const ref = policyRefOf(callable.policy)
    const rule = ref
      ? [
          node(parent, 'policy', {
            kind: 'rule',
            label: policyName(ref),
            detail: 'policy',
            target: `policy.${schemaRefKey(ref)}`,
            reference: true,
            hue,
          }),
        ]
      : []
    return [...calls, ...uses, ...rule]
  }

  /**
   * One function, whatever declares it. Its anchor rides beside its name: a method's
   * Class, or the Classes a Domain function's contract names.
   */
  const functionNode = (
    parent: string,
    key: string,
    label: string,
    callable: IrCallable,
    anchors: readonly string[],
    target: string,
    hue: number | undefined,
  ): OutlineNode => {
    const id = `${parent}/function:${key}`
    const anchor = anchors.join(', ')
    return {
      id,
      kind: 'function',
      label,
      ...(anchor ? { detail: anchor } : {}),
      ...(callable.description ? { description: callable.description } : {}),
      target,
      hue,
      children: reaches(id, key, callable, hue),
    }
  }

  const relational = (parent: string, module: Module, hue: number | undefined) => [
    ...[...module.classes].sort(byName).map((name) => classNode(parent, name, hue)),
    ...[...module.links].sort(byName).map((name) => linkNode(parent, name, hue)),
  ]

  const functional = (parent: string, module: Module, hue: number | undefined) => {
    const methods = [...module.classes, ...module.links].flatMap((owner) =>
      Object.entries(ir.classes[owner]!.methods).map(([method, callable]) =>
        functionNode(
          parent,
          callableKey(owner, method),
          method,
          callable,
          [callable.static ? `${owner} · static` : owner],
          `class.${owner}`,
          hue,
        ),
      ),
    )
    const functions = module.functions.map((name) =>
      functionNode(
        parent,
        name,
        name,
        ir.functions[name]!,
        anchorsOfFunction.get(name) ?? [],
        `function.${name}`,
        hue,
      ),
    )
    const definitions = (kind: DefinitionLink['kind']) =>
      module.definitions
        .filter((definition) => definition.kind === kind)
        .sort((left, right) => byName(left.name ?? left.id, right.name ?? right.id))
        .map((definition) => {
          const id = `${parent}/${kind}:${definition.id}`
          return {
            id,
            kind,
            label: definition.name ?? definition.id,
            ...(definition.name ? { detail: definition.id } : {}),
            ...(definition.doc ? { description: definition.doc } : {}),
            target: definitionTarget(definition),
            hue,
            children: (usersOfDefinition.get(definition.id) ?? []).map((key) =>
              node(id, `usedBy:${key}`, {
                kind: 'function',
                label: key,
                detail: 'used by',
                target: callableTarget(key),
                reference: true,
                hue,
              }),
            ),
          }
        })
    const views = [...module.views].sort(byName).map((name) =>
      node(parent, `view:${name}`, {
        kind: 'view',
        label: name,
        ...(ir.views[name]!.description ? { description: ir.views[name]!.description } : {}),
        target: `view.${name}`,
        hue,
      }),
    )
    return [
      ...[...methods, ...functions].sort((left, right) => byName(left.label, right.label)),
      ...definitions('query'),
      ...definitions('mutation'),
      ...views,
    ]
  }

  const contents = lens === 'relational' ? relational : functional

  const tree = [...modules.values()]
    .filter((module) => module.path !== ROOT)
    .sort((left, right) => byName(left.path, right.path))
    .flatMap((module) => {
      const id = `module:${module.path}`
      const hue = hues.get(module.path)
      const children = contents(id, module, hue)
      return children.length > 0
        ? [
            {
              id,
              kind: 'module' as const,
              label: moduleLabel(module.path, schemaDir),
              target: `module.${module.path}`,
              hue,
              children,
            },
          ]
        : []
    })
  // Declarations outside any module sit beside the modules, as the Studio tree shows them.
  const root = modules.get(ROOT)
  return root ? [...tree, ...contents(ROOT, root, undefined)] : tree
}
