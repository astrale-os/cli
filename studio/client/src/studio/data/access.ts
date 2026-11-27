/**
 * What an identity of a dataset may do there, rule by rule: read each Node, traverse each Edge,
 * call each function that works on a Node's Class. Each verdict says allowed, refused or can't
 * tell, by which rule, and why — the Nodes and Edges proving it, the condition that failed, the
 * Kernel's default where nothing is written, or what the reader lacks. Rules are decided by
 * `@astrale-os/visual` through `checkRule`; this module only asks, and never guesses: a verdict
 * the reader decided for another caller or target than the one asked is can't tell.
 */

import type { Catalogue, Check, Data, FactId, Rule, Situation } from '@astrale-os/visual'
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { callers, check, situationFor, undecidableWords } from '@astrale-os/visual'
import { ANYONE } from '@shared/contracts/scenarios'
import { KERNEL_ORIGIN } from '@shared/contracts/workspace'

import { behaviorOf, type CallableLink } from '../inspector/behavior'
import { ruleTargetOf } from '../inspector/switches'
import { callableTargetOf, targetOf } from '../inspector/target'
import { relationPhrase, type Terms, termsOf } from '../inspector/words'
import { originShort } from '../lenses/structure'
import { checkRule, type RuleVerdict } from '../rules/check'
import { dataOf } from '../rules/data'
import {
  callRuleOf,
  type DomainRules,
  kernelDefaultOf,
  type RuleSite,
  rulesOf,
  ruleView,
  sitesOn,
  type Unread,
} from '../rules/model'
import {
  type DataClass,
  type DataEdge,
  type DatasetModel,
  endLabel,
  identityLabel,
  indexOfEdgeId,
} from './model'

/** The Kernel's Identity Class: whoever calls the Kernel is a fact of it, or of a Class extending it. */
export const IDENTITY_KEY = `${KERNEL_ORIGIN}:class.Identity`
const DOMAIN_KEY = `${KERNEL_ORIGIN}:class.Domain`
const DOMAIN_ORIGIN = `${DOMAIN_KEY}.property.origin`

export interface Identity {
  /** the choice: a Node's path, or `ANYONE` */
  readonly id: string
  readonly label: string
  /** the Class it is a Node of, as the level names it; none for anyone */
  readonly className?: string
}

/** Whether a Class is Kernel `Identity` or extends it, as the catalogue's Schema says. */
export function isIdentityClass(
  catalogue: Catalogue,
  key: string,
  seen = new Set<string>(),
): boolean {
  if (key === IDENTITY_KEY) return true
  if (seen.has(key)) return false
  seen.add(key)
  return (catalogue.words.schema.classes[key]?.extends ?? []).some((parent) =>
    isIdentityClass(catalogue, parent, seen),
  )
}

/** The dataset's identities, in dataset order: every Node whose Class is or extends Kernel `Identity`. */
export function identitiesOf(model: DatasetModel, catalogue: Catalogue): Identity[] {
  const identities: Identity[] = []
  for (const cls of model.classes) {
    if (!isIdentityClass(catalogue, cls.key)) continue
    for (const path of cls.nodes)
      identities.push({ id: path, label: endLabel(model, path), className: cls.name })
  }
  const order = new Map(model.order.map((node, index) => [node.path, index]))
  return identities.sort((left, right) => order.get(left.id)! - order.get(right.id)!)
}

export interface Access {
  readonly model: DatasetModel
  readonly bundle: StudioSchemaBundle
  readonly rules: DomainRules
  readonly catalogue: Catalogue
  readonly terms: Terms
  /** the dataset as rules are decided on it, with the identity anyone stands for */
  readonly data: Data
  readonly identities: readonly Identity[]
  /** the fact anyone is decided as; none when the Bundle holds no Kernel `Identity` */
  readonly anyone?: string
  /** the facts the reader lets ask (`callers`) */
  readonly callers: ReadonlySet<string>
  /** the Domain each Kernel `Domain` Node stands for, by path */
  readonly domains: ReadonlyMap<string, string>
  /** another Domain's rules, read from the Bundle's closure; none when the closure does not carry it */
  readonly rulesOf: (origin: string) => DomainRules | undefined
}

const foreignRules = new WeakMap<StudioSchemaBundle, Map<string, DomainRules | undefined>>()

