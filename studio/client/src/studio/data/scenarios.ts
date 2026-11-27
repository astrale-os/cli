/**
 * Scenarios as the Data level reads them: each step judged again on the dataset as written and
 * the Schema as it now stands, whenever either changes. A step is as expected, not as expected,
 * gone — what it names is no longer there, said exactly — or can't tell, with why; can't tell is
 * neither a pass nor a failure, and is counted apart. For a call, what the function is declared to
 * write is read from its source, in the Behavior lens's words, and never applied: the dataset a
 * step is judged on is the one written, whatever the steps before it would have written. The
 * preconditions its mutations state are read the same way, and none is checked.
 *
 * Pure: nothing here draws, stores or decides a rule; verdicts are `access.ts`'s.
 */

import type { Scenario, ScenarioAct, ScenarioEdge, ScenarioStep } from '@shared/contracts/scenarios'
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { classRefKey, type IrClassRef, parseClassRefKey } from '@shared/schema/identity'

import type { Unread } from '../rules/model'

import { behaviorOf, type PreconditionLine, preconditionsOf } from '../inspector/behavior'
import { type ClassLink, classLink } from '../inspector/structure'
import { callableTargetOf, targetOf } from '../inspector/target'
import { withArticle } from '../inspector/words'
import { behaviorModel, type ChangeVerb, VERB_WORDS } from '../lenses/behavior'
import { lineage, originShort } from '../lenses/structure'
import {
  type Access,
  callablesOf,
  callVerdict,
  type Depth,
  edgeVerdict,
  readVerdict,
  type Verdict,
} from './access'
import {
  type DataEdge,
  type DatasetModel,
  endLabel,
  identityLabel,
  indexOfEdgeId,
  nodeId,
} from './model'

export type Standing = 'expected' | 'unexpected' | 'gone' | 'unknown'

/** One kind of write a function is declared to make, on the Classes its source names. */
export interface DeclaredChange {
  readonly verb: ChangeVerb
  /** the Behavior lens's word for it: `creates`, `transitions` */
  readonly word: string
  /** the Classes it lands on, as the source names them, as the Schema marks them */
  readonly classes: readonly ClassLink[]
  /** the relationships it writes, as the Schema marks them */
  readonly relationships: readonly ClassLink[]
  /** a state move's coordinates, `from → to` */
  readonly moves: readonly string[]
  /** the dataset's regions it would land on: the Classes named and every one extending them */
  readonly regions: readonly string[]
  /** the Classes named that no Node of the dataset is of, nor of a Class extending them */
  readonly absent: readonly { readonly target: string; readonly name: string }[]
}

/** What a function is declared to write, from its source; nothing here is applied. */
export interface Declared {
  readonly changes: readonly DeclaredChange[]
  /** where the source reading cannot tell what it writes */
  readonly gaps: readonly string[]
  /**
   * what its mutations require before they write, once each, in the order they are met: the
   * lines the Schema's Behavior lens reads for the function
   */
  readonly preconditions: readonly PreconditionLine[]
  /** whether it reaches several mutations: each precondition then names those that state it */
  readonly several: boolean
}

export interface StepFacts {
  /** the identity it acts as, when the dataset holds it */
  readonly actor?: string
  /** the Node paths it names that the dataset holds */
  readonly nodes: readonly string[]
  /** the Edge ids (`core.edge.<i>`) it names that the dataset holds */
  readonly edges: readonly string[]
}

export interface JudgedStep {
  readonly step: ScenarioStep
  /** its place in the Scenario, from 1 */
  readonly number: number
  /** what it asks, as a sentence without its answer: `Kernel calls CloudflareService.logs on 354iwg4avm6wdmrs` */
  readonly ask: string
  readonly standing: Standing
  /**
   * after the dash: `allowed, as expected`, `refused, expected allowed`, `can't tell`, or what is
   * gone; an allowed verdict's `though` after it
   */
  readonly answer: string
  /** what is gone, or why it can't be told, as a sentence */
  readonly reason?: string
  /** the verdict found on the dataset as written; none when what the step names is gone */
  readonly verdict?: Verdict
  readonly facts: StepFacts
  /** for a call whose function the Schema declares */
  readonly declared?: Declared
}

