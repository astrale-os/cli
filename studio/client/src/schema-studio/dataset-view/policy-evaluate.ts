/**
 * policy-evaluate.ts — prove a Policy on a Dataset.
 *
 * A V1 Policy is a connected pattern of edge steps between terms; proving it is a bounded
 * search for bindings of those terms to Dataset nodes. The evaluator threads one immutable
 * binding map through the pattern: a step with a bound end walks the graph from it, a step
 * with both ends free enumerates the edges of its class, `exists` scopes the variables it
 * introduces, `allOf` chains solutions and `anyOf` concatenates them. Composed policies
 * (`allOf` / `anyOf` of refs) resolve through the domain's policy index.
 *
 * Nothing here is authoritative: the kernel decides on a real instance, over grants as well
 * as policies. This is the explanation the Studio can draw — every proof that exists in the
 * demo data, or the one proof (or its absence) between a picked subject and object.
 */
import { schemaRefKey } from '@shared/types'

import {
  type Policy,
  type PolicyEdgeStep,
  type PolicyIndex,
  type PolicyPattern,
  type PolicyTerm,
  type PolicyVariable,
  policyGuard,
} from '@/lib/policy'

import type { DataEdge, DataGraph } from './policy-graph'

/** What a policy is asked about: a node, or an edge given by its Dataset index. */
export type PolicyObject = { kind: 'node'; id: string } | { kind: 'edge'; index: number }

export interface PolicyProbe {
  subject?: string | null
  object?: PolicyObject | null
}

/** One complete proof: who, over what, and the exact edges that carried it. */
export interface PolicyProof {
  subject: string | null
  object: PolicyObject | null
  edges: number[]
  nodes: string[]
}

export type PolicyEvaluation =
  | { status: 'ok'; proofs: PolicyProof[]; truncated: boolean }
  | { status: 'unsupported'; reason: string }

/** Proofs are enumerated, so a pathological pattern on a big Dataset stops here. */
export const PROOF_LIMIT = 2000
/** Mirrors the public `POLICY_V1_BUDGETS.patternDepth` contract. */
const MAX_EXPANDED_POLICY_DEPTH = 8

class Unsupported extends Error {}

type Bindings = ReadonlyMap<string, string>
interface Solution {
  bindings: Bindings
  edges: number[]
}

const bind = (bindings: Bindings, key: string, id: string): Bindings =>
  new Map(bindings).set(key, id)

/** Bind a term a proof discovered — refused when it would make a non-principal the subject. */
const discover = (
  graph: DataGraph,
  bindings: Bindings,
  key: string,
  id: string,
): Bindings | null =>
  key === 'subject' && !graph.mayBeSubject(id) ? null : bind(bindings, key, id)

/** Variables are local to the policy that declares them; reserved terms are shared. */
const termKey = (term: PolicyTerm, scope: string): string =>
  term.kind === 'variable' ? `${scope}#${term.id}` : term.kind

const otherEnd = (edge: DataEdge, node: string): string =>
  edge.from === node ? edge.to : edge.from

/**
 * Walk `name` edges from `start`, forward along their direction or backward against it, and
 * yield every simple path whose length lies within the bounds — ending at `goal` when given.
 */
function* walk(
  graph: DataGraph,
  name: string,
  start: string,
  direction: 'forward' | 'backward',
  goal: string | undefined,
  min: number,
  max: number,
  bindings: Bindings,
  endKey: string,
): Generator<Solution> {
  const adjacency = direction === 'forward' ? graph.outgoing : graph.incoming
  const path: number[] = []
  const visited = new Set<string>([start])
  function* step(current: string, depth: number): Generator<Solution> {
    if (depth >= min && (goal === undefined || current === goal)) {
      const bound = discover(graph, bindings, endKey, current)
      if (bound) yield { bindings: bound, edges: [...path] }
    }
    if (depth >= max) return
    for (const edge of adjacency.get(current) ?? []) {
      if (edge.edgeName !== name) continue
      const next = otherEnd(edge, current)
      if (visited.has(next)) continue
      visited.add(next)
      path.push(edge.index)
      yield* step(next, depth + 1)
      path.pop()
      visited.delete(next)
    }
  }
  yield* step(start, 0)
}