/** Another Domain's rules, as its own Schema in the Bundle's closure declares them. */
function rulesOfOrigin(bundle: StudioSchemaBundle, origin: string): DomainRules | undefined {
  let byOrigin = foreignRules.get(bundle)
  if (!byOrigin) foreignRules.set(bundle, (byOrigin = new Map()))
  if (byOrigin.has(origin)) return byOrigin.get(origin)
  const closure = bundle.schemaClosure ?? []
  const root = closure.find(
    (document) =>
      typeof document === 'object' &&
      document !== null &&
      (document as { origin?: unknown }).origin === origin,
  )
  const found =
    root === undefined || bundle.schemaMode === 'unavailable'
      ? undefined
      : rulesOf({
          domainId: origin,
          schemaMode: bundle.schemaMode,
          schemaRoot: root,
          schemaClosure: closure.filter((document) => document !== root),
        })
  byOrigin.set(origin, found)
  return found
}

/**
 * Everything a verdict is decided with, for one dataset and one bundle reply; `Unread` when no
 * rule of the Domain can be read, so nothing can be decided.
 */
export function accessOf(
  bundle: StudioSchemaBundle,
  model: DatasetModel,
  now: string,
): Access | Unread {
  const rules = rulesOf(bundle)
  if (rules.unread) return rules.unread
  const catalogue = rules.catalogue!
  const base = dataOf(model.dataset, catalogue, now)
  let anyone: string | undefined
  let data = base
  if (catalogue.words.schema.classes[IDENTITY_KEY] !== undefined) {
    anyone = ANYONE
    for (let suffix = 1; model.nodes.has(anyone) || model.outside.has(anyone); suffix++)
      anyone = `${ANYONE}-${suffix}`
    data = {
      ...base,
      graph: {
        ...base.graph,
        nodes: [
          ...base.graph.nodes,
          { id: anyone, class: IDENTITY_KEY, label: 'anyone', values: {} },
        ],
      },
    }
  }
  return {
    model,
    bundle,
    rules,
    catalogue,
    terms: termsOf(catalogue),
    data,
    identities: identitiesOf(model, catalogue),
    ...(anyone === undefined ? {} : { anyone }),
    callers: new Set(callers(catalogue, data).map((candidate) => candidate.id)),
    domains: domainsOf(catalogue, data),
    rulesOf: (origin) => rulesOfOrigin(bundle, origin),
  }
}

// ── verdicts ──

export type Outcome = 'allowed' | 'refused' | 'unknown'
export type Slot = 'read' | 'traverse' | 'call'
/**
 * How far a verdict is explained: `full` finds the case, why and the facts it stands on;
 * `outcome` decides only, for counting a whole dataset — its why names no Edge.
 */
export type Depth = 'full' | 'outcome'

/** What decides a verdict. */
export type Decider =
  /** a rule written on the site: the Policies it names, and its sentence */
  | {
      readonly kind: 'rule'
      readonly site: RuleSite
      readonly rule: Rule
      readonly policies: readonly string[]
      readonly sentence: string
    }
  /** the Kernel, where the Schema writes nothing, `false`, or no Policy for an authorized callable */
  | { readonly kind: 'kernel'; readonly site: RuleSite }
  /** the constant `true` */
  | { readonly kind: 'true'; readonly site: RuleSite }
  /** the Domain that declares the Class or callable passes every site */
  | { readonly kind: 'declarer'; readonly site?: RuleSite }
  /** a callable's contract that admits anonymous or any signed-in caller: no Policy decides it */
  | { readonly kind: 'contract'; readonly auth: 'anonymous' | 'authenticated' }
  | { readonly kind: 'none'; readonly site?: RuleSite }

/** An Edge a verdict stands on, and the Edge in words (`edgeWords`). */
export interface PathStep {
  /** `core.edge.<i>` */
  readonly edge: string
  readonly words: string
}

/** The Edges among `edges` the dataset holds, each with its words, in their order. */
export function pathOf(
  access: Pick<Access, 'model' | 'terms'>,
  edges: readonly string[],
): PathStep[] {
  return edges.flatMap((id) => {
    const index = indexOfEdgeId(id)
    const edge = index === undefined ? undefined : access.model.edges[index]
    return edge ? [{ edge: id, words: edgeWords(access, edge) }] : []
  })
}

