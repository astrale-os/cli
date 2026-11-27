/**
 * A rule's walk on a dataset: each step the stage numbers (`walkStepsOf`) at the Node or Edge of
 * the dataset it stands at in the case explained (`explainCase`). A start stands at the Node or
 * Edge its entity is bound to, or at the end it reaches; a step that follows or joins a
 * relationship at the Edge that makes it hold; an end at the Node it reaches; a step that
 * reaches the caller, at the caller too. A step the case does not reach — a link that does not
 * hold, an alternative not taken, a path's repeated steps — stands at nothing, and keeps its
 * number: the map leaves it out, never renumbers the others.
 */

import type { Data, FactId, Key, NodeId, Rule, Situation } from '@astrale-os/visual'

import { explainCase, isTrace } from '@astrale-os/visual'

import type { OwnWalk } from '../scene/rules'
import type { SceneTone } from '../scene/types'
import type { DataScene } from './project'

import { walkStepsOf } from '../lenses/rule-walk'
import { indexOfEdgeId } from './model'
import { sceneIdsOf } from './project'

/** One step of the walk at what it stands at in the dataset: a Node's path or an Edge's id. */
export interface WalkFact {
  readonly number: number
  readonly fact: FactId
  /** the Node it arrives at past an Edge it follows */
  readonly arrives?: FactId
}

/** A Meaning node as the walk reads it: a link's two Terms, a Term's own entity or kind. */
interface Term {
  readonly kind: string
  readonly id: NodeId
  readonly entity?: string
}

/** Each `related` link of a Meaning by its id, with its relation and its two Terms. */
function linksOf(rule: Rule): Map<NodeId, { relation: Key; source: Term; target: Term }> {
  const links = new Map<NodeId, { relation: Key; source: Term; target: Term }>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) visit(each)
    else if (value !== null && typeof value === 'object') {
      const node = value as { kind?: unknown; id?: unknown }
      if (node.kind === 'related') {
        const { id, relation, source, target } = value as {
          id: NodeId
          relation: Key
          source: Term
          target: Term
        }
        links.set(id, { relation, source, target })
      }
      for (const each of Object.values(value)) visit(each)
    }
  }
  visit(rule.meaning.frame)
  return links
}

/**
 * The steps of `rule`'s walk at what they stand at in the dataset, for the case `fact` decided
 * in `situation`: none for a rule the data cannot decide.
 */
export function walkFactsOf(
  rule: Rule,
  data: Data,
  situation: Situation,
  fact: FactId | undefined,
): WalkFact[] {
  const trace = explainCase(rule, data, situation, fact)
  if (!isTrace(trace)) return []
  const facts = new Set([
    ...data.graph.nodes.map((node) => node.id),
    ...data.graph.edges.map((edge) => edge.id),
  ])
  const links = linksOf(rule)
  const { classes } = rule.catalogue.words.schema
  const isA = (cls: Key, relation: Key): boolean =>
    cls === relation || (classes[cls]?.extends ?? []).some((parent) => isA(parent, relation))
  const known = (value: unknown): FactId | undefined =>
    typeof value === 'string' && facts.has(value) ? value : undefined
  const bound = (entity: string | undefined) =>
    entity !== undefined && trace.standing[entity] !== 'candidate'
      ? known(trace.bindings[entity])
      : undefined
  const valueOf = (term: Term): FactId | undefined =>
    term.kind === 'subject'
      ? known(situation.subject)
      : (known(trace.values[term.id]) ?? (term.kind === 'ref' ? bound(term.entity) : undefined))

  // what the walk has met so far: a step that meets a place first arrives at the end not met yet
  const met = new Set<FactId>()
  return walkStepsOf(rule).flatMap((step): WalkFact[] => {
    const at = (found: FactId | undefined, arrives?: FactId): WalkFact[] => {
      if (found === undefined) return []
      met.add(found)
      if (arrives !== undefined) met.add(arrives)
      return [{ number: step.number, fact: found, ...(arrives === undefined ? {} : { arrives }) }]
    }
    switch (step.kind) {
      case 'start':
        return at(step.entity !== undefined ? bound(step.entity) : known(trace.values[step.node]))
      case 'end':
        return at(known(trace.values[step.node]))
      case 'follow':
      case 'join': {
        const link = links.get(step.node)
        if (link === undefined || trace.truth[step.node] !== true) return []
        const source = valueOf(link.source)
        const target = valueOf(link.target)
        const edge = data.graph.edges.find(
          (one) => one.source === source && one.target === target && isA(one.class, link.relation),
        )
        if (edge === undefined) return []
        const arrives = step.fresh
          ? [edge.source, edge.target].find((end) => !met.has(end))
          : undefined
        return at(edge.id, arrives)
      }
      default:
        return []
    }
  })
}

/**
 * The walk as the map draws it: what each step stands at, as the dataset's scene draws it, in
 * walking order, each step numbered beside it; none when no step stands on the map.
 */
export function walkOnMap(
  projection: DataScene,
  facts: readonly WalkFact[],
  tone: SceneTone,
): OwnWalk | undefined {
  const drawn = (fact: FactId) =>
    sceneIdsOf(
      projection,
      indexOfEdgeId(fact) === undefined
        ? { nodes: [fact], edges: [] }
        : { nodes: [], edges: [fact] },
    )[0]
  const walk: string[] = []
  const steps: { id: string; number: number }[] = []
  for (const step of facts) {
    const id = drawn(step.fact)
    if (id === undefined) continue
    steps.push({ id, number: step.number })
    for (const each of [id, ...(step.arrives === undefined ? [] : [drawn(step.arrives)])])
      if (each !== undefined && !walk.includes(each)) walk.push(each)
  }
  return walk.length > 0 ? { walk, steps, tone } : undefined
}

/** The number each Node or Edge of the walk is first met at: what a list of its Edges says beside each. */
export function numbersOf(facts: readonly WalkFact[]): ReadonlyMap<FactId, number> {
  const numbers = new Map<FactId, number>()
  for (const step of facts) if (!numbers.has(step.fact)) numbers.set(step.fact, step.number)
  return numbers
}