function* solveStep(
  step: PolicyEdgeStep,
  bindings: Bindings,
  scope: string,
  graph: DataGraph,
): Generator<Solution> {
  const sourceKey = termKey(step.source, scope)
  const targetKey = termKey(step.target, scope)
  const source = bindings.get(sourceKey)
  const target = bindings.get(targetKey)
  const name = graph.nameOf(step.class)
  const min = step.repeat?.min ?? 1
  const max = step.repeat?.max ?? 1

  // Both ends discovered at once — the one-hop and zero-hop cases with nothing bound.
  const pair = (from: string, to: string): Bindings | null => {
    const first = discover(graph, bindings, sourceKey, from)
    return first && discover(graph, first, targetKey, to)
  }

  // A zero-length walk: both ends are the same node.
  if (min === 0) {
    if (source !== undefined && target !== undefined) {
      if (source === target) yield { bindings, edges: [] }
    } else if (source !== undefined) {
      const bound = discover(graph, bindings, targetKey, source)
      if (bound) yield { bindings: bound, edges: [] }
    } else if (target !== undefined) {
      const bound = discover(graph, bindings, sourceKey, target)
      if (bound) yield { bindings: bound, edges: [] }
    } else {
      for (const id of graph.nodeIds) {
        const bound = pair(id, id)
        if (bound) yield { bindings: bound, edges: [] }
      }
    }
  }
  if (max === 0) return
  const atLeast = Math.max(min, 1)

  if (source !== undefined) {
    yield* walk(graph, name, source, 'forward', target, atLeast, max, bindings, targetKey)
  } else if (target !== undefined) {
    yield* walk(graph, name, target, 'backward', undefined, atLeast, max, bindings, sourceKey)
  } else if (max === 1) {
    // both ends free, one hop: every edge of the class, in the orientations it admits
    for (const edge of graph.byClass.get(name) ?? []) {
      const forward = pair(edge.from, edge.to)
      if (forward) yield { bindings: forward, edges: [edge.index] }
      if (edge.undirected && edge.from !== edge.to) {
        const backward = pair(edge.to, edge.from)
        if (backward) yield { bindings: backward, edges: [edge.index] }
      }
    }
  } else {
    for (const start of graph.nodeIds) {
      const seeded = discover(graph, bindings, sourceKey, start)
      if (seeded)
        yield* walk(graph, name, start, 'forward', undefined, atLeast, max, seeded, targetKey)
    }
  }
}

function* solveAll(
  patterns: PolicyPattern[],
  at: number,
  bindings: Bindings,
  edges: number[],
  scope: string,
  graph: DataGraph,
): Generator<Solution> {
  if (at === patterns.length) {
    yield { bindings, edges }
    return
  }
  for (const solution of solvePattern(patterns[at], bindings, scope, graph)) {
    yield* solveAll(
      patterns,
      at + 1,
      solution.bindings,
      [...edges, ...solution.edges],
      scope,
      graph,
    )
  }
}

/** A variable no step mentions is satisfied by any node of its class. */
function* bindFree(
  variables: PolicyVariable[],
  at: number,
  solution: Solution,
  scope: string,
  graph: DataGraph,
): Generator<Solution> {
  if (at === variables.length) {
    yield solution
    return
  }
  const variable = variables[at]
  for (const id of graph.nodeIds) {
    if (!graph.isInstance(id, variable.class)) continue
    yield* bindFree(
      variables,
      at + 1,
      { ...solution, bindings: bind(solution.bindings, termKey(variable.variable, scope), id) },
      scope,
      graph,
    )
  }
}