export interface Verdict {
  /** unique on its Node or Edge: `read:<path>`, `traverse:<edge id>`, `call:<callable>` */
  readonly id: string
  readonly slot: Slot
  readonly outcome: Outcome
  /** what is asked, after the verb: a Node's name, an Edge in words, a callable */
  readonly object: string
  /** the verdict in one sentence */
  readonly sentence: string
  readonly by: Decider
  /** why, in one sentence: the condition that holds or fails, the Kernel's default, the contract, or what the reader lacks */
  readonly why: string
  /** what is asked about: a Node's path, an Edge's id; none for a static Method */
  readonly target?: string
  /** the Edges that prove an allowed verdict a rule decides, each with its words */
  readonly path: readonly PathStep[]
  /** the facts it stands on: Node paths and Edge ids (`core.edge.<i>`), as the reader explains it */
  readonly proof: { readonly nodes: readonly string[]; readonly edges: readonly string[] }
  /** a rule's reading the reader lacks */
  readonly unread?: Unread
  /**
   * For a verdict a rule decides on the dataset: the caller and target it was decided for, and
   * the case explained — what its walk and Figure are drawn in, with this proof marked.
   */
  readonly decided?: { readonly situation: Situation; readonly fact?: FactId }
  /** for a call: the selection id that opens the callable at the Schema level */
  readonly opens?: string
  /** for a call: a static Method, decided on no Node */
  readonly static?: boolean
  /**
   * What an allowed verdict holds that a reader would not guess, said after it in its sentence:
   * a call allowed on a Node the same identity may not read (`though Pipeline cannot read it`) —
   * a call is decided by its contract and its call rule, never by the read rule.
   */
  readonly though?: string
}

/** The fact an identity choice is decided as. */
export function subjectOf(access: Access, identity: string): string | undefined {
  if (identity === ANYONE) return access.anyone
  return access.model.nodes.has(identity) ? identity : undefined
}

/** An identity as a verdict's sentences name it, inside a sentence and opening one. */
interface Who {
  readonly name: string
  readonly opening: string
}

const whoOf = (access: Access, identity: string): Who => ({
  name: identityLabel(access.model, identity),
  opening: identityLabel(access.model, identity, true),
})

/** How a Check decides for the caller asked, when it decides at all: a prohibition that holds refuses. */
export function outcomeOf(result: Check): Outcome | undefined {
  if (result.kind === 'decision') {
    if (result.frame === 'prohibition') return result.holds ? 'refused' : 'allowed'
    return result.holds ? 'allowed' : 'refused'
  }
  if (result.kind === 'result' && typeof result.result === 'boolean')
    return result.result ? 'allowed' : 'refused'
  return undefined
}

/**
 * The Domain each Node that is a Kernel `Domain` stands for, by path: its `origin`. Root and the
 * Domain that declares a Class or callable pass every site on it.
 */
function domainsOf(catalogue: Catalogue, data: Data): ReadonlyMap<string, string> {
  const isDomain = (key: string, seen = new Set<string>()): boolean => {
    if (key === DOMAIN_KEY) return true
    if (seen.has(key)) return false
    seen.add(key)
    return (catalogue.words.schema.classes[key]?.extends ?? []).some((parent) =>
      isDomain(parent, seen),
    )
  }
  const domains = new Map<string, string>()
  for (const node of data.graph.nodes) {
    const origin = node.values[DOMAIN_ORIGIN]
    if (typeof origin === 'string' && isDomain(node.class)) domains.set(node.id, origin)
  }
  return domains
}

/** An Edge in words, its ends by name: `354iwg4avm6wdmrs is owned by Kernel`. */
export function edgeWords(access: Pick<Access, 'model' | 'terms'>, edge: DataEdge): string {
  const { model, terms } = access
  const phrase = relationPhrase(terms.relation(relationKey(model, edge)), 'source')
  const from = endLabel(model, edge.from)
  const to = endLabel(model, edge.to)
  return phrase ? `${from} ${phrase} ${to}` : `${from} —${edge.name}→ ${to}`
}

/** The Kernel Key of an Edge's relationship. */
export function relationKey(model: DatasetModel, edge: DataEdge): string {
  return edge.name.includes(':') ? edge.name : `${model.origin}:class.${edge.name}`
}

interface Ask {
  readonly id: string
  readonly slot: Slot
  readonly object: string
  /** the fact the rule is decided on: a Node's path, an Edge's id; none for a static Method */
  readonly target?: string
  /** the Domain that declares what is asked */
  readonly declarer: string
  readonly opens?: string
  readonly static?: boolean
}