export interface StandingCounts {
  readonly expected: number
  readonly unexpected: number
  readonly gone: number
  readonly unknown: number
}

export interface JudgedScenario {
  readonly scenario: Scenario
  readonly steps: readonly JudgedStep[]
  /** the steps not as expected and the gone ones, in order: what the Scenario shows first */
  readonly broken: readonly JudgedStep[]
  readonly counts: StandingCounts
  /** `5 of 6 as expected`, `· 1 can't tell` after it */
  readonly standing: string
}

/** What a step is judged with: the dataset, and the Schema when it could be read. */
export interface Judging {
  readonly model: DatasetModel
  readonly bundle?: StudioSchemaBundle
  readonly access?: Access
  /** why no rule can be decided, when none can */
  readonly unread?: Unread
}

/** The Edge a step names, as the dataset now writes it: the first with those ends and relationship. */
export function edgeOfStep(model: DatasetModel, ref: ScenarioEdge): DataEdge | undefined {
  const from = model.outgoing.get(ref.from) ?? []
  return from.find((edge) => edge.name === ref.relation && edge.to === ref.to)
}

export const edgeRef = (edge: DataEdge): ScenarioEdge => ({
  from: edge.from,
  relation: edge.name,
  to: edge.to,
})

/** A Node's label when the dataset holds it, else the path the step wrote. */
const labelOf = (model: DatasetModel, path: string) =>
  model.nodes.has(path) || model.outside.has(path) ? endLabel(model, path) : path

const edgeObject = (model: DatasetModel, ref: ScenarioEdge) =>
  `${ref.relation} from ${labelOf(model, ref.from)} to ${labelOf(model, ref.to)}`

const VERB = { read: 'reads', traverse: 'traverses', call: 'calls' } as const

/** What a step asks, without its answer: `Kernel reads 354iwg4avm6wdmrs`. */
export function askOf(model: DatasetModel, step: ScenarioStep): string {
  const who = identityLabel(model, step.as, true)
  if (step.does === 'call')
    return `${who} calls ${step.fn}${step.on ? ` on ${labelOf(model, step.on.node)}` : ''}`
  const object = 'node' in step.on ? labelOf(model, step.on.node) : edgeObject(model, step.on.edge)
  return `${who} ${VERB[step.does]} ${object}`
}

/** Whether a step names the Node at `path`: as its actor, or as what it acts on. */
export function involves(step: ScenarioStep, path: string): boolean {
  if (step.as === path) return true
  if (!step.on) return false
  if ('node' in step.on) return step.on.node === path
  return step.on.edge.from === path || step.on.edge.to === path
}

/** Whether two steps ask the same thing, whatever they expect. */
export function sameAsk(left: ScenarioAct & { as: string }, right: ScenarioAct & { as: string }) {
  if (left.as !== right.as || left.does !== right.does) return false
  if (left.does === 'call' && right.does === 'call')
    return left.fn === right.fn && left.on?.node === right.on?.node
  const a = left.on!
  const b = right.on!
  if ('node' in a || 'node' in b) return 'node' in a && 'node' in b && a.node === b.node
  return (
    a.edge.from === b.edge.from && a.edge.relation === b.edge.relation && a.edge.to === b.edge.to
  )
}

/**
 * A verdict the Rules lens shows, as a step that expects it as it stands; none for a verdict
 * that can't tell, which no step can expect.
 */
