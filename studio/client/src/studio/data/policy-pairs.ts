/**
 * What one Policy admits on a dataset: each pair of an identity of the dataset, or anyone, and a
 * Node or Edge the Policy is decided over — admitted, not admitted, or can't tell —, as
 * `@astrale-os/visual` decides the Policy for that caller. A Policy that reads no caller is
 * decided once, whoever asks: its pairs name no identity. This module only asks, and never
 * guesses: a decision the reader made for another caller or object than the one asked is can't
 * tell.
 *
 * A pair is what the Policy says, not what the Kernel answers: the verdicts at the places the
 * Policy sits (`pairVerdicts`) also weigh the rest of each place's rule, the Domain that declares
 * it and the Kernel's defaults, and are what a Scenario step pins. A pair is explained as its own
 * case (`pairCase`): the Edges that admit it, or the condition that fails first — never another
 * case's explanation.
 */

import type { Key, Rule, Situation } from '@astrale-os/visual'

import { check, readsCaller, situationFor, targetsOf, undecidableWords } from '@astrale-os/visual'
import { ANYONE } from '@shared/contracts/scenarios'

import type { PolicyRule, Unread } from '../rules/model'

import { callableKey } from '../../schema-studio/definitions'
import { checkCase, type RuleVerdict } from '../rules/check'
import {
  type Access,
  type Outcome,
  type Verdict,
  callVerdict,
  edgeVerdict,
  failingWhy,
  outcomeOf,
  type PathStep,
  pathOf,
  readVerdict,
  subjectOf,
} from './access'
import { endLabel, identityLabel, indexOfEdgeId } from './model'

export interface PolicyPair {
  /** `<identity>|<object>`, unique among the Policy's pairs */
  readonly id: string
  /** the identity decided as: a Node's path, or `ANYONE`; none when the Policy reads no caller */
  readonly identity?: string
  /** the Node's path or the Edge's id (`core.edge.<i>`) it is decided over; none when the Policy names none */
  readonly object?: string
  readonly outcome: Outcome
  /** the pair in one sentence */
  readonly sentence: string
  /** why it can't tell */
  readonly why?: string
}

export interface PolicyPairs {
  readonly policy: Key
  /** why the Policy cannot be decided at all: then it has no pair */
  readonly unread?: Unread
  /** whether the Policy reads its caller: when it does not, each pair is anyone's alike */
  readonly readsCaller: boolean
  /** each pair decided so far: identity by identity in the level's order, objects in the reader's */
  readonly pairs: readonly PolicyPair[]
  readonly admitted: number
  readonly refused: number
  readonly unknown: number
  /** identities not decided yet; 0 once every pair is */
  readonly pending: number
}

interface PairsState {
  readonly readsCaller: boolean
  /** who is asked, in order; one `undefined` when the Policy reads no caller */
  readonly subjects: readonly (string | undefined)[]
  readonly pairs: PolicyPair[]
  next: number
  last?: PolicyPairs
}

/**
 * Each Policy's pairs decided so far, per Access: a Policy's identities are decided once per
 * dataset, bundle and moment. The entry goes with its Access — a new bundle reply, another
 * dataset, or the level opened again —, never while the same one is read.
 */
const decided = new WeakMap<Access, Map<Key, PairsState>>()

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/**
 * The pairs of `policy` on the dataset, decided identity by identity for at most `budgetMs`;
 * later calls go on where the last stopped. A Policy the reader cannot read has none, and says why.
 */
export function policyPairsSoFar(
  access: Access,
  policy: PolicyRule,
  budgetMs = Number.POSITIVE_INFINITY,
  clock: () => number = now,
): PolicyPairs {
  if (policy.reading.status === 'unread')
    return {
      policy: policy.key,
      unread: policy.reading,
      readsCaller: false,
      pairs: [],
      admitted: 0,
      refused: 0,
      unknown: 0,
      pending: 0,
    }
  const rule = policy.reading.rule
  let byPolicy = decided.get(access)
  if (!byPolicy) decided.set(access, (byPolicy = new Map()))
  let state = byPolicy.get(policy.key)
  if (!state) {
    const caller = readsCaller(rule)
    state = {
      readsCaller: caller,
      subjects: caller
        ? [
            ...access.identities.map((one) => one.id),
            ...(access.anyone === undefined ? [] : [ANYONE]),
          ]
        : [undefined],
      pairs: [],
      next: 0,
    }
    byPolicy.set(policy.key, state)
  }
  if (state.last && state.next >= state.subjects.length) return state.last
  const started = clock()
  const before = state.next
  while (state.next < state.subjects.length) {
    state.pairs.push(...pairsOf(access, policy, rule, state.subjects[state.next]))
    state.next += 1
    if (clock() - started >= budgetMs) break
  }
  if (state.last && state.next === before) return state.last
  const count = (outcome: Outcome) => state.pairs.filter((pair) => pair.outcome === outcome).length
  state.last = {
    policy: policy.key,
    readsCaller: state.readsCaller,
    pairs: [...state.pairs],
    admitted: count('allowed'),
    refused: count('refused'),
    unknown: count('unknown'),
    pending: state.subjects.length - state.next,
  }
  return state.last
}