function* solvePattern(
  pattern: PolicyPattern,
  bindings: Bindings,
  scope: string,
  graph: DataGraph,
): Generator<Solution> {
  if ('allOf' in pattern) {
    yield* solveAll(pattern.allOf, 0, bindings, [], scope, graph)
  } else if ('anyOf' in pattern) {
    for (const alternative of pattern.anyOf)
      yield* solvePattern(alternative, bindings, scope, graph)
  } else if ('exists' in pattern) {
    const { nodes, where } = pattern.exists
    for (const solution of solvePattern(where, bindings, scope, graph)) {
      const free: PolicyVariable[] = []
      let admitted = true
      for (const variable of nodes) {
        const id = solution.bindings.get(termKey(variable.variable, scope))
        if (id === undefined) free.push(variable)
        else if (!graph.isInstance(id, variable.class)) {
          admitted = false
          break
        }
      }
      if (!admitted) continue
      yield* bindFree(free, 0, solution, scope, graph)
    }
  } else {
    yield* solveStep(pattern, bindings, scope, graph)
  }
}

interface Context {
  index: PolicyIndex
  graph: DataGraph
}

function resolveRefs(refs: Policy['ref'][], context: Context): Policy[] {
  return refs.map((ref) => {
    const policy = context.index.byKey.get(schemaRefKey(ref))
    if (!policy)
      throw new Unsupported(`references a policy this domain does not declare: ${ref.name}`)
    return policy
  })
}

function patternDepth(pattern: PolicyPattern): number {
  if ('source' in pattern) return 1
  if ('exists' in pattern) return 1 + patternDepth(pattern.exists.where)
  const children = 'allOf' in pattern ? pattern.allOf : pattern.anyOf
  return 1 + Math.max(0, ...children.map(patternDepth))
}

function expandedPolicyDepth(
  policy: Policy,
  context: Context,
  visiting = new Set<string>(),
): number {
  const key = schemaRefKey(policy.ref)
  if (visiting.has(key)) throw new Unsupported('policy composition is cyclic')
  if ('match' in policy.expression) return patternDepth(policy.expression.match)
  const nested = new Set(visiting)
  nested.add(key)
  const refs = 'allOf' in policy.expression ? policy.expression.allOf : policy.expression.anyOf
  return (
    1 +
    Math.max(
      0,
      ...resolveRefs(refs, context).map((child) => expandedPolicyDepth(child, context, nested)),
    )
  )
}

function* solvePolicies(
  policies: Policy[],
  at: number,
  bindings: Bindings,
  edges: number[],
  context: Context,
): Generator<Solution> {
  if (at === policies.length) {
    yield { bindings, edges }
    return
  }
  for (const solution of solveExpression(policies[at], bindings, context)) {
    yield* solvePolicies(
      policies,
      at + 1,
      solution.bindings,
      [...edges, ...solution.edges],
      context,
    )
  }
}

function* solveExpression(
  policy: Policy,
  bindings: Bindings,
  context: Context,
): Generator<Solution> {
  const scope = schemaRefKey(policy.ref)
  const expression = policy.expression
  if ('match' in expression) {
    yield* solvePattern(expression.match, bindings, scope, context.graph)
    return
  }
  if ('allOf' in expression) {
    yield* solvePolicies(resolveRefs(expression.allOf, context), 0, bindings, [], context)
    return
  }
  for (const alternative of resolveRefs(expression.anyOf, context)) {
    yield* solveExpression(alternative, bindings, context)
  }
}

export const objectKey = (object: PolicyObject | null): string =>
  object === null ? '' : object.kind === 'node' ? `node:${object.id}` : `edge:${object.index}`

