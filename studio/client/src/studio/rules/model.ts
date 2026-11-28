import type {
  Catalogue,
  CatalogueEntry,
  Key,
  Meaning,
  PolicyDocument,
  Rule,
} from '@astrale-os/visual'

import {
  canonical,
  classesOf,
  idle,
  notationOf,
  parseNotation,
  readsCaller,
  renderPlain,
  textOf,
} from '@astrale-os/visual'

import { withArticle } from '../inspector/words'
import {
  bundleOf,
  catalogueOf,
  messageOf,
  policyRefsIn,
  refKey,
  unread,
  type DomainCatalogue,
  type RulesSource,
  type Unread,
  type UnreadReason,
} from './catalogue'
import { constraintsOf, type Invariant } from './constraints'

export type { RulesSource, Unread, UnreadReason } from './catalogue'

/**
 * Every rule of a Domain, by the place it sits: the Policy of each slot of each Class and
 * relationship, of each authorized Method and function (who), and each constraint the Schema
 * declares (what). Each rule is read by `@astrale-os/visual`, or carries why it cannot be.
 */

/** A Policy, which reads its caller, or a constraint, which never does. */
export type RuleKind = 'who' | 'what'

/** Where a rule sits, with the selection id that opens it. */
export type RuleOn =
  | { readonly kind: 'class' | 'relationship'; readonly name: string; readonly target: string }
  | {
      readonly kind: 'method'
      readonly owner: string
      readonly name: string
      readonly static: boolean
      readonly target: string
    }
  | { readonly kind: 'function'; readonly name: string; readonly target: string }
  /** A rule over the Schema as a whole: no declaration places one there yet. */
  | { readonly kind: 'schema'; readonly target: string }

/**
 * What the Schema writes at the site: a rule, the constants `true` or `false`, nothing for the
 * slot (`omitted`), no Policy for an authorized callable (`absent`), or a declared constraint.
 * What the Kernel admits where nothing or a constant is written is `kernelDefaultOf`'s.
 */
export type Written = 'rule' | 'true' | 'false' | 'omitted' | 'absent' | 'declared'

export type RuleReading = { readonly status: 'read'; readonly rule: Rule } | Unread

export interface RuleSite {
  /** Unique within the Domain: `<target>#<slot>`, a constraint's `<target>#require:<declaration>`. */
  readonly id: string
  readonly on: RuleOn
  /** `read`, `traverse`, `create`, `update`, `delete`, `call`, `require`; any slot a Schema adds. */
  readonly slot: string
  readonly kind: RuleKind
  /** A constraint's declaration as the Schema writes it (`noSelf`, `comment · incoming 1`); a Policy's slot. */
  readonly title: string
  readonly written: Written
  readonly reading: RuleReading
  /** The Policies the rule checks, by key: those it names itself first (`direct`), then those they check. */
  readonly policies: readonly { readonly key: Key; readonly direct: boolean }[]
}

/** A named Policy: its rule over the objects its uses check it on, and where it sits. */
export interface PolicyRule {
  readonly key: Key
  readonly name: string
  readonly origin: string
  readonly description?: string
  /** `policy.<key>` */
  readonly target: string
  readonly reading: RuleReading
  /** The sites whose rule checks it: `direct` when the site names it, else through another Policy. */
  readonly sitsOn: readonly { readonly site: string; readonly direct: boolean }[]
  /** The Policies its definition checks: those it names itself first (`direct`), then those they check. */
  readonly policies: readonly { readonly key: Key; readonly direct: boolean }[]
  /** The root Policies whose definition checks it. */
  readonly partOf: readonly Key[]
}

export interface DomainRules {
  readonly domainId: string
  /** Set when no rule of the Domain can be read: then it has no sites and no Policies. */
  readonly unread?: Unread
  readonly origin?: string
  readonly catalogue?: Catalogue
  readonly sites: readonly RuleSite[]
  /** The root's Policies, in declaration order. */
  readonly policies: readonly PolicyRule[]
  /** The Policies of other Domains, or of none, that the root's rules check. */
  readonly imported: readonly PolicyRule[]
}

/** The order a rule's slots are listed in; a slot it does not name follows them. */
export const SLOT_ORDER: readonly string[] = [
  'read',
  'traverse',
  'create',
  'update',
  'delete',
  'call',
  'require',
]