function sentenceOf(
  outcome: Outcome,
  who: Who,
  verb: Slot,
  object: string,
  though?: string,
): string {
  if (outcome === 'allowed')
    return `${who.opening} may ${verb} ${object}${though ? `, ${though}` : ''}.`
  if (outcome === 'refused') return `${who.opening} may not ${verb} ${object}.`
  return `Can't tell whether ${who.name} may ${verb} ${object}.`
}

const NO_PROOF = { nodes: [], edges: [] } as const

function verdict(
  ask: Ask,
  who: Who,
  outcome: Outcome,
  by: Decider,
  why: string,
  extra: Partial<Pick<Verdict, 'path' | 'proof' | 'unread' | 'decided'>> = {},
): Verdict {
  return {
    id: ask.id,
    slot: ask.slot,
    outcome,
    object: ask.object,
    ...(ask.target === undefined ? {} : { target: ask.target }),
    sentence: sentenceOf(outcome, who, ask.slot, ask.object),
    by,
    why,
    path: extra.path ?? [],
    proof: extra.proof ?? NO_PROOF,
    ...(extra.unread ? { unread: extra.unread } : {}),
    ...(extra.decided ? { decided: extra.decided } : {}),
    ...(ask.opens ? { opens: ask.opens } : {}),
    ...(ask.static ? { static: true } : {}),
  }
}

/** A site decided for an identity, as the Kernel would decide it on this dataset. */
function decide(
  access: Access,
  identity: string,
  site: RuleSite | undefined,
  ask: Ask,
  depth: Depth = 'full',
): Verdict {
  const who = whoOf(access, identity)
  const subject = subjectOf(access, identity)
  const domain = originShort(ask.declarer)
  if (subject === undefined)
    return verdict(
      ask,
      who,
      'unknown',
      { kind: 'none' },
      identity === ANYONE
        ? 'The Bundle holds no Kernel Identity to stand for anyone.'
        : `The dataset holds no Node ${identity}.`,
    )
  // Root and the Domain that declares the Class or callable pass every site.
  if (access.domains.get(subject) === ask.declarer)
    return verdict(
      ask,
      who,
      'allowed',
      { kind: 'declarer', ...(site ? { site } : {}) },
      `${who.opening} is ${domain}, the Domain that declares it, and passes every rule on it.`,
    )
  if (site === undefined)
    return verdict(
      ask,
      who,
      'unknown',
      { kind: 'none' },
      `The reader lists no ${ask.slot} rule here.`,
    )
  const kernel = kernelDefaultOf(site, domain)
  if (site.written === 'omitted' && kernel !== undefined)
    return verdict(ask, who, 'allowed', { kind: 'kernel', site }, kernel)
  if ((site.written === 'false' || site.written === 'absent') && kernel !== undefined)
    return verdict(
      ask,
      who,
      'unknown',
      { kind: 'kernel', site },
      `${kernel} The dataset does not say whether ${who.name} is Root.`,
    )
  if (site.written === 'true')
    return verdict(
      ask,
      who,
      'allowed',
      { kind: 'true', site },
      'It is written true: every caller may.',
    )
  if (site.reading.status === 'unread')
    return verdict(ask, who, 'unknown', { kind: 'none', site }, site.reading.detail, {
      unread: site.reading,
    })

  const rule = site.reading.rule
  const by: Decider = {
    kind: 'rule',
    site,
    rule,
    policies: site.policies.filter((policy) => policy.direct).map((policy) => policy.key),
    sentence: ruleView(rule).sentence,
  }
  if (!access.callers.has(subject))
    return verdict(
      ask,
      who,
      'unknown',
      by,
      `The reader does not let ${who.name} ask: it decides rules for identities only.`,
    )
  const asked = { subject, ...(ask.target === undefined ? {} : { target: ask.target }) }
  const refusedWhy = `Its condition does not hold for ${who.name} on this dataset.`
  /** A verdict decided for another caller or target than the one asked is no verdict on it. */
  const misread = (situation: { subject?: string; target?: string }): Verdict | undefined => {
    if (situation.subject !== undefined && situation.subject !== subject)
      return verdict(
        ask,
        who,
        'unknown',
        by,
        `The reader decided it for another caller than ${who.name}.`,
      )
    if (situation.target !== undefined && situation.target !== ask.target)
      return verdict(
        ask,
        who,
        'unknown',
        by,
        ask.target === undefined
          ? 'The rule is decided on a Node the call names, and a static Method names none here.'
          : 'The reader decided it on another Node than this one.',
      )
    return undefined
  }
  if (depth === 'outcome') {
    const situation = situationFor(rule, access.data, asked)
    const result = check(rule, access.data, situation)
    const wrong = misread(situation)
    if (wrong) return wrong
    if (result.kind === 'undecidable')
      return verdict(ask, who, 'unknown', by, undecidableWords(result))
    const outcome = outcomeOf(result)
    if (outcome === undefined)
      return verdict(ask, who, 'unknown', by, 'The rule decides no permission here.')
    return verdict(
      ask,
      who,
      outcome,
      by,
      outcome === 'refused' ? refusedWhy : 'Its condition holds on this dataset.',
    )
  }
  const checked = checkRule(site, access.data, asked)
  if (checked.status === 'unread')
    return verdict(ask, who, 'unknown', by, checked.detail, { unread: checked })
  const { situation, result } = checked
  const wrong = misread(situation)
  if (wrong) return wrong
  if (result.kind === 'undecidable') return verdict(ask, who, 'unknown', by, checked.words)
  const outcome = outcomeOf(result)
  if (outcome === undefined)
    return verdict(ask, who, 'unknown', by, `The rule decides no permission here: ${checked.words}`)
  const proof = {
    nodes: checked.proof.nodes.filter((id) => id !== access.anyone),
    edges: [...checked.proof.edges],
  }
  const decided = { situation, ...(checked.fact === undefined ? {} : { fact: checked.fact }) }
  if (outcome === 'refused')
    return verdict(ask, who, 'refused', by, failingWhy(checked.failing) ?? refusedWhy, {
      proof,
      decided,
    })
  const path = pathOf(access, proof.edges)
  return verdict(
    ask,
    who,
    'allowed',
    by,
    path.length > 0
      ? 'Its condition holds through the Edges below.'
      : 'Its condition holds on this dataset.',
    { path, proof, decided },
  )
}