export function stepOfVerdict(
  model: DatasetModel,
  verdict: Verdict,
  as: string,
  id: string,
): ScenarioStep | undefined {
  if (verdict.outcome === 'unknown') return undefined
  const expect = verdict.outcome
  if (verdict.slot === 'call') {
    const fn = verdict.id.slice('call:'.length)
    const on = verdict.target === undefined ? {} : { on: { node: verdict.target } }
    return { id, as, does: 'call', fn, ...on, expect }
  }
  const target = verdict.target
  if (target === undefined) return undefined
  const index = model.nodes.has(target) ? undefined : indexOfEdgeId(target)
  const edge = index === undefined ? undefined : model.edges[index]
  if (verdict.slot === 'read')
    return { id, as, does: 'read', on: edge ? { edge: edgeRef(edge) } : { node: target }, expect }
  return edge ? { id, as, does: 'traverse', on: { edge: edgeRef(edge) }, expect } : undefined
}

// ── what a call is declared to write ──

/** A Class's selection id as a reference: `class.X` at home, `class.<key>` elsewhere. */
function refOfTarget(target: string, domain: string): IrClassRef {
  const token = target.slice('class.'.length)
  return parseClassRefKey(token) ?? { origin: domain, kind: 'class', name: token }
}

/** A Class's name: bare at home, its Domain's short name after it elsewhere. */
const nameOfRef = (ref: IrClassRef, domain: string) =>
  ref.origin === domain ? ref.name : `${ref.name} · ${originShort(ref.origin)}`

const nameOfTarget = (target: string, domain: string) =>
  nameOfRef(refOfTarget(target, domain), domain)

const linkOfTarget = (bundle: StudioSchemaBundle, target: string, domain: string) =>
  classLink(bundle, refOfTarget(target, domain))

const VERB_ORDER = Object.keys(VERB_WORDS) as ChangeVerb[]

/**
 * What the function keyed `key` is declared to write, write by write across its mutations, and
 * where each would land in the dataset, with the preconditions those mutations state; none when
 * the Schema declares no such function.
 */
export function declaredBy(
  bundle: StudioSchemaBundle,
  model: DatasetModel,
  key: string,
): Declared | undefined {
  if (!bundle.ir) return undefined
  const behavior = behaviorModel(bundle)
  const fn = behavior.functions.find((one) => one.key === key)
  if (!fn) return undefined
  const domain = behavior.domain
  const lineages = model.classes.map((cls) => ({
    region: cls.target,
    keys: lineage(bundle, { origin: cls.origin, kind: 'class', name: cls.name }),
  }))
  const merged = new Map<
    string,
    { verb: ChangeVerb; nodes: string[]; relationships: Set<string>; moves: Set<string> }
  >()
  for (const id of fn.mutations)
    for (const change of behavior.mutations.get(id)?.changes ?? []) {
      const at = `${change.verb}|${change.nodes.join(',')}`
      const known = merged.get(at) ?? {
        verb: change.verb,
        nodes: change.nodes,
        relationships: new Set<string>(),
        moves: new Set<string>(),
      }
      for (const relationship of change.relationships) known.relationships.add(relationship)
      for (const move of change.moves) known.moves.add(move)
      merged.set(at, known)
    }
  const changes = [...merged.values()]
    .sort((left, right) => VERB_ORDER.indexOf(left.verb) - VERB_ORDER.indexOf(right.verb))
    .map((change): DeclaredChange => {
      const keys = change.nodes.map((target) => classRefKey(refOfTarget(target, domain)))
      const held = (key: string) => lineages.some((each) => each.keys.has(key))
      return {
        verb: change.verb,
        word: VERB_WORDS[change.verb],
        classes: change.nodes.map((target) => linkOfTarget(bundle, target, domain)),
        relationships: [...change.relationships].map((target) =>
          linkOfTarget(bundle, target, domain),
        ),
        moves: [...change.moves],
        regions: lineages
          .filter((each) => keys.some((one) => each.keys.has(one)))
          .map((each) => each.region),
        absent: change.nodes
          .filter((_, index) => !held(keys[index]!))
          .map((target) => ({ target, name: nameOfTarget(target, domain) })),
      }
    })
  const gaps = [...fn.gaps]
  if (fn.abstract)
    gaps.push(`${key} is a contract, and each Class that implements it declares its own writes`)
  // what its mutations require, read as the Schema's Behavior lens reads them for the function
  const steps = fn.mutations.flatMap((id) => {
    const target = targetOf(bundle, id)
    const read = target.kind === 'definition' ? behaviorOf(bundle, target) : undefined
    return read?.kind === 'definition' ? [read] : []
  })
  return { changes, gaps, preconditions: preconditionsOf(steps), several: fn.mutations.length > 1 }
}