const slotRank = (slot: string) => {
  const rank = SLOT_ORDER.indexOf(slot)
  return rank < 0 ? SLOT_ORDER.length : rank
}

const known = new WeakMap<RulesSource, DomainRules>()

/** A bundle reply's rules, read once per reply. */
export function rulesOf(source: RulesSource): DomainRules {
  let found = known.get(source)
  if (found === undefined) {
    found = read(source)
    known.set(source, found)
  }
  return found
}

/** The selection id of a Class Key: its bare name in its own Domain, its exact key elsewhere. */
export function selectionIdOf(key: Key, origin: string | undefined): string {
  const local = `${origin}:class.`
  return key.startsWith(local) ? `class.${key.slice(local.length)}` : `class.${key}`
}

function read(source: RulesSource): DomainRules {
  const domain = catalogueOf(source)
  if (domain.status === 'unread')
    return { domainId: source.domainId, unread: domain, sites: [], policies: [], imported: [] }
  const root = bundleOf(source)!.root
  const { origin, catalogue } = domain
  const localTarget = (ref: { origin: string; name: string }) =>
    ref.origin === origin ? `class.${ref.name}` : `class.${ref.origin}:class.${ref.name}`

  const sites: RuleSite[] = []
  const checked = new Map<Key, { site: string; direct: boolean }[]>()
  const partOf = new Map<Key, Key[]>()
  const composed = new Map<Key, RuleSite['policies']>()
  const policyReadings = new Map<Key, RuleReading>()
  const defined = new Set<Key>()
  for (const use of domain.uses) {
    const { document } = use
    for (const key of Object.keys(document.policies)) defined.add(key)
    const named = policyRefsIn(document.use)
    const policies = [
      ...[...named].map((key) => ({ key, direct: true })),
      ...Object.keys(document.policies)
        .filter((key) => !named.has(key))
        .map((key) => ({ key, direct: false })),
    ]
    const placed = placeOf(document, root, localTarget)
    if (placed === undefined) {
      const key = refKey(
        (document.use as Extract<PolicyDocument['use'], { kind: 'policy' }>).policy,
      )
      policyReadings.set(key, use.reading)
      const own = policyRefsIn(document.policies[key])
      const checks = policies
        .filter((each) => each.key !== key)
        .map((each) => ({ key: each.key, direct: own.has(each.key) }))
      composed.set(key, [
        ...checks.filter((each) => each.direct),
        ...checks.filter((each) => !each.direct),
      ])
      for (const each of checks) partOf.set(each.key, [...(partOf.get(each.key) ?? []), key])
      continue
    }
    const site: RuleSite = { ...placed, kind: 'who', reading: use.reading, policies }
    sites.push(site)
    for (const each of policies)
      checked.set(each.key, [
        ...(checked.get(each.key) ?? []),
        { site: site.id, direct: each.direct },
      ])
  }

  const failed = (error: unknown): Unread =>
    unread(domain.closure ? 'refused' : 'no-closure', messageOf(error))
  for (const constraint of constraintsOf(root)) {
    const name = constraint.owner
    const target = `class.${name}`
    const reading: RuleReading =
      'status' in constraint.written
        ? constraint.written
        : constraintRule(domain, `${name} · ${constraint.declaration}`, constraint.written, failed)
    sites.push({
      id: `${target}#require:${constraint.declaration}`,
      on: { kind: constraint.ownerKind === 'edge' ? 'relationship' : 'class', name, target },
      slot: 'require',
      kind: 'what',
      title: constraint.declaration,
      written: 'declared',
      reading,
      policies: [],
    })
  }

  const policies = Object.values(root.policies).map((definition): PolicyRule => {
    const key = refKey(definition.ref)
    return {
      key,
      name: definition.ref.name,
      origin,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      target: `policy.${key}`,
      reading:
        policyReadings.get(key) ??
        (domain.closure
          ? unread(
              'unchecked',
              `No slot, Method or function of ${root.name} checks ${definition.ref.name}, so it has no object to be read over.`,
            )
          : unread(
              'no-closure',
              `No use of ${root.name} checks ${definition.ref.name} on an object the reader finds without the Schemas ${root.name} depends on.`,
            )),
      sitsOn: checked.get(key) ?? [],
      policies:
        composed.get(key) ??
        [...policyRefsIn(definition.expression)].map((each) => ({ key: each, direct: true })),
      partOf: partOf.get(key) ?? [],
    }
  })

  const own = new Set(policies.map((policy) => policy.key))
  const imported = [...checked.keys()]
    .filter((key) => !own.has(key))
    .map((key): PolicyRule => {
      const { origin: from, name } = parsePolicyKey(key)
      return {
        key,
        name,
        origin: from,
        target: `policy.${key}`,
        reading: defined.has(key)
          ? unread(
              'foreign',
              `${name} is declared by ${from}: its own Domain reads its definition.`,
            )
          : unread('missing-policy', `${key} is in no Schema of the Bundle.`),
        sitsOn: checked.get(key) ?? [],
        policies: composed.get(key) ?? [],
        partOf: partOf.get(key) ?? [],
      }
    })

  return {
    domainId: source.domainId,
    origin,
    catalogue,
    sites: sites.sort((a, b) => slotRank(a.slot) - slotRank(b.slot)),
    policies,
    imported,
  }
}