/**
 * The condition that fails first, quoted as the reader words it, and what the dataset showed. The
 * reader words a condition on the rule's own entity without it ("is owned by you"), one on another
 * with its entity ("the service … is owned by you"): quoted, either reads whole. Single quotes, as
 * the reader's words quote a relationship's name in double ones.
 */
export function failingWhy(failing: RuleVerdict['failing']): string | undefined {
  if (failing === undefined) return undefined
  const trim = (text: string) => text.replace(/[.\s]+$/, '')
  const detail = failing.detail === undefined ? '' : ` (${trim(failing.detail)})`
  return `It fails on ‘${trim(failing.words)}’${detail}.`
}

/** The sites of one slot on a Class or relationship, wherever its Domain's rules are read. */
function siteOf(
  access: Access,
  target: string,
  origin: string,
  slot: string,
): { site?: RuleSite; missing?: string } {
  const own = sitesOn(access.rules, target).find((site) => site.slot === slot)
  if (own || origin === access.model.origin) return own ? { site: own } : {}
  const foreign = access.rulesOf(origin)
  if (foreign === undefined)
    return {
      missing: `Its rules are ${originShort(origin)}’s, and the Bundle does not carry ${originShort(origin)}’s Schema.`,
    }
  if (foreign.unread) return { missing: foreign.unread.detail }
  const name = target.slice(target.lastIndexOf(':class.') + ':class.'.length)
  const site = sitesOn(foreign, `class.${name}`).find((candidate) => candidate.slot === slot)
  return site ? { site } : {}
}

function siteVerdict(
  access: Access,
  identity: string,
  ask: Ask,
  target: string,
  origin: string,
  depth: Depth = 'full',
): Verdict {
  const { site, missing } = siteOf(access, target, origin, ask.slot)
  if (missing !== undefined)
    return verdict(ask, whoOf(access, identity), 'unknown', { kind: 'none' }, missing)
  return decide(access, identity, site, ask, depth)
}

