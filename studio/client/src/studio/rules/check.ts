import type {
  Check,
  Data,
  FactId,
  Key,
  Meaning,
  NodeId,
  Reason,
  Related,
  Rule,
  Situation,
  Trace,
  VerdictTone,
} from '@astrale-os/visual'

import {
  caseOf,
  check,
  explainCase,
  factLabel,
  isTrace,
  readsCaller,
  reasonsOf,
  situationFor,
  textOf,
  undecidableWords,
  verdictWords,
  whyWords,
} from '@astrale-os/visual'

import type { PolicyRule, RuleSite, Unread } from './model'

/**
 * A rule decided on data, as `@astrale-os/visual` decides it: the verdict and its words, the case
 * it explains and why, the Nodes and Edges that explanation stands on, and the first condition
 * that fails in it. `checkRule` explains the case the reader picks; `checkCase` the one asked.
 * Nothing here decides or words anything itself.
 */

export interface RuleVerdict {
  readonly status: 'checked'
  readonly result: Check
  /** The caller and target it was decided for: those asked, else the first the data offers (`situationFor`). */
  readonly situation: Situation
  readonly tone: VerdictTone
  /** The verdict in one sentence (`verdictWords`), or why the data cannot decide it (`undecidableWords`). */
  readonly words: string
  /** The case explained: the one asked (`checkCase`), else the first that fails, else the first (`caseOf`). */
  readonly fact?: FactId
  /** Why the rule decides the explained case as it does (`whyWords`); none when the data cannot decide it. */
  readonly why?: string
  /**
   * The facts the explanation stands on: each fact its entities are bound to (none a quantifier only
   * tried), the caller, the target and the case, and each Edge that makes one of its links hold
   * for the facts it was explained on; an Edge brings its two ends. A path's steps are not lit
   * one by one.
   */
  readonly proof: { readonly nodes: readonly FactId[]; readonly edges: readonly FactId[] }
  /**
   * When the explained case does not hold: the first condition of it that fails, in reading
   * order, as deep as the reader explains it (`reasonsOf`) — its words, and what the data showed.
   */
  readonly failing?: { readonly node: NodeId; readonly words: string; readonly detail?: string }
}

/** One case of a rule: whom it is decided for, and the Node or Edge it is decided on. */
export interface Case {
  /** The caller `you` stands for: an identity's fact, or the fact anyone is decided as; none when the rule reads no caller. */
  readonly subject?: FactId
  /** The Node or Edge: a case of a constraint, a definition or an obligation, or a permission's, a prohibition's or a guard's target. */
  readonly fact: FactId
}

/** A case the reader does not decide: it decides the rule for another caller, or not on that fact. */
export interface OtherCase {
  readonly status: 'other-case'
  readonly detail: string
}

const ruleAt = (at: RuleSite | PolicyRule | Rule): Rule | Unread =>
  'reading' in at ? (at.reading.status === 'read' ? at.reading.rule : at.reading) : at

/** A site's or a Policy's rule decided on data, or why it has no rule to decide. */
export function checkRule(
  at: RuleSite | PolicyRule | Rule,
  data: Data,
  asked?: Situation,
): RuleVerdict | Unread {
  const rule = ruleAt(at)
  if ('status' in rule) return rule
  const situation = situationFor(rule, data, asked)
  const result = check(rule, data, situation)
  return verdictOf(rule, data, situation, result, caseOf(result))
}

/**
 * One case of a site's or a Policy's rule decided on data, and explained: the case's own verdict
 * (`result` holds of it alone), why, the Nodes and Edges proving it, or the first condition that
 * fails. `OtherCase` when the reader decides the rule for another caller than the one asked, or
 * not on that fact; never another case's verdict.
 */
export function checkCase(
  at: RuleSite | PolicyRule | Rule,
  data: Data,
  asked: Case,
): RuleVerdict | Unread | OtherCase {
  const rule = ruleAt(at)
  if ('status' in rule) return rule
  const other = (detail: string): OtherCase => ({ status: 'other-case', detail })
  const situation = situationFor(rule, data, {
    ...(asked.subject === undefined ? {} : { subject: asked.subject }),
    target: asked.fact,
  })
  if (readsCaller(rule) && situation.subject !== asked.subject)
    return other(
      asked.subject === undefined
        ? 'The rule reads its caller, and none is asked.'
        : `The reader decided it for another caller than ${factLabel(data, asked.subject)}.`,
    )
  const result = check(rule, data, situation)
  const label = factLabel(data, asked.fact)
  switch (result.kind) {
    case 'undecidable':
      return verdictOf(rule, data, situation, result, undefined)
    case 'cases': {
      const one = result.cases.find((each) => each.fact === asked.fact)
      if (one === undefined) return other(`${label} is not a case the rule is decided on.`)
      return verdictOf(
        rule,
        data,
        situation,
        { ...result, holds: one.holds, cases: [one] },
        one.fact,
      )
    }
    case 'decision':
      if (situation.target !== asked.fact)
        return other(`The reader decided it on another object than ${label}.`)
      return verdictOf(rule, data, situation, result, undefined)
    case 'result':
      if (!Array.isArray(result.result) || !result.result.includes(asked.fact))
        return other(`${label} is not a result of the query.`)
      return verdictOf(rule, data, situation, result, asked.fact)
  }
}