/** A Policy key's parts: `<origin>:policy.<name>`. */
const parsePolicyKey = (key: Key) => {
  const at = key.indexOf(':policy.')
  return { origin: key.slice(0, at), name: key.slice(at + ':policy.'.length) }
}

/** What a Schema writes for a rule it does write: a constant, or a rule. */
const writtenAs = (written: unknown): Written =>
  written === true ? 'true' : written === false ? 'false' : 'rule'

/** Where a Policy use sits: a Class slot, a Method or a function; none for a named Policy's own use. */
function placeOf(
  document: PolicyDocument,
  root: NonNullable<ReturnType<typeof bundleOf>>['root'],
  localTarget: (ref: { origin: string; name: string }) => string,
): Pick<RuleSite, 'id' | 'on' | 'slot' | 'title' | 'written'> | undefined {
  const { use } = document
  switch (use.kind) {
    case 'slot': {
      const target = localTarget(use.class)
      const declared = root.classes[use.class.name]
      const written: unknown =
        declared?.ref.origin === use.class.origin
          ? (declared.policies as Record<string, unknown>)[use.operation]
          : use.rule
      return {
        id: `${target}#${use.operation}`,
        on: {
          kind: declared?.kind === 'edge' ? 'relationship' : 'class',
          name: use.class.name,
          target,
        },
        slot: use.operation,
        title: use.operation,
        written: written === undefined ? 'omitted' : writtenAs(written),
      }
    }
    case 'method': {
      const target = `${localTarget(use.class)}.method.${use.method}`
      return {
        id: `${target}#call`,
        on: { kind: 'method', owner: use.class.name, name: use.method, static: use.static, target },
        slot: 'call',
        title: 'call',
        written: use.rule === undefined ? 'absent' : writtenAs(use.rule),
      }
    }
    case 'function': {
      const target = `function.${use.function.name}`
      return {
        id: `${target}#call`,
        on: { kind: 'function', name: use.function.name, target },
        slot: 'call',
        title: 'call',
        written: use.rule === undefined ? 'absent' : writtenAs(use.rule),
      }
    }
    case 'policy':
      return undefined
  }
}

/**
 * A constraint's invariant read as a rule of the Domain's catalogue, beside its Policy uses. It is
 * read from its notation, which names the Classes of every Domain the root depends on, and keeps
 * its Rules document as its source (see `constraints.ts`).
 */
function constraintRule(
  domain: DomainCatalogue,
  id: string,
  invariant: Invariant,
  failed: (error: unknown) => Unread,
): RuleReading {
  const { catalogue } = domain
  const schema = catalogue.words.schema
  try {
    const frame = parseNotation(invariant.notation, schema)
    if (frame.kind !== 'constraint')
      throw new Error(`${id} reads as ${withArticle(frame.kind)}, not as a constraint.`)
    const source = { language: 'rules', document: invariant.document } as const
    const written: Meaning = {
      format: 'astrale.meaning/1',
      source: { language: 'rules', name: id },
      schema: schema.revision,
      frame,
    }
    const entry: CatalogueEntry = { id, title: id, family: 'constraint', source }
    const rule: Rule = { catalogue, entry, ...canonical(written, schema) }
    // The notation reads a Key it does not know as a name; a Class the Bundle lacks is not read.
    const missing = classesOf(rule).find((key) => schema.classes[key] === undefined)
    if (missing !== undefined) throw new Error(`${missing} is in no Schema of the Bundle.`)
    return { status: 'read', rule }
  } catch (error) {
    return failed(error)
  }
}