/** Whether `identity` may read the Node at `path`. */
export function readVerdict(
  access: Access,
  identity: string,
  path: string,
  depth: Depth = 'full',
): Verdict {
  const cls = access.model.classOf.get(path)
  const ask: Ask = {
    id: `read:${path}`,
    slot: 'read',
    object: endLabel(access.model, path),
    target: path,
    declarer: cls?.origin ?? access.model.origin,
  }
  if (cls === undefined)
    return verdict(
      ask,
      whoOf(access, identity),
      'unknown',
      { kind: 'none' },
      'The dataset holds no Node at this path.',
    )
  return siteVerdict(access, identity, ask, cls.target, cls.origin, depth)
}

function edgeOrigin(access: Access, edge: DataEdge): string {
  const key = relationKey(access.model, edge)
  return key.slice(0, key.indexOf(':class.'))
}

/** Whether `identity` may traverse — or, with `slot: 'read'`, read — the Edge. */
export function edgeVerdict(
  access: Access,
  identity: string,
  edge: DataEdge,
  slot: 'read' | 'traverse' = 'traverse',
  depth: Depth = 'full',
): Verdict {
  const origin = edgeOrigin(access, edge)
  const ask: Ask = {
    id: `${slot}:${edge.id}`,
    slot,
    object: `${edge.name} from ${endLabel(access.model, edge.from)} to ${endLabel(access.model, edge.to)}`,
    target: edge.id,
    declarer: origin,
  }
  return siteVerdict(access, identity, ask, edge.relationTarget, origin, depth)
}

/** The callables that work on a Class: its Methods, then the Domain's functions whose input points at it. */
export function callablesOf(access: Access, cls: DataClass): readonly CallableLink[] {
  const target = targetOf(access.bundle, cls.target)
  if (target.kind !== 'class') return []
  const behavior = behaviorOf(access.bundle, target, access.terms)
  if (behavior?.kind !== 'class') return []
  return [...behavior.methods.map((method) => method.fn), ...behavior.functions]
}

/**
 * Whether `identity` may call the callable keyed `key` (`Class.method`, or a function's name) on
 * the Node at `path`; a static Method is decided on no Node. None when the Schema declares no
 * such callable. A call allowed on a Node the identity may not read says so (`though`).
 */
export function callVerdict(
  access: Access,
  identity: string,
  key: string,
  path?: string,
  depth: Depth = 'full',
): Verdict | undefined {
  const decided = decideCall(access, identity, key, path, depth)
  if (decided?.outcome !== 'allowed' || decided.target === undefined) return decided
  if (readVerdict(access, identity, decided.target, 'outcome').outcome !== 'refused') return decided
  const who = whoOf(access, identity)
  // Anyone stands for no identity in particular: what it cannot read, not just anyone can.
  const though =
    identity === ANYONE ? 'though not just anyone can read it' : `though ${who.name} cannot read it`
  return {
    ...decided,
    though,
    sentence: sentenceOf('allowed', who, 'call', decided.object, though),
  }
}

function decideCall(
  access: Access,
  identity: string,
  key: string,
  path: string | undefined,
  depth: Depth,
): Verdict | undefined {
  const target = targetOf(access.bundle, callableTargetOf(key))
  if (target.kind !== 'function') return undefined
  const on = target.static ? undefined : path
  const ask: Ask = {
    id: `call:${key}`,
    slot: 'call',
    object: on === undefined ? key : `${key} on ${endLabel(access.model, on)}`,
    ...(on === undefined ? {} : { target: on }),
    declarer: access.model.origin,
    opens: target.id,
    ...(target.static ? { static: true } : {}),
  }
  const who = whoOf(access, identity)
  const auth = target.callable.auth
  if (subjectOf(access, identity) === undefined) return decide(access, identity, undefined, ask)
  if (auth === 'anonymous' || auth === 'authenticated')
    return verdict(
      ask,
      who,
      'allowed',
      { kind: 'contract', auth },
      auth === 'anonymous'
        ? 'Its contract admits anonymous callers: no Policy decides it.'
        : 'Its contract admits any signed-in caller: no Policy decides it.',
    )
  if (auth === undefined)
    return verdict(ask, who, 'unknown', { kind: 'none' }, 'Its contract names no access level.')
  return decide(
    access,
    identity,
    callRuleOf(access.rules, ruleTargetOf(target), auth, target.abstract),
    ask,
    depth,
  )
}

/** Whether `identity` may call each callable that works on the Node's Class, on the Node. */
export function callVerdicts(access: Access, identity: string, path: string): Verdict[] {
  const cls = access.model.classOf.get(path)
  if (cls === undefined) return []
  return callablesOf(access, cls).flatMap(
    (link) => callVerdict(access, identity, link.key, path) ?? [],
  )
}