/** A verdict worded and the case `fact` explained, as the reader does both. */
function verdictOf(
  rule: Rule,
  data: Data,
  situation: Situation,
  result: Check,
  fact: FactId | undefined,
): RuleVerdict {
  if (result.kind === 'undecidable')
    return {
      status: 'checked',
      result,
      situation,
      tone: 'neutral',
      words: undecidableWords(result),
      proof: { nodes: [], edges: [] },
    }
  const [tone, words] = verdictWords(rule, data, situation, result) ?? ['neutral', '']
  const explained = explainCase(rule, data, situation, fact)
  const trace = isTrace(explained) ? explained : undefined
  const holds =
    result.kind === 'cases'
      ? result.cases.find((one) => one.fact === fact)?.holds
      : result.kind === 'decision'
        ? result.holds
        : undefined
  const failing =
    trace === undefined || holds !== false ? undefined : failingIn(rule, data, trace, fact)
  return {
    status: 'checked',
    result,
    situation,
    tone,
    words,
    ...(fact === undefined ? {} : { fact }),
    why: whyWords(rule, data, situation, result, fact),
    proof: proofOf(rule, data, situation, fact, trace),
    ...(failing === undefined ? {} : { failing }),
  }
}

/** The first condition that fails in a case explained: the first failing reason, then its first failing one, and so on. */
function failingIn(
  rule: Rule,
  data: Data,
  trace: Trace,
  fact: FactId | undefined,
): RuleVerdict['failing'] {
  let found: Reason | undefined
  let level = reasonsOf(rule, data, trace, textOf(rule, 'en'), fact)
  for (let next = level.find(failed); next !== undefined; next = level.find(failed)) {
    found = next
    level = next.reasons
  }
  if (found === undefined) return undefined
  const { node, words, detail } = found
  return { node, words, ...(detail === undefined ? {} : { detail }) }
}

const failed = (reason: Reason) => reason.tone === 'negative'

function proofOf(
  rule: Rule,
  data: Data,
  situation: Situation,
  fact: FactId | undefined,
  trace: Trace | undefined,
): RuleVerdict['proof'] {
  const edges = new Map(data.graph.edges.map((edge) => [edge.id, edge]))
  const nodes = new Set<FactId>()
  const lit = new Set<FactId>()
  const light = (id: FactId | undefined) => {
    if (id === undefined) return
    const edge = edges.get(id)
    if (edge === undefined) nodes.add(id)
    else {
      lit.add(id)
      nodes.add(edge.source)
      nodes.add(edge.target)
    }
  }
  if (trace !== undefined) {
    for (const [entity, id] of Object.entries(trace.bindings))
      if (trace.standing[entity] !== 'candidate') light(id)
    const { classes } = rule.catalogue.words.schema
    const isA = (cls: Key, relation: Key): boolean =>
      cls === relation || (classes[cls]?.extends ?? []).some((parent) => isA(parent, relation))
    for (const link of linksOf(rule.meaning)) {
      if (trace.truth[link.id] !== true) continue
      const source = trace.values[link.source]
      const target = trace.values[link.target]
      for (const edge of data.graph.edges)
        if (edge.source === source && edge.target === target && isA(edge.class, link.relation))
          light(edge.id)
    }
  }
  light(situation.subject)
  light(situation.target)
  light(fact)
  return { nodes: [...nodes], edges: [...lit] }
}

/** A link a Meaning tests (`related`), with the ids of the Terms at its two ends. */
interface Link {
  readonly id: NodeId
  readonly relation: Key
  readonly source: NodeId
  readonly target: NodeId
}

/** Every link a Meaning tests: an Edge of the relation joins its two Terms. */
function linksOf(meaning: Meaning): Link[] {
  const out: Link[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) walk(each)
    else if (value !== null && typeof value === 'object') {
      if ((value as { kind?: unknown }).kind === 'related') {
        const { id, relation, source, target } = value as Related
        out.push({ id, relation, source: source.id, target: target.id })
      }
      for (const each of Object.values(value)) walk(each)
    }
  }
  walk(meaning.frame)
  return out
}