/** The sites of a Class or relationship (`class.X`, or `edge.X` as the Studio also selects one). */
export function sitesOn(rules: DomainRules, target: string): RuleSite[] {
  const at = target.startsWith('edge.') ? `class.${target.slice('edge.'.length)}` : target
  return rules.sites.filter(
    (site) =>
      (site.on.kind === 'class' || site.on.kind === 'relationship') && site.on.target === at,
  )
}

/**
 * The call rule of a Method (`class.X.method.m`, or `edge.X.method.m`) or a function
 * (`function.f`). An authorized callable without a read use is returned unread: why the Domain
 * has no reading; an imported Class's Method, whose rule its own Domain reads (`foreign`); an
 * abstract contract, whose implementations declare its Policy, or any other (`not-enumerated`).
 * One open to anyone or to any signed-in caller has no rule (`undefined`).
 */
export function callRuleOf(
  rules: DomainRules,
  target: string,
  auth: 'anonymous' | 'authenticated' | 'authorized' | undefined,
  contract = false,
): RuleSite | undefined {
  const at = target.startsWith('edge.') ? `class.${target.slice('edge.'.length)}` : target
  const found = rules.sites.find((site) => site.slot === 'call' && site.on.target === at)
  if (found !== undefined || auth !== 'authorized') return found
  const method = /^class\.(.+)\.method\.([^.]+)$/.exec(at)
  const owner = method === null ? undefined : classOfTarget(`class.${method[1]}`)
  return {
    id: `${at}#call`,
    on:
      method === null
        ? { kind: 'function', name: at.slice('function.'.length), target: at }
        : { kind: 'method', owner: owner!.name, name: method[2]!, static: false, target: at },
    slot: 'call',
    kind: 'who',
    title: 'call',
    written: 'absent',
    reading:
      rules.unread ??
      (owner?.origin !== undefined && owner.origin !== rules.origin
        ? unread(
            'foreign',
            `${owner.name} is declared by ${owner.origin}: its own Domain reads its rules.`,
          )
        : contract
          ? unread(
              'not-enumerated',
              'An abstract contract: each implementation declares its own Policy.',
            )
          : unread(
              'not-enumerated',
              'The canonical Schema holds no authorized use for this callable, so the reader has no rule for it.',
            )),
    policies: [],
  }
}

/**
 * What the Kernel admits at a site whose Schema writes no rule, or writes `false`, in the words of
 * its caller rule (Kernel `runtime/authorization/closure`): Root and the Domain that declares the
 * Class or callable pass every site; beside them, an observation with no rule admits every caller
 * and one written `false` no other; a write with no rule admits only a caller holding that
 * operation's capability on the Class; an authorized callable with no Policy, or `false`, no other.
 * Undefined where the Schema writes a rule, `true` or a constraint: the reading says it.
 * `domain` names the declaring Domain (`admin`); `slots` says several sites of one Class written
 * alike at once (`create`, `update`, `delete`). One short sentence, read on hover: what shows is
 * the mark's few words (`ADMITS`).
 */
export function kernelDefaultOf(
  site: RuleSite,
  domain: string,
  slots: readonly string[] = [site.slot],
): string | undefined {
  const { on, written } = site
  if (written !== 'omitted' && written !== 'false' && written !== 'absent') return undefined
  if (on.kind === 'method' || on.kind === 'function')
    return `Only Root and ${domain}, its Domain, may call it.`
  if (on.kind !== 'class' && on.kind !== 'relationship') return undefined
  const verbs = listed(slots, 'or')
  if (slots.every((slot) => slot === 'read' || slot === 'traverse'))
    return written === 'false'
      ? `Only Root and ${domain}, its Domain, may ${verbs} one.`
      : `Every caller may ${verbs} one.`
  if (slots.every((slot) => slot === 'create' || slot === 'update' || slot === 'delete'))
    return `Only Root, ${domain} (its Domain) and holders of ${slots.length > 1 ? 'that operation’s' : `the ${verbs}`} capability on ${on.name} may ${verbs} one.`
  return undefined
}