/** One identity's pairs: one per object the Policy is decided over, or one that names none. */
function pairsOf(
  access: Access,
  policy: PolicyRule,
  rule: Rule,
  identity: string | undefined,
): PolicyPair[] {
  const who = identity === undefined ? undefined : identityLabel(access.model, identity)
  const pair = (object: string | undefined, outcome: Outcome, why?: string): PolicyPair => ({
    id: `${identity ?? ''}|${object ?? ''}`,
    ...(identity === undefined ? {} : { identity }),
    ...(object === undefined ? {} : { object }),
    outcome,
    sentence: pairSentence(
      policy.name,
      who,
      object === undefined ? undefined : objectWords(access, object),
      outcome,
    ),
    ...(why === undefined ? {} : { why }),
  })
  let asked: { subject?: string } = {}
  if (identity !== undefined) {
    const subject = subjectOf(access, identity)
    if (subject === undefined)
      return [pair(undefined, 'unknown', `The dataset holds no Node ${identity}.`)]
    if (!access.callers.has(subject))
      return [
        pair(
          undefined,
          'unknown',
          `The reader does not let ${who} ask: it decides rules for identities only.`,
        ),
      ]
    asked = { subject }
  }
  const otherCaller = (situation: Situation) =>
    asked.subject !== undefined &&
    situation.subject !== undefined &&
    situation.subject !== asked.subject
  const elsewhere = `The reader decided it for another caller than ${who}.`
  const situation = situationFor(rule, access.data, asked)
  if (otherCaller(situation)) return [pair(undefined, 'unknown', elsewhere)]
  const result = check(rule, access.data, situation)
  if (result.kind === 'cases')
    return result.cases
      .filter((one) => one.fact !== access.anyone)
      .map((one) => pair(one.fact, one.holds ? 'allowed' : 'refused'))
  if (result.kind === 'undecidable') return [pair(undefined, 'unknown', undecidableWords(result))]
  // A decision is made on one object at a time: each the Policy can be decided over, when it names any.
  const targets = targetsOf(rule, access.data).filter((one) => one.id !== access.anyone)
  if (targets.length === 0) {
    const outcome = outcomeOf(result)
    return [
      outcome === undefined
        ? pair(undefined, 'unknown', 'The Policy decides no permission here.')
        : pair(undefined, outcome),
    ]
  }
  return targets.map((target) => {
    const on = situationFor(rule, access.data, { ...asked, target: target.id })
    if (otherCaller(on)) return pair(target.id, 'unknown', elsewhere)
    if (on.target !== target.id)
      return pair(target.id, 'unknown', 'The reader decided it on another object than this one.')
    const decision = check(rule, access.data, on)
    if (decision.kind === 'undecidable')
      return pair(target.id, 'unknown', undecidableWords(decision))
    const outcome = outcomeOf(decision)
    return outcome === undefined
      ? pair(target.id, 'unknown', 'The Policy decides no permission here.')
      : pair(target.id, outcome)
  })
}

/** A Node by its name, an Edge as a verdict names it: `deployment_of from a to b`. */
function objectWords(access: Access, fact: string): string {
  const { model } = access
  if (model.nodes.has(fact) || model.outside.has(fact)) return endLabel(model, fact)
  const index = indexOfEdgeId(fact)
  const edge = index === undefined ? undefined : model.edgeAt.get(index)
  if (edge) return `${edge.name} from ${endLabel(model, edge.from)} to ${endLabel(model, edge.to)}`
  return fact
}

function pairSentence(
  policy: string,
  who: string | undefined,
  object: string | undefined,
  outcome: Outcome,
): string {
  if (who === undefined) {
    const of = object === undefined ? '' : ` of ${object}`
    if (outcome === 'allowed') return `${policy} holds${of}.`
    if (outcome === 'refused') return `${policy} does not hold${of}.`
    return `Can't tell whether ${policy} holds${of}.`
  }
  const on = object === undefined ? '' : ` on ${object}`
  if (outcome === 'allowed') return `${policy} admits ${who}${on}.`
  if (outcome === 'refused') return `${policy} does not admit ${who}${on}.`
  return `Can't tell whether ${policy} admits ${who}${on}.`
}

/**
 * A pair explained as its own case: the reader's verdict for that caller on that Node or Edge,
 * with the Edges that admit it in words (`path`), or the condition that fails first (`failing`).
 * `unexplained` says why the reader gives no explanation of this case: it decides the Policy for
 * another caller, or not on that object, or cannot read it.
 */