/** How many of a Node's Edges are decided at once; the rest are counted, and decided when asked. */
export const TRAVERSE_LIMIT = 40

/** A Node's Edges, outgoing then incoming, a loop once. */
export function edgesOf(model: DatasetModel, path: string): DataEdge[] {
  return [
    ...(model.outgoing.get(path) ?? []),
    ...(model.incoming.get(path) ?? []).filter((edge) => edge.from !== path),
  ]
}

/**
 * Every verdict on a Node: read, traverse on each of its Edges (the first `TRAVERSE_LIMIT`, and how
 * many more there are), then each call.
 */
export function nodeVerdicts(
  access: Access,
  identity: string,
  path: string,
): {
  read: Verdict
  traverse: Verdict[]
  /** Edges of the Node not decided here */
  undecided: number
  calls: Verdict[]
} {
  const edges = edgesOf(access.model, path)
  return {
    read: readVerdict(access, identity, path),
    traverse: edges.slice(0, TRAVERSE_LIMIT).map((edge) => edgeVerdict(access, identity, edge)),
    undecided: Math.max(0, edges.length - TRAVERSE_LIMIT),
    calls: callVerdicts(access, identity, path),
  }
}

// ── reads ──

export interface ClassReads {
  readonly target: string
  readonly name: string
  readonly total: number
  readonly allowed: number
  readonly refused: number
  readonly unknown: number
}

export interface Reads {
  readonly identity: string
  /** each Node's read verdict decided so far (`outcome` depth), by path */
  readonly verdicts: ReadonlyMap<string, Verdict>
  readonly classes: readonly ClassReads[]
  readonly total: ClassReads
  /** Nodes not decided yet; 0 once every Node is */
  readonly pending: number
}

interface ReadsState {
  readonly verdicts: Map<string, Verdict>
  readonly counts: Map<string, { allowed: number; refused: number; unknown: number }>
  next: number
  last?: Reads
}

const reads = new WeakMap<Access, Map<string, ReadsState>>()

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/**
 * What an identity may read of the dataset, decided Node by Node in dataset order for at most
 * `budgetMs` and counted per Class; later calls go on where the last stopped. Each Node is decided
 * once per identity.
 */
export function readsSoFar(
  access: Access,
  identity: string,
  budgetMs = Number.POSITIVE_INFINITY,
  clock: () => number = now,
): Reads {
  let byIdentity = reads.get(access)
  if (!byIdentity) reads.set(access, (byIdentity = new Map()))
  let state = byIdentity.get(identity)
  if (!state) {
    state = {
      verdicts: new Map(),
      counts: new Map(
        access.model.classes.map((cls) => [cls.target, { allowed: 0, refused: 0, unknown: 0 }]),
      ),
      next: 0,
    }
    byIdentity.set(identity, state)
  }
  const { order } = access.model
  if (state.last && state.next >= order.length) return state.last
  const started = clock()
  const before = state.next
  while (state.next < order.length) {
    const node = order[state.next]!
    const one = readVerdict(access, identity, node.path, 'outcome')
    state.verdicts.set(node.path, one)
    const counts = state.counts.get(node.classTarget)
    if (counts) counts[one.outcome] += 1
    state.next += 1
    if (clock() - started >= budgetMs) break
  }
  if (state.last && state.next === before) return state.last
  const classes = access.model.classes.map((cls): ClassReads => ({
    target: cls.target,
    name: cls.name,
    total: cls.nodes.length,
    ...state.counts.get(cls.target)!,
  }))
  const total = classes.reduce<ClassReads>(
    (sum, each) => ({
      ...sum,
      total: sum.total + each.total,
      allowed: sum.allowed + each.allowed,
      refused: sum.refused + each.refused,
      unknown: sum.unknown + each.unknown,
    }),
    { target: '', name: 'every Class', total: 0, allowed: 0, refused: 0, unknown: 0 },
  )
  state.last = {
    identity,
    verdicts: new Map(state.verdicts),
    classes,
    total,
    pending: order.length - state.next,
  }
  return state.last
}

/** Everything an identity may read of the dataset, decided whole. */
export function readsOf(access: Access, identity: string): Reads {
  return readsSoFar(access, identity)
}