// ── judging ──

const NO_FACTS: StepFacts = { nodes: [], edges: [] }

type Answer = Omit<JudgedStep, 'step' | 'number' | 'ask'>

/**
 * What the step names that the dataset no longer holds, or the Schema no longer declares, said
 * after the ask (`answer`) and as a sentence (`opening`): a name that opens it stays as written,
 * prose that opens it is given its capital where it is written.
 */
const gone = (answer: string, facts: StepFacts, declared?: Declared, opening = answer): Answer => ({
  standing: 'gone',
  answer,
  reason: `${opening}.`,
  facts,
  ...(declared ? { declared } : {}),
})

const cantTell = (reason: string, facts: StepFacts, declared?: Declared): Answer => ({
  standing: 'unknown',
  answer: "can't tell",
  reason,
  facts,
  ...(declared ? { declared } : {}),
})

/** One step judged on the dataset as written; `depth: 'outcome'` decides it without its proof. */
export function judgeStep(
  judging: Judging,
  step: ScenarioStep,
  number: number,
  depth: Depth = 'full',
): JudgedStep {
  return { step, number, ask: askOf(judging.model, step), ...answerOf(judging, step, depth) }
}

function answerOf(judging: Judging, step: ScenarioStep, depth: Depth): Answer {
  const { model, bundle, access } = judging
  // What the step names, gone first: who acts, then what it acts on, then the function.
  const actor = step.as === ANYONE ? undefined : step.as
  if (actor !== undefined && !model.nodes.has(actor))
    return gone(`${identityLabel(model, actor)} is no longer in the dataset`, NO_FACTS)
  const withActor: StepFacts = actor === undefined ? NO_FACTS : { actor, nodes: [], edges: [] }
  if (actor !== undefined && access && !access.identities.some((one) => one.id === actor))
    return gone(
      `${identityLabel(model, actor, true)} is no longer an identity: its Class is not Kernel Identity and does not extend it`,
      withActor,
    )
  let node: string | undefined
  let edge: DataEdge | undefined
  if (step.on && 'node' in step.on) {
    node = step.on.node
    if (!model.nodes.has(node)) return gone(`${node} is no longer in the dataset`, withActor)
  } else if (step.on && 'edge' in step.on) {
    edge = edgeOfStep(model, step.on.edge)
    if (!edge)
      return gone(
        `the dataset no longer holds an Edge ${edgeObject(model, step.on.edge)}`,
        withActor,
        undefined,
        `The dataset no longer holds an Edge ${edgeObject(model, step.on.edge)}`,
      )
  }
  const ends = edge ? [edge.from, edge.to].filter((path) => model.nodes.has(path)) : []
  const facts: StepFacts = {
    ...withActor,
    nodes: node === undefined ? ends : [node],
    edges: edge ? [edge.id] : [],
  }

  let verdict: Verdict | undefined
  let declared: Declared | undefined
  if (step.does === 'call') {
    const target = bundle?.ir ? targetOf(bundle, callableTargetOf(step.fn)) : undefined
    if (target && target.kind !== 'function')
      return gone(
        `the Schema no longer declares ${step.fn}`,
        facts,
        undefined,
        `The Schema no longer declares ${step.fn}`,
      )
    declared = bundle ? declaredBy(bundle, model, step.fn) : undefined
    if (target?.kind === 'function' && !target.static) {
      if (node === undefined)
        return cantTell(
          `${step.fn} is called on a Node, and this step names none.`,
          facts,
          declared,
        )
      const cls = model.classOf.get(node)!
      if (access && !callablesOf(access, cls).some((link) => link.key === step.fn))
        return gone(`${step.fn} no longer works on ${withArticle(cls.name)}`, facts, declared)
    }
    if (!access) return cantTell(unreadWhy(judging), facts, declared)
    verdict = callVerdict(access, step.as, step.fn, node, depth)
    if (!verdict)
      return gone(
        `the Schema no longer declares ${step.fn}`,
        facts,
        undefined,
        `The Schema no longer declares ${step.fn}`,
      )
  } else {
    if (!access) return cantTell(unreadWhy(judging), facts)
    verdict = edge
      ? edgeVerdict(access, step.as, edge, step.does, depth)
      : readVerdict(access, step.as, node!, depth)
  }

  // What the map lights: what the step names, and what its verdict stands on.
  const lit: StepFacts = {
    ...facts,
    nodes: [...new Set([...facts.nodes, ...verdict.proof.nodes])],
    edges: [...new Set([...facts.edges, ...verdict.proof.edges])],
  }
  const found = { verdict, facts: lit, ...(declared ? { declared } : {}) }
  if (verdict.outcome === 'unknown')
    return { standing: 'unknown', answer: "can't tell", reason: verdict.why, ...found }
  // What an allowed verdict holds that a reader would not guess is said after the answer.
  const though = verdict.though ? `, ${verdict.though}` : ''
  if (verdict.outcome === step.expect)
    return { standing: 'expected', answer: `${verdict.outcome}, as expected${though}`, ...found }
  return {
    standing: 'unexpected',
    answer: `${verdict.outcome}, expected ${step.expect}${though}`,
    ...found,
  }
}