export function evaluatePolicy(input: {
  policy: Policy
  index: PolicyIndex
  graph: DataGraph
  probe?: PolicyProbe
  /** Dataset edge names whose traversal this policy guards — the objects of an edge policy. */
  guardedEdges?: readonly string[]
}): PolicyEvaluation {
  const { policy, index, graph, probe, guardedEdges } = input
  const context: Context = { index, graph }
  let guard: ReturnType<typeof policyGuard>
  try {
    const depth = expandedPolicyDepth(policy, context)
    if (depth > MAX_EXPANDED_POLICY_DEPTH) {
      return {
        status: 'unsupported',
        reason: `expanded policy depth ${String(depth)} exceeds ${String(MAX_EXPANDED_POLICY_DEPTH)}`,
      }
    }
    guard = policyGuard(policy, index)
  } catch (error) {
    if (error instanceof Unsupported) return { status: 'unsupported', reason: error.message }
    throw error
  }
  const base = new Map<string, string>()
  if (probe?.subject) base.set('subject', probe.subject)

  const objects: (PolicyObject | null)[] = []
  if (guard === 'edge') {
    if (probe?.object?.kind === 'node') {
      return { status: 'unsupported', reason: 'this policy guards an edge, not a node' }
    }
    if (probe?.object) objects.push(probe.object)
    else {
      const names = guardedEdges?.length ? new Set(guardedEdges) : null
      for (const edge of graph.edges) {
        if (!names || names.has(edge.edgeName)) objects.push({ kind: 'edge', index: edge.index })
      }
    }
  } else if (guard === 'object') {
    if (probe?.object?.kind === 'edge') {
      return { status: 'unsupported', reason: 'this policy guards a node, not an edge' }
    }
    objects.push(probe?.object ?? null)
  } else {
    objects.push(null)
  }

  const proofs: PolicyProof[] = []
  const seen = new Set<string>()
  let truncated = false
  try {
    search: for (const object of objects) {
      let bindings: Bindings = base
      if (object?.kind === 'node') bindings = bind(bindings, 'object', object.id)
      if (object?.kind === 'edge') {
        const edge = graph.edges[object.index]
        if (!edge) continue
        bindings = bind(bind(bindings, 'source', edge.from), 'target', edge.to)
      }
      for (const solution of solveExpression(policy, bindings, context)) {
        const subject = solution.bindings.get('subject') ?? null
        const boundObject = solution.bindings.get('object')
        const proofObject: PolicyObject | null =
          object ?? (boundObject !== undefined ? { kind: 'node', id: boundObject } : null)
        // the protected edge itself belongs to the picture: it is what the proof unlocks
        const edgeSet = new Set(solution.edges)
        if (object?.kind === 'edge') edgeSet.add(object.index)
        const edges = [...edgeSet].sort((left, right) => left - right)
        const key = `${subject ?? ''}|${objectKey(proofObject)}|${edges.join(',')}`
        if (seen.has(key)) continue
        seen.add(key)
        const nodes = new Set<string>(solution.bindings.values())
        for (const at of edges) {
          nodes.add(graph.edges[at].from)
          nodes.add(graph.edges[at].to)
        }
        proofs.push({ subject, object: proofObject, edges, nodes: [...nodes] })
        if (proofs.length >= PROOF_LIMIT) {
          truncated = true
          break search
        }
      }
    }
  } catch (error) {
    if (error instanceof Unsupported) return { status: 'unsupported', reason: error.message }
    throw error
  }
  return { status: 'ok', proofs, truncated }
}

/** Proofs folded per (subject, object) pair — one row of the panel, one lit region of the canvas. */
export interface PolicyMatch {
  subject: string | null
  object: PolicyObject | null
  edges: Set<number>
  nodes: Set<string>
  proofs: number
}

export function groupProofs(proofs: readonly PolicyProof[]): PolicyMatch[] {
  const byPair = new Map<string, PolicyMatch>()
  for (const proof of proofs) {
    const key = `${proof.subject ?? ''}|${objectKey(proof.object)}`
    let match = byPair.get(key)
    if (!match) {
      match = {
        subject: proof.subject,
        object: proof.object,
        edges: new Set(),
        nodes: new Set(),
        proofs: 0,
      }
      byPair.set(key, match)
    }
    for (const edge of proof.edges) match.edges.add(edge)
    for (const node of proof.nodes) match.nodes.add(node)
    match.proofs += 1
  }
  return [...byPair.values()]
}