export type PairCase =
  | {
      readonly status: 'explained'
      readonly verdict: RuleVerdict
      readonly path: readonly PathStep[]
      readonly failing?: string
    }
  | { readonly status: 'unexplained'; readonly detail: string }

/** Each pair's case explained, per Access and Policy: explained once, when first asked. */
const explained = new WeakMap<Access, Map<string, PairCase | undefined>>()

/** The case of `pair`, explained; none for a pair that names no object. */
export function pairCase(
  access: Access,
  policy: PolicyRule,
  pair: PolicyPair,
): PairCase | undefined {
  let cases = explained.get(access)
  if (!cases) explained.set(access, (cases = new Map()))
  const key = `${policy.key}|${pair.id}`
  if (cases.has(key)) return cases.get(key)
  const found = explain(access, policy, pair)
  cases.set(key, found)
  return found
}

function explain(access: Access, policy: PolicyRule, pair: PolicyPair): PairCase | undefined {
  if (pair.object === undefined) return undefined
  const subject = pair.identity === undefined ? undefined : subjectOf(access, pair.identity)
  const checked = checkCase(policy, access.data, {
    ...(subject === undefined ? {} : { subject }),
    fact: pair.object,
  })
  if (checked.status !== 'checked') return { status: 'unexplained', detail: checked.detail }
  const path = pathOf(access, checked.proof.edges)
  const failing = failingWhy(checked.failing)
  return {
    status: 'explained',
    verdict: checked,
    path,
    ...(failing === undefined ? {} : { failing }),
  }
}

/**
 * The facts a pair stands on, as the map lights them: who and what — an Edge with its two ends —,
 * and what its own case's explanation stands on (`pairCase`).
 */
export function pairProof(
  access: Access,
  policy: PolicyRule,
  pair: PolicyPair,
): { readonly nodes: readonly string[]; readonly edges: readonly string[] } {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  const subject = pair.identity === undefined ? undefined : subjectOf(access, pair.identity)
  if (subject !== undefined && subject !== access.anyone) nodes.add(subject)
  if (pair.object !== undefined) {
    const index = indexOfEdgeId(pair.object)
    const edge = index === undefined ? undefined : access.model.edgeAt.get(index)
    if (edge) {
      edges.add(edge.id)
      nodes.add(edge.from).add(edge.to)
    } else nodes.add(pair.object)
    const explained = pairCase(access, policy, pair)
    if (explained?.status === 'explained') {
      for (const id of explained.verdict.proof.nodes) if (id !== access.anyone) nodes.add(id)
      for (const id of explained.verdict.proof.edges) edges.add(id)
    }
  }
  return { nodes: [...nodes], edges: [...edges] }
}

/**
 * What the Kernel decides for a pair at each place the Policy sits that answers for its object:
 * reading its Node, traversing or reading its Edge, calling a Method or function on its Node. A
 * verdict counts only when the place deciding it is one the Policy sits on. Each is what a
 * Scenario step pins; `as` stands for the caller of a Policy that reads none.
 */
export function pairVerdicts(
  access: Access,
  policy: PolicyRule,
  pair: PolicyPair,
  as: string,
): Verdict[] {
  if (pair.object === undefined) return []
  const identity = pair.identity ?? as
  const on = new Set(policy.sitsOn.map((one) => one.site))
  const sites = access.rules.sites.filter((site) => on.has(site.id))
  const { model } = access
  const path = model.nodes.has(pair.object) ? pair.object : undefined
  const index = path === undefined ? indexOfEdgeId(pair.object) : undefined
  const edge = index === undefined ? undefined : model.edgeAt.get(index)
  const candidates: (Verdict | undefined)[] = []
  if (path !== undefined) {
    if (sites.some((site) => site.slot === 'read'))
      candidates.push(readVerdict(access, identity, path))
    for (const site of sites)
      if (site.on.kind === 'method')
        candidates.push(
          callVerdict(access, identity, callableKey(site.on.owner, site.on.name), path),
        )
      else if (site.on.kind === 'function')
        candidates.push(callVerdict(access, identity, site.on.name, path))
  }
  if (edge) {
    if (sites.some((site) => site.slot === 'traverse'))
      candidates.push(edgeVerdict(access, identity, edge, 'traverse'))
    if (sites.some((site) => site.slot === 'read'))
      candidates.push(edgeVerdict(access, identity, edge, 'read'))
  }
  const seen = new Set<string>()
  return candidates.filter((verdict): verdict is Verdict => {
    if (!verdict || seen.has(verdict.id)) return false
    const site = 'site' in verdict.by ? verdict.by.site : undefined
    if (!site || !on.has(site.id)) return false
    seen.add(verdict.id)
    return true
  })
}