const unreadWhy = (judging: Judging) =>
  judging.unread?.detail ?? 'The Schema could not be read, so no rule can be decided.'

/** The standing of a Scenario in words: `5 of 6 as expected · 1 can't tell`. */
export function standingWords(counts: StandingCounts): string {
  const told = counts.expected + counts.unexpected + counts.gone
  const unknown = counts.unknown > 0 ? `${counts.unknown} can't tell` : ''
  if (told === 0) return unknown || 'no step yet'
  const expected = `${counts.expected} of ${told} as expected`
  return unknown ? `${expected} · ${unknown}` : expected
}

/** Every step of a Scenario judged, the broken ones gathered first. */
export function judgeScenario(
  judging: Judging,
  scenario: Scenario,
  depth: Depth = 'full',
): JudgedScenario {
  const steps = scenario.steps.map((step, index) => judgeStep(judging, step, index + 1, depth))
  const counts = { expected: 0, unexpected: 0, gone: 0, unknown: 0 }
  for (const step of steps) counts[step.standing] += 1
  return {
    scenario,
    steps,
    broken: steps.filter((step) => step.standing === 'unexpected' || step.standing === 'gone'),
    counts,
    standing: standingWords(counts),
  }
}

/**
 * Where a step stands in the Rules lens: the scene id of the Node or Edge whose page shows its
 * verdict. A static Method's verdict shows on every Node of a Class it works on: the first.
 */
export function rulesTargetOf(judging: Judging, judged: JudgedStep): string | undefined {
  const { step } = judged
  const { model, access } = judging
  if (step.does !== 'call') {
    if ('edge' in step.on) return edgeOfStep(model, step.on.edge)?.id
    return model.nodes.has(step.on.node) ? nodeId(step.on.node) : undefined
  }
  if (step.on) return model.nodes.has(step.on.node) ? nodeId(step.on.node) : undefined
  if (!access) return undefined
  const cls = model.classes.find((one) =>
    callablesOf(access, one).some((link) => link.key === step.fn),
  )
  return cls?.nodes[0] === undefined ? undefined : nodeId(cls.nodes[0])
}