/** Words in a list: `read`, `read or traverse`, `create, update or delete`. */
const listed = (words: readonly string[], last: 'and' | 'or') =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}`

/** A Class selection id's parts (`class.X`, `edge.X`, `class.<origin>:class.X`): its name, and its Domain when it names one. */
export function classOfTarget(target: string): { name: string; origin?: string } {
  const token = target.replace(/^(class|edge)\./, '')
  const at = token.lastIndexOf(':class.')
  return at < 0
    ? { name: token }
    : { name: token.slice(at + ':class.'.length), origin: token.slice(0, at) }
}

/** A Policy by its key (`<origin>:policy.<name>`): the root's own, or one its rules check. */
export function policyRuleOf(rules: DomainRules, key: Key): PolicyRule | undefined {
  return (
    rules.policies.find((policy) => policy.key === key) ??
    rules.imported.find((policy) => policy.key === key)
  )
}

/**
 * One thing a rule names, as a reader lists it: a Class with the Classes that extend it folded
 * into it, every node Class of a Domain at once, a relationship it follows, or one Core Node.
 */
export type RuleName =
  | {
      readonly kind: 'class'
      readonly key: Key
      readonly target: string
      /** How many Classes that extend it the rule's set also holds, said with it rather than beside it. */
      readonly folded: number
    }
  /**
   * A set holding every node: the Kernel's `Node` and the Classes that extend it, or, where the
   * Bundle holds no Schema of the Domain's dependencies, every node Class of the Domain (`origin`).
   */
  | { readonly kind: 'every'; readonly origin?: string; readonly count: number }
  | { readonly kind: 'relationship'; readonly key: Key; readonly target: string }
  /** A Core Node the rule names by its path (`admin.astrale.ai:core.console.member`). */
  | {
      readonly kind: 'node'
      readonly name: string
      readonly path: string
      readonly classes: readonly { readonly key: Key; readonly target: string }[]
    }

/** What a reading shows of a rule: its sentence, its notation, what it walks, whether it reads its caller. */
export interface RuleView {
  readonly sentence: string
  readonly notation: string
  /** The selection ids of the Classes and relationships it walks: its entities' Classes, then the relations it follows. */
  readonly walks: readonly string[]
  /** What it names, in the order it names them: its Classes (descendants folded), relationships, Core Nodes. */
  readonly names: readonly RuleName[]
  readonly readsCaller: boolean
  /**
   * The note the reader ends its words with, whom “you” stands for where that departs from the
   * convention: a list of readings states each different note once, not under each reading.
   */
  readonly you?: string
  /** It changes nothing: a right or a ban for no one or nothing, a guard that never fails, a constraint that always holds. */
  readonly idle: boolean
}

const views = new WeakMap<Rule, RuleView>()

/** The note the reader ends a reading with (whom “you” stands for, where it departs from the convention). */
function noteIn(text: ReturnType<typeof textOf>): string | undefined {
  const notes = text.blocks.flatMap((block) =>
    block.kind === 'paragraph' &&
    block.runs.length > 0 &&
    block.runs.every((run) => run.modifiers?.includes('note') === true)
      ? [block.runs.map((run) => run.text).join('')]
      : [],
  )
  return notes.length === 0 ? undefined : notes.join(' ')
}

/** A rule's view, made on first use: realizing a reading is the reader's costly step. */
export function ruleView(rule: Rule): RuleView {
  let view = views.get(rule)
  if (view === undefined) {
    const origin = rule.catalogue.origin
    const keys = [...classesOf(rule), ...relationsIn(rule.meaning)]
    const text = textOf(rule, 'en')
    const you = noteIn(text)
    view = {
      sentence: renderPlain(text),
      notation: renderPlain(notationOf(rule)),
      walks: [...new Set(keys.map((key) => selectionIdOf(key, origin)))],
      names: namesOf(rule),
      readsCaller: readsCaller(rule),
      ...(you === undefined ? {} : { you }),
      idle: idle(rule.meaning.frame),
    }
    views.set(rule, view)
  }
  return view
}

/**
 * What a rule names. Each set of Classes an entity ranges over is said by its tops: the Classes no
 * other member of the set extends, each carrying how many of the set's other Classes extend it;
 * a set holding every node Class of a Domain is said as that. Relationships and Core Nodes follow,
 * each once, in the order the rule reaches them.
 */
const KERNEL_NODE: Key = 'kernel.astrale.ai:class.Node'

function namesOf(rule: Rule): RuleName[] {
  const origin = rule.catalogue.origin
  const facts = rule.catalogue.words.schema.classes
  const ancestors = (key: Key): Set<Key> => {
    const out = new Set<Key>()
    const pending = [...(facts[key]?.extends ?? [])]
    while (pending.length > 0) {
      const next = pending.pop()!
      if (out.has(next)) continue
      out.add(next)
      pending.push(...(facts[next]?.extends ?? []))
    }
    return out
  }
  const nodesOf = (domain: string) =>
    Object.entries(facts).filter(
      ([key, cls]) => cls.kind === 'node' && key.startsWith(`${domain}:`),
    )

  const classes = new Map<Key, number>()
  /** by origin; `''` for every node of every Domain */
  const every = new Map<string, number>()
  const relations = new Set<Key>()
  const nodes = new Map<string, Extract<RuleName, { kind: 'node' }>>()
  const named = (set: readonly Key[]) => {
    const members = new Set(set)
    if (members.has(KERNEL_NODE)) {
      every.set('', Math.max(every.get('') ?? 0, members.size))
      return
    }
    const domain = set[0]?.slice(0, set[0].indexOf(':'))
    const all = domain === undefined ? [] : nodesOf(domain)
    if (all.length > 1 && all.length === members.size && all.every(([key]) => members.has(key))) {
      every.set(domain!, all.length)
      return
    }
    const tops = set.filter((key) => ![...ancestors(key)].some((parent) => members.has(parent)))
    for (const top of tops) {
      const folded = set.filter((key) => key !== top && ancestors(key).has(top)).length
      classes.set(top, Math.max(classes.get(top) ?? 0, folded))
    }
  }
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) walk(each)
    else if (value !== null && typeof value === 'object') {
      const node = value as {
        kind?: unknown
        classes?: unknown
        relation?: unknown
        name?: unknown
        locator?: { path?: unknown }
      }
      const set = Array.isArray(node.classes) ? (node.classes as Key[]) : []
      if (node.kind === 'entity') named(set)
      else if (node.kind === 'individual' && typeof node.locator?.path === 'string') {
        const path = node.locator.path
        if (!nodes.has(path))
          nodes.set(path, {
            kind: 'node',
            name: typeof node.name === 'string' ? node.name : path,
            path,
            classes: set.map((key) => ({ key, target: selectionIdOf(key, origin) })),
          })
      } else if (
        (node.kind === 'related' || node.kind === 'step') &&
        typeof node.relation === 'string'
      )
        relations.add(node.relation)
      for (const each of Object.values(value)) walk(each)
    }
  }
  walk(rule.meaning.frame)
  return [
    ...[...classes].map(([key, folded]): RuleName => ({
      kind: 'class',
      key,
      target: selectionIdOf(key, origin),
      folded,
    })),
    ...[...every].map(([domain, count]): RuleName =>
      domain === '' ? { kind: 'every', count } : { kind: 'every', origin: domain, count },
    ),
    ...[...relations].map((key): RuleName => ({
      kind: 'relationship',
      key,
      target: selectionIdOf(key, origin),
    })),
    ...nodes.values(),
  ]
}

/** Every relation a Meaning follows: the Edge Classes of its `related` nodes and of its path steps. */
function relationsIn(meaning: Meaning): Key[] {
  const out: Key[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) walk(each)
    else if (value !== null && typeof value === 'object') {
      const node = value as { kind?: unknown; relation?: unknown }
      if ((node.kind === 'related' || node.kind === 'step') && typeof node.relation === 'string')
        out.push(node.relation)
      for (const each of Object.values(value)) walk(each)
    }
  }
  walk(meaning.frame)
  return out
}

/** How many of a Domain's rules are read, and why the others are not. */
export interface RuleCounts {
  readonly sites: { readonly read: number; readonly unread: Partial<Record<UnreadReason, number>> }
  readonly policies: {
    readonly read: number
    readonly unread: Partial<Record<UnreadReason, number>>
  }
}

export function countsOf(rules: DomainRules): RuleCounts {
  const tally = (readings: readonly RuleReading[]) => {
    const unreadBy: Partial<Record<UnreadReason, number>> = {}
    let read = 0
    for (const reading of readings)
      if (reading.status === 'read') read++
      else unreadBy[reading.reason] = (unreadBy[reading.reason] ?? 0) + 1
    return { read, unread: unreadBy }
  }
  return {
    sites: tally(rules.sites.map((site) => site.reading)),
    policies: tally(rules.policies.map((policy) => policy.reading)),
  }
}
