/**
 * A call asked of a dataset: one of the Domain's functions, the Node it is called on and who
 * calls. The answer is what the Kernel would say (may this identity call it here, and by which
 * rule) and what the function is declared to write, with the slice of the dataset the call
 * concerns: the Node, the caller, what proves the verdict, and what the Node already holds of the
 * relationships and Classes the function writes. Nothing is applied: a call's writes are read
 * from its source as declared.
 */

import type { ScenarioStep } from '@shared/contracts/scenarios'
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import type { SceneEntry } from '../../scene/types'
import type { DatasetModel } from '../model'
import type { JudgedStep } from '../scenarios'
import type { Why } from './fill'

import { behaviorModel } from '../../lenses/behavior'
import { indexOfEdgeId } from '../model'
import { isA } from './shape'

/** How many Nodes around the one called on a call's slice holds. */
export const CALL_SLICE = 48

export interface Callable {
  /** the handler key: `Class.method`, or a Domain function's name */
  readonly key: string
  /** the Schema's selection id for it */
  readonly target: string
  readonly label: string
  /** the Class a Method is declared on; none for a Domain function */
  readonly owner?: string
  /** called on no Node: a static Method, or a Domain function */
  readonly static: boolean
}

export interface CallQuestion {
  readonly fn: string
  /** the Node it is called on, by path; none for a static one */
  readonly on?: string
  /** who calls: an identity Node's path, or anyone */
  readonly as: string
}

/** The Domain's functions, as handlers key them, in the Behavior lens's order. */
export function callablesOf(bundle: StudioSchemaBundle): Callable[] {
  if (!bundle.ir) return []
  return behaviorModel(bundle).functions.map((fn) => ({
    key: fn.key,
    target: fn.id,
    label: fn.label,
    ...(fn.owner ? { owner: fn.owner } : {}),
    static: fn.owner ? (bundle.ir!.classes[fn.owner]?.methods?.[fn.label]?.static ?? false) : true,
  }))
}

/** The question as the step a Scenario would keep. */
export const stepOf = (question: CallQuestion): ScenarioStep => ({
  id: 'ask',
  as: question.as,
  expect: 'allowed',
  does: 'call',
  fn: question.fn,
  ...(question.on === undefined ? {} : { on: { node: question.on } }),
})

/** The Nodes a Method can be called on: those of its Class, or of one that descends from it. */
export function targetsOf(
  model: DatasetModel,
  bundle: StudioSchemaBundle,
  callable: Callable,
): string[] {
  if (callable.static || !callable.owner || !bundle.ir) return []
  const owner = { origin: bundle.ir.domain, kind: 'class' as const, name: callable.owner }
  return model.classes
    .filter((cls) => isA(bundle, { origin: cls.origin, kind: 'class', name: cls.name }, owner))
    .flatMap((cls) => cls.nodes)
}

/**
 * The Node a call is asked on when the reader has not said: the one selected, when the Method
 * takes it; else one the dataset names; else the one that holds most, where a call shows most.
 */
export function pickTarget(
  model: DatasetModel,
  bundle: StudioSchemaBundle,
  callable: Callable,
  selected?: string,
): { readonly path: string; readonly why: Why } | undefined {
  const targets = targetsOf(model, bundle, callable)
  if (targets.length === 0) return undefined
  if (selected !== undefined && targets.includes(selected))
    return { path: selected, why: { kind: 'selected' } }
  const named = targets.find((path) => (model.nodes.get(path)?.variables.length ?? 0) > 0)
  if (named)
    return { path: named, why: { kind: 'named', variable: model.nodes.get(named)!.variables[0]! } }
  const edges = (path: string) =>
    (model.outgoing.get(path)?.length ?? 0) + (model.incoming.get(path)?.length ?? 0)
  const fullest = targets.reduce((best, path) => (edges(path) > edges(best) ? path : best))
  return { path: fullest, why: { kind: 'richest', nodes: edges(fullest) + 1, classes: 1 } }
}

export interface CallSlice {
  readonly nodes: ReadonlySet<string>
  /** Edges by their place in the dataset */
  readonly edges: ReadonlySet<number>
}

/**
 * What a call concerns of the dataset: the Node, who calls, what the verdict stands on, and the
 * Node's links of the relationships the function writes or to Nodes of the Classes it writes.
 */
export function callSlice(
  model: DatasetModel,
  judged: JudgedStep,
  question: CallQuestion,
): CallSlice {
  const nodes = new Set<string>()
  const edges = new Set<number>()
  const hold = (path: string) => {
    if (model.nodes.has(path)) nodes.add(path)
  }
  if (question.on !== undefined) hold(question.on)
  if (judged.facts.actor !== undefined) hold(judged.facts.actor)
  for (const path of judged.verdict?.proof.nodes ?? []) hold(path)
  for (const id of judged.verdict?.proof.edges ?? []) {
    const index = indexOfEdgeId(id)
    const edge = index === undefined ? undefined : model.edges[index]
    if (!edge) continue
    edges.add(edge.index)
    hold(edge.from)
    hold(edge.to)
  }
  const written = new Set<string>()
  const regions = new Set<string>()
  for (const change of judged.declared?.changes ?? []) {
    for (const relationship of change.relationships) written.add(relationship.target)
    for (const region of change.regions) regions.add(region)
  }
  if (question.on !== undefined) {
    const around = [
      ...(model.outgoing.get(question.on) ?? []).map((edge) => ({ edge, other: edge.to })),
      ...(model.incoming.get(question.on) ?? []).map((edge) => ({ edge, other: edge.from })),
    ]
    for (const { edge, other } of around) {
      if (nodes.size >= CALL_SLICE) break
      const region = model.classOf.get(other)?.target
      if (!written.has(edge.relationTarget) && !(region !== undefined && regions.has(region)))
        continue
      if (!model.nodes.has(other)) continue
      edges.add(edge.index)
      nodes.add(other)
    }
  }
  return { nodes, edges }
}

/** The Index group the Behavior lens lists a dataset's callable functions under. */
export const FUNCTIONS_GROUP = 'ask.functions'

/** A function's Index entry id: the Schema's selection id for it. */
export const isCallEntry = (id: string) => id.startsWith('function.')

/** The Domain's functions as Index entries: one picked is asked of the dataset. */
export function callEntries(bundle: StudioSchemaBundle): SceneEntry[] {
  return callablesOf(bundle).map((callable) => ({
    id: callable.target,
    kind: 'function',
    label: callable.label,
    ...(callable.owner ? { sublabel: callable.owner } : {}),
    group: FUNCTIONS_GROUP,
    tone: 'fn' as const,
    icon: { glyph: 'function' as const },
    keywords: [callable.key],
  }))
}

/** The handler key of a function's Index entry. */
export function callKeyOf(bundle: StudioSchemaBundle, entry: string): string | undefined {
  return callablesOf(bundle).find((callable) => callable.target === entry)?.key
}
