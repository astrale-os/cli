/**
 * Rules lens: what is allowed here, the constraints, and where nothing is written. The
 * Structure map, its relationships thin, each Class card listing the rules that sit on it.
 *
 * - A card reads one row per operation, in order: reading (`read`, `traverse`), then writing
 *   (`create`, `update`, `delete`), then any other slot; then the call rules of its Methods,
 *   one row or a fold (`calls`) holding a row per rule, each naming the Methods it guards; then
 *   its constraints, one row or a fold (`constraints`).
 * - Each operation wears its own hue (`RuleOp`): observing in its own, writing and calling in
 *   their verb's; constraints wear theirs. Each row starts with its mark (`markOf`): whom the
 *   rule admits — a Policy decides, every caller, any signed-in caller, Root, the Domain and
 *   capability holders, only Root and the Domain — hollow where the Kernel's default applies.
 * - A row reads the rule as a short phrase, in the reader's words; its title is the sentence.
 *   A row whose rule reads alike an earlier one of its group says so (`same as read`). A fixed
 *   constraint reads as its relationship and form (`host_runs_release · at most one`). A slot
 *   left to the Kernel says so quietly, and whom the default admits, in its mark's words; the
 *   title says why.
 * - A constraint sits on the cards of the Classes it ranges over: an end's count on the
 *   Classes that end accepts, `no self` on the Classes the relationship joins — where one Node
 *   could stand at both ends, as Structure marks it.
 * - A relationship is toned `traverse` where its traverse is written, and carries its rules:
 *   not drawn as rows, but lit wherever one is selected.
 * - Functions declared on no Class stand in one "Domain functions" card, one row per rule.
 * - A fold holds its rows whether open or not: the reader opens it, or a selection raises its
 *   card with it open (`foldsOpenedBy`), and the map lays out only what the reader opened.
 *
 * The Index lists the rules themselves: the Policies, each with the number of places it sits
 * and the mark of each operation it decides, then the forms of constraint.
 *
 * Focus: a rule whose walk reaches a Class or relationship the map does not draw brings it in.
 * Nothing else a selection does changes the map's layout.
 *
 * Options:
 * - `unwritten` lights only the rows of slots the Schema leaves to the Kernel's default.
 */

import type { IrClass, IrEndpoint, StudioSchemaBundle } from '@shared/contracts/schema'

import { renderPlain, type Rule, textOf } from '@astrale-os/visual'
import { type IrClassRef } from '@shared/schema/identity'

import type {
  LensOption,
  LensOptions,
  Scene,
  SceneEnd,
  SceneEntry,
  SceneGroup,
  SceneLink,
  SceneNode,
  SceneRule,
  SceneRuleRef,
  SceneWalkStep,
} from '../scene/types'

import { isKernelClass, resolveClass } from '../../schema-studio/inheritance'
import {
  ADMITS,
  admissionLabel,
  contractWords,
  distinctMarks,
  markOf,
  opOf,
} from '../rules/admission'
import {
  callRuleOf,
  classOfTarget,
  type DomainRules,
  kernelDefaultOf,
  type PolicyRule,
  policyRuleOf,
  type RuleSite,
  rulesOf,
  SLOT_ORDER,
} from '../rules/model'
import { phraseIn } from './rule-phrase'
import { walkOf, walkStepsOf } from './rule-walk'
import { classTarget, endpointRefs, originShort, projectStructure } from './structure'

export const RULES_OPTIONS: LensOption[] = [
  {
    id: 'unwritten',
    label: 'Unwritten only',
    description: 'Light only the slots the Schema leaves to the Kernel’s default',
    default: false,
    icon: 'unwritten',
  },
]

/** The card of the functions declared on no Class. */
export const DOMAIN_FUNCTIONS = 'rules.functions'

const WHO_GROUP = 'rules.who'
const WHAT_GROUP = 'rules.what'
const OBSERVE: readonly string[] = ['read', 'traverse']
const WRITE: readonly string[] = ['create', 'update', 'delete']

/** A constraint's form, as the Index lists it, by the declaration it reads. */
const FORMS: readonly { id: string; label: string; test: (declaration: string) => boolean }[] = [
  { id: 'no-self', label: 'no self', test: (title) => title === 'noSelf' },
  { id: 'acyclic', label: 'acyclic', test: (title) => title === 'acyclic' },
  { id: 'exactly-one', label: 'exactly one', test: (title) => / · \w+ 1$/.test(title) },
  { id: 'at-most-one', label: 'at most one', test: (title) => / · \w+ 0\.\.1$/.test(title) },
  { id: 'at-least-one', label: 'at least one', test: (title) => / · \w+ 1\.\.\*$/.test(title) },
  { id: 'unique', label: 'unique', test: (title) => title.startsWith('unique ') },
  { id: 'immutable', label: 'immutable', test: (title) => title.includes(' · immutable ') },
  { id: 'auto', label: 'set by the Kernel', test: (title) => title.includes(' · auto on ') },
]

/** A constraint's form: its selection id (`constraint.no-self`) and name; a declaration of no listed form is its own. */
export function constraintFormOf(site: RuleSite): { id: string; label: string } {
  const form = FORMS.find((each) => each.test(site.title))
  return form
    ? { id: `constraint.${form.id}`, label: form.label }
    : { id: `constraint.${site.title}`, label: site.title }
}

/** The sites a constraint form (`constraint.<form>`) stands for. */
export function constraintSites(rules: DomainRules, id: string): RuleSite[] {
  return rules.sites.filter((each) => each.kind === 'what' && constraintFormOf(each).id === id)
}

/** The ids of the sites whose rule checks a Policy (`policy.<key>`). */
export function policySites(rules: DomainRules, id: string): string[] {
  return policyRuleOf(rules, id.slice('policy.'.length))?.sitsOn.map((each) => each.site) ?? []
}

/**
 * The card a rule selection belongs to: the Class of a site, a fold or a Method
 * (`class.X#read`, `class.X.method.m#call`, `function.X.m`), the Domain functions card for a
 * function (`function.f`, `function.f#call`); itself for anything else.
 */
export function ruleOwnerOf(id: string): string {
  if (/^function\.[^.#]+(#call)?$/.test(id)) return DOMAIN_FUNCTIONS
  const method = /^function\.([^.]+)\.[^.]+$/.exec(id)
  if (method) return `class.${method[1]}`
  const bare = id.replace(/#.*$/, '')
  return bare.includes(':class.') ? bare : bare.replace(/\.method\.[^.]+$/, '')
}

const walks = new WeakMap<Rule, string[]>()
/** What a rule walks, made once per rule. */
function walked(rule: Rule): string[] {
  let found = walks.get(rule)
  if (!found) {
    found = walkOf(rule)
    walks.set(rule, found)
  }
  return found
}

const numbered = new WeakMap<Rule, SceneWalkStep[]>()
/** A rule's steps as the map numbers them, beside what each numbers, made once per rule. */
function stepsNumbered(rule: Rule): SceneWalkStep[] {
  let found = numbered.get(rule)
  if (!found) {
    found = walkStepsOf(rule).flatMap((step) =>
      step.marks.map((id) => ({ id, number: step.number })),
    )
    numbered.set(rule, found)
  }
  return found
}

/** A site written alike another reads alike: same constant or same condition, without realizing either. */
function alikeKey(site: RuleSite): string {
  if (site.written === 'omitted' || site.written === 'absent' || site.written === 'false')
    return site.written
  if (site.reading.status === 'unread') return `unread|${site.reading.detail}`
  const frame = site.reading.rule.meaning.frame as { condition?: unknown }
  return `${site.written}|${JSON.stringify(frame.condition ?? frame)}`
}

/**
 * A row where the Kernel's default applies: what the Schema wrote, quietly, and whom that
 * admits in a word. What the default admits in full is `kernelDefaultOf`'s to say, in the
 * row's title and the Inspector.
 */
const KERNEL_DEFAULT = {
  unwritten: 'Kernel default',
  false: 'Written false',
} as const

const unwrittenSite = (site: RuleSite) => site.written === 'omitted' || site.written === 'absent'

/** What a site walks, for a rule read: what selecting its row lights. */
function refOf(site: RuleSite, also: readonly string[] = []): SceneRuleRef {
  const rule =
    site.reading.status === 'read' && site.written !== 'omitted' && site.written !== 'absent'
      ? site.reading.rule
      : undefined
  const walk = rule ? walked(rule) : []
  const steps = rule ? stepsNumbered(rule) : []
  const op = site.kind === 'who' ? opOf(site.slot) : undefined
  const mark = markOf(site)
  return {
    id: site.id,
    ...(also.length > 0 ? { also: [...also] } : {}),
    tone: site.kind,
    ...(op ? { op } : {}),
    ...(mark ? { marks: [mark] } : {}),
    ...(walk.length > 0 ? { walk } : {}),
    ...(steps.length > 0 ? { steps } : {}),
  }
}

/**
 * A site as a card row: the rule's phrase — a Policy's condition (`you administer the fleet
 * that contains it`), a constraint's sentence — or what applies where nothing is written.
 */
function siteRow(
  site: RuleSite,
  label: string,
  domain: string,
  also: readonly string[] = [],
  slots: readonly string[] = [site.slot],
): SceneRule {
  const ref = refOf(site, also)
  if (ref.marks?.[0]?.admits === 'unread' && site.reading.status === 'unread')
    return { ...ref, label, text: site.reading.detail, title: site.reading.detail, unread: true }
  if (site.written === 'omitted' || site.written === 'absent' || site.written === 'false') {
    // whom the default admits, whole, in its mark's words: holders never read as all it admits
    const admits = ref.marks?.[0]?.admits
    const said =
      admits === undefined || admits === 'policy' || admits === 'unread'
        ? undefined
        : ADMITS[admits]
    const text = `${site.written === 'false' ? KERNEL_DEFAULT.false : KERNEL_DEFAULT.unwritten}${said ? ` · ${said}` : ''}`
    return {
      ...ref,
      label,
      text,
      title: kernelDefaultOf(site, domain, slots) ?? text,
      ...(unwrittenSite(site) ? { unwritten: true } : {}),
    }
  }
  if (site.reading.status === 'unread')
    return { ...ref, label, text: site.reading.detail, title: site.reading.detail, unread: true }
  const reading = textOf(site.reading.rule, 'en')
  const sentence = renderPlain(reading)
  // A rule with no condition of its own reads whole.
  const text = (site.kind === 'who' && phraseIn(reading, 'f/condition')) || sentence
  return { ...ref, label, text, title: sentence }
}

/** Where a who-slot reads: observing (`read`, `traverse`) first, writing next, any other slot after. */
const slotOrder = (site: RuleSite) =>
  OBSERVE.includes(site.slot) ? 0 : WRITE.includes(site.slot) ? 1 : 2

const slotRank = (site: RuleSite) => {
  const rank = SLOT_ORDER.indexOf(site.slot)
  return rank < 0 ? SLOT_ORDER.length : rank
}

/**
 * The who-sites of one Class as its rows say them: one per operation, in slot order. A row
 * whose rule reads alike an earlier one of its group (observing, writing) says so instead of
 * saying it again: `same as read`.
 */
function operationRows(sites: readonly RuleSite[], domain: string): SceneRule[] {
  const first = new Map<string, RuleSite>()
  return [...sites]
    .sort((a, b) => slotOrder(a) - slotOrder(b) || slotRank(a) - slotRank(b))
    .map((site) => {
      const row = siteRow(site, site.slot, domain)
      if (slotOrder(site) === 2) return row
      const key = `${slotOrder(site)}|${alikeKey(site)}`
      const earlier = first.get(key)
      if (!earlier) {
        first.set(key, site)
        return row
      }
      return { ...row, text: `same as ${earlier.slot}` }
    })
}

/**
 * The site a rule id names: one the Schema writes, else the call rule of a Method or
 * function (`class.X.method.m#call`, `function.f#call`) as `callRuleOf` reads it.
 */
export function ruleSiteOf(bundle: StudioSchemaBundle, id: string): RuleSite | undefined {
  const rules = rulesOf(bundle)
  const found = rules.sites.find((each) => each.id === id)
  if (found || !bundle.ir || !id.endsWith('#call')) return found
  const target = id.slice(0, -'#call'.length)
  const method = /^class\.([^.]+)\.method\.([^.]+)$/.exec(target)
  const declared = method
    ? bundle.ir.classes[method[1]!]?.methods[method[2]!]
    : bundle.ir.functions[target.slice('function.'.length)]
  return declared ? callableOf(rules, target, '', declared).site : undefined
}

/**
 * A callable: its call rule's id, its selection id (`function.Host.rename`, `function.f`) and
 * name, and its call rule, or what its contract opens it to: anyone, or anyone signed in.
 */
interface Callable {
  id: string
  select: string
  label: string
  site?: RuleSite
  auth?: 'anonymous' | 'authenticated' | 'authorized'
}

function callableOf(
  rules: DomainRules,
  target: string,
  label: string,
  declared: { auth?: Callable['auth']; abstract?: boolean },
): Callable {
  const site = callRuleOf(rules, target, declared.auth, declared.abstract === true)
  const method = /^class\.([^.]+)\.method\.([^.]+)$/.exec(target)
  return {
    id: site?.id ?? `${target}#call`,
    select: method ? `function.${method[1]}.${method[2]}` : target,
    label,
    ...(site ? { site } : {}),
    auth: declared.auth,
  }
}

/** The callables of `functions` by name, in name order. */
const callablesOf = (
  rules: DomainRules,
  target: (name: string) => string,
  functions: Record<string, { auth?: Callable['auth']; abstract?: boolean }>,
) =>
  Object.entries(functions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, declared]) => callableOf(rules, target(name), name, declared))

/** What a callable's row reads: its rule as written, alike; the Kernel's default; or its contract. */
function callKey(callable: Callable): string {
  if (!callable.site) return `open|${callable.auth}`
  return unwrittenSite(callable.site) ? 'unwritten' : alikeKey(callable.site)
}

/** No rule decides who calls: the Kernel's default does, or the callable's contract opens it. */
const quietCall = ({ site }: Callable) => !site || site.written !== 'rule'

/**
 * Callables in rows, one per rule: those whose rule reads alike share a row, which names
 * them after its phrase; the rules written come first, then what stands where none is.
 */
function callRowsOf(
  callables: readonly Callable[],
  label: string,
  domain: string,
  unwrittenOnly: boolean,
): SceneRule[] {
  const groups = new Map<string, Callable[]>()
  for (const callable of callables)
    groups.set(callKey(callable), [...(groups.get(callKey(callable)) ?? []), callable])
  return [...groups.values()]
    .sort((a, b) => Number(quietCall(a[0]!)) - Number(quietCall(b[0]!)))
    .map((same) => {
      const [first, ...rest] = same
      const row = callRow(first!, label, domain)
      const also = [...(row.also ?? []), ...rest.map((callable) => callable.id)]
      return weigh(
        {
          ...row,
          ...(also.length > 0 ? { also } : {}),
          names: same.map((callable) => ({
            id: callable.select,
            rule: callable.id,
            label: callable.label,
          })),
        },
        unwrittenOnly,
        row.unwritten === true,
      )
    })
}

function callRow(callable: Callable, label: string, domain: string): SceneRule {
  if (callable.site) return siteRow(callable.site, label, domain)
  const open = callable.auth === 'anonymous'
  return {
    id: callable.id,
    op: 'call',
    marks: [markOf(undefined, callable.auth)!],
    label,
    text: admissionLabel(open ? 'open' : 'signed-in'),
    title: contractWords(callable.auth),
    tone: 'who',
  }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** How the `unwritten` option weighs a row: lit where the Kernel's default applies. */
const weigh = (row: SceneRule, on: boolean, unwritten: boolean): SceneRule =>
  on ? { ...row, emphasis: unwritten ? 'lit' : 'dim' } : row

const built = new WeakMap<StudioSchemaBundle, Map<string, Scene>>()

export function projectRules(
  bundle: StudioSchemaBundle,
  options: LensOptions,
  focus?: string,
): Scene {
  const unwrittenOnly = options.unwritten === true
  const key = [
    'rules',
    bundle.domainId,
    bundle.renderFingerprint,
    unwrittenOnly ? 'unwritten' : '',
    focus ?? '',
  ].join(':')
  let cache = built.get(bundle)
  if (!cache) {
    cache = new Map()
    built.set(bundle, cache)
  }
  const known = cache.get(key)
  if (known) return known

  const structure = projectStructure(bundle, {})
  const ir = bundle.ir
  if (!ir) return { ...structure, key }
  const rules = rulesOf(bundle)
  const domain = originShort(ir.domain)

  const nodes = structure.nodes.map(
    ({ counts: _counts, badges: _badges, rows: _rows, ...node }): SceneNode => node,
  )
  const links = structure.links.map((link) => ({ ...link }))
  const groups = [...structure.groups]
  const classes = new Set(nodes.filter((node) => node.kind === 'class').map((node) => node.id))
  const relationships = new Map(links.map((link) => [link.id, link]))

  // The constraints on a Class: what it declares itself, and each constraint of a relationship
  // on the Classes the constraint ranges over, else on the Classes the relationship joins.
  const holds = new Map<string, RuleSite[]>()
  for (const site of rules.sites) {
    if (site.kind !== 'what') continue
    const owner = site.on.target
    const link = relationships.get(owner)
    if (site.title === 'noSelf' && !link?.marks?.includes('no self')) continue
    let on = classes.has(owner) ? [owner] : []
    if (on.length === 0 && site.reading.status === 'read') {
      const walk = walked(site.reading.rule)
      const first = walk.findIndex((id) => relationships.has(id) || isRelationship(bundle, id))
      on = walk.slice(0, first < 0 ? walk.length : first).filter((id) => classes.has(id))
    }
    if (on.length === 0)
      on = [...new Set([...(link?.from.nodes ?? []), ...(link?.to.nodes ?? [])])].filter((id) =>
        classes.has(id),
      )
    for (const id of on) holds.set(id, [...(holds.get(id) ?? []), site])
  }

  for (const node of nodes) {
    if (!classes.has(node.id)) continue
    const name = node.id.slice('class.'.length)
    const member = ir.classes[name]
    if (!member) continue
    const sites = rules.sites.filter(
      (site) => site.kind === 'who' && site.on.kind === 'class' && site.on.target === node.id,
    )
    const who = operationRows(sites, domain).map((row) =>
      weigh(row, unwrittenOnly, row.unwritten === true),
    )
    const what = holdsRows(holds.get(node.id) ?? [], node.id, name, unwrittenOnly)
    const calls = callRows(rules, name, member, domain, unwrittenOnly)
    // An abstract Class has no Node of its own: the Class each Node is of decides, so nothing
    // is left to the Kernel's default there.
    const abstract = isAbstract(bundle, name)
    const none: SceneRule[] =
      who.length === 0 && calls.length === 0
        ? [
            weigh(
              {
                id: `${node.id}#none`,
                label: 'policies',
                text: abstract
                  ? 'Abstract · the Class of each Node decides'
                  : KERNEL_DEFAULT.unwritten,
                title: abstract
                  ? `${name} is abstract: who may act on a Node is decided by the Class it is of.`
                  : `No rule is written on ${name}: the Kernel’s default decides each slot.`,
                tone: 'who',
                ...(abstract ? {} : { unwritten: true }),
              },
              unwrittenOnly,
              !abstract,
            ),
          ]
        : []
    node.rules = [...none, ...who, ...calls, ...what]
  }

  const functions = Object.keys(ir.functions)
  if (functions.length > 0)
    nodes.push({
      id: DOMAIN_FUNCTIONS,
      kind: 'functions',
      shape: 'card',
      label: 'Domain functions',
      sublabel: plural(functions.length, 'function'),
      icon: { glyph: 'function' },
      tone: 'fn',
      rules: callRowsOf(
        callablesOf(rules, (name) => `function.${name}`, ir.functions),
        'call',
        domain,
        unwrittenOnly,
      ),
    })

  for (const link of links) {
    if (link.kind !== 'relationship') continue
    const name = link.id.slice('class.'.length)
    const sites = rules.sites.filter(
      (site) => site.on.kind === 'relationship' && site.on.target === link.id,
    )
    const traverse = sites.find((site) => site.slot === 'traverse')
    if (traverse && !unwrittenSite(traverse)) link.tone = 'traverse'
    const methods = Object.entries(ir.classes[name]?.methods ?? {}).flatMap(
      ([method, declared]) => {
        const site = callableOf(rules, `class.${name}.method.${method}`, method, declared).site
        return site ? [refOf(site)] : []
      },
    )
    const own = [
      ...[...sites.filter((site) => site.kind === 'who')]
        .sort((a, b) => slotRank(a) - slotRank(b))
        .map((site) => refOf(site)),
      ...sites.filter((site) => site.kind === 'what').map((site) => refOf(site)),
      ...methods,
    ]
    if (own.length > 0) link.rules = own
  }

  if (focus !== undefined) {
    const focused = rules.sites.find((site) => site.id === focus)
    if (focused?.reading.status === 'read')
      bringIn(bundle, walked(focused.reading.rule), nodes, links, groups)
  }

  const scene: Scene = {
    key,
    nodes,
    links,
    groups,
    folded: structure.folded.filter((fold) => fold.lens !== 'behavior'),
    lineWeight: 'thin',
    index: indexOf(rules),
    ...(nodes.length === 0
      ? { empty: 'The Schema declares no Class and no function: no rule has anything to sit on.' }
      : {}),
  }
  cache.set(key, scene)
  return scene
}

/**
 * A constraint as a card row reads it: the relationship it is declared on and its form
 * (`host_runs_release · at most one`), or the declaration of a Class's own (`unique email`).
 */
function constraintText(site: RuleSite, owner: string): string {
  const form = constraintFormOf(site).label
  if (site.on.target === owner || !('name' in site.on)) return site.title
  return `${site.on.name} · ${form}`
}

/**
 * The constraints on a Class: one row for one constraint, else a fold (`4 constraints`)
 * holding a row each. A row reads its constraint as its relationship and form; two that would
 * read alike on one card say which end each counts (`at most one per fleet`), or their
 * declarations, so no two read the same.
 */
function holdsRows(
  sites: readonly RuleSite[],
  owner: string,
  name: string,
  unwrittenOnly: boolean,
): SceneRule[] {
  const texts = sites.map((site) => constraintText(site, owner))
  const row = (site: RuleSite, index: number, label: string): SceneRule => {
    const text = texts[index]!
    const end = /^(\w+) · (?:incoming|outgoing) /.exec(site.title)?.[1]
    const said =
      texts.indexOf(text) === texts.lastIndexOf(text)
        ? text
        : end
          ? `${text} per ${end}`
          : `${text} · ${site.title}`
    const sentence =
      site.reading.status === 'read'
        ? renderPlain(textOf(site.reading.rule, 'en'))
        : site.reading.detail
    return weigh({ ...refOf(site), label, text: said, title: sentence }, unwrittenOnly, false)
  }
  if (sites.length <= 1) return sites.map((site, index) => row(site, index, 'constraint'))
  const text = plural(sites.length, 'constraint')
  return [
    weigh(
      {
        id: `${owner}#holds`,
        label: 'constraints',
        text,
        title: `Constraints on ${name}: ${text}.`,
        tone: 'what',
        holds: sites.map((site) => site.id),
        rows: sites.map((site, index) => row(site, index, '')),
      },
      unwrittenOnly,
      false,
    ),
  ]
}

/**
 * The call rules of a Class's Methods: the row of their one rule, else a fold
 * (`12 functions · 2 rules · 1 unwritten · 1 by contract`) holding a row per rule, each naming
 * the Methods it guards.
 */
function callRows(
  rules: DomainRules,
  className: string,
  member: IrClass,
  domain: string,
  unwrittenOnly: boolean,
): SceneRule[] {
  const callables = callablesOf(
    rules,
    (name) => `class.${className}.method.${name}`,
    member.methods,
  )
  const rows = callRowsOf(callables, 'call', domain, unwrittenOnly)
  if (rows.length <= 1) return rows
  const written = new Set(
    callables.flatMap(({ site }) =>
      site && (site.written === 'rule' || site.written === 'true') ? [alikeKey(site)] : [],
    ),
  )
  const unwritten = callables.filter(({ site }) => site && unwrittenSite(site)).length
  // Those whose contract admits their callers: no call rule decides them.
  const byContract = callables.filter(({ site }) => !site).length
  const text = [
    plural(callables.length, 'function'),
    plural(written.size, 'rule'),
    ...(unwritten > 0 ? [`${unwritten} unwritten`] : []),
    ...(byContract > 0 ? [`${byContract} by contract`] : []),
  ].join(' · ')
  return [
    weigh(
      {
        id: `class.${className}#call`,
        label: 'calls',
        text,
        title: `Call Policies of the Methods of ${className}: ${text}.`,
        tone: 'who',
        op: 'call',
        marks: distinctMarks(rows.flatMap((row) => row.marks ?? [])),
        holds: callables.map((callable) => callable.id),
        rows: rows.map((row) => ({ ...row, label: '' })),
      },
      unwrittenOnly,
      unwritten > 0,
    ),
  ]
}

/** Whether the canonical Schema declares the Class `name` abstract. */
function isAbstract(bundle: StudioSchemaBundle, name: string): boolean {
  const root = bundle.schemaRoot as { classes?: Record<string, { abstract?: unknown }> } | undefined
  return root?.classes?.[name]?.abstract === true
}

/** Whether a scene id names a relationship, here or in a Domain this one depends on. */
function isRelationship(bundle: StudioSchemaBundle, id: string): boolean {
  const { name, origin } = classOfTarget(id)
  const member =
    origin === undefined
      ? bundle.ir?.classes[name]
      : resolveClass(bundle, { origin, kind: 'class', name })
  return member?.type === 'edge'
}

/**
 * Brings in what a walk reaches that the map does not draw: another Domain's Class as a
 * quiet card in its Domain's frame, another Domain's relationship as a link between the
 * Classes its ends accept — those drawn, else all of them, brought in too.
 */
function bringIn(
  bundle: StudioSchemaBundle,
  walk: readonly string[],
  nodes: SceneNode[],
  links: SceneLink[],
  groups: SceneGroup[],
) {
  const domain = bundle.ir!.domain
  const drawn = new Set([...nodes.map((node) => node.id), ...links.map((link) => link.id)])
  const addNode = (ref: IrClassRef) => {
    const id = classTarget(ref, domain)
    if (drawn.has(id) || ref.origin === domain) return id
    const member = resolveClass(bundle, ref)
    const group = `domain.${ref.origin}`
    if (!groups.some((each) => each.id === group))
      groups.push({ id: group, label: originShort(ref.origin) })
    nodes.push({
      id,
      kind: isKernelClass(ref) ? 'kernel class' : 'imported class',
      shape: 'card',
      label: ref.name,
      sublabel: originShort(ref.origin),
      group,
      icon: { ...(member?.icon ? { svg: member.icon } : {}), glyph: 'class' },
      tone: 'muted',
    })
    drawn.add(id)
    return id
  }
  const foreign = walk.flatMap((id) => {
    if (drawn.has(id)) return []
    const { name, origin } = classOfTarget(id)
    if (origin === undefined) return []
    const ref: IrClassRef = { origin, kind: 'class', name }
    const member = resolveClass(bundle, ref)
    return member ? [{ id, ref, member }] : []
  })
  for (const { ref, member } of foreign) if (member.type !== 'edge') addNode(ref)
  for (const { id, ref, member } of foreign) {
    if (member.type !== 'edge' || drawn.has(id)) continue
    const end = (endpoint: IrEndpoint | undefined): SceneEnd => {
      const refs = endpointRefs(endpoint, ref.origin)
      const shown = refs.filter((each) => drawn.has(classTarget(each, domain)))
      return {
        ...(endpoint?.name ? { role: endpoint.name } : {}),
        nodes: [...new Set((shown.length > 0 ? shown : refs).map(addNode))],
      }
    }
    const [source, target] = member.endpoints ?? []
    const from = end(source)
    const to = end(target)
    if (from.nodes.length === 0 || to.nodes.length === 0) continue
    links.push({
      id,
      kind: 'relationship',
      label: ref.name,
      group: `domain.${ref.origin}`,
      from,
      to,
      directed: member.orientation !== 'undirected',
      tone: 'muted',
    })
    drawn.add(id)
  }
}

/**
 * The operations a Policy takes part in deciding — as a site's whole rule or a part of it —
 * in slot order.
 */
function decided(rules: DomainRules, sitsOn: readonly { site: string }[]): Pick<SceneEntry, 'ops'> {
  const named = new Set(sitsOn.map((each) => each.site))
  const ops = new Set(
    rules.sites.flatMap((site) => {
      const op = named.has(site.id) ? opOf(site.slot) : undefined
      return op ? [op] : []
    }),
  )
  const decides = SLOT_ORDER.flatMap((slot) => {
    const op = opOf(slot)
    return op && ops.has(op) ? [op] : []
  })
  return decides.length > 0 ? { ops: decides } : {}
}

/** What a Policy's own rule walks and its steps, for the map to draw while it is selected. */
function ownWalk(policy: PolicyRule): Pick<SceneEntry, 'walk' | 'steps'> {
  if (policy.reading.status !== 'read') return {}
  const walk = walked(policy.reading.rule)
  return walk.length > 0 ? { walk, steps: stepsNumbered(policy.reading.rule) } : {}
}

/** The Index: the Policies that sit somewhere, then the forms of constraint, each counted by place. */
function indexOf(rules: DomainRules): NonNullable<Scene['index']> {
  const entries: SceneEntry[] = []
  const places = (count: number) => plural(count, 'place')
  for (const policy of [...rules.policies, ...rules.imported]) {
    const own = policy.origin === rules.origin
    if (!own && policy.sitsOn.length === 0) continue
    entries.push({
      id: policy.target,
      kind: 'policy',
      label: policy.name,
      sublabel: own
        ? places(policy.sitsOn.length)
        : `${originShort(policy.origin)} · ${places(policy.sitsOn.length)}`,
      group: WHO_GROUP,
      tone: 'who',
      icon: { glyph: 'policy' },
      ...(policy.description ? { keywords: [policy.description] } : {}),
      ...decided(rules, policy.sitsOn),
      ...ownWalk(policy),
    })
  }
  const forms = new Map<string, { label: string; count: number }>()
  for (const site of rules.sites) {
    if (site.kind !== 'what') continue
    const form = constraintFormOf(site)
    const found = forms.get(form.id) ?? { label: form.label, count: 0 }
    found.count += 1
    forms.set(form.id, found)
  }
  for (const [id, form] of [...forms].sort(
    ([, a], [, b]) => b.count - a.count || a.label.localeCompare(b.label),
  ))
    entries.push({
      id,
      kind: 'constraint',
      label: form.label,
      sublabel: places(form.count),
      group: WHAT_GROUP,
      tone: 'what',
      icon: { glyph: 'constraint' },
    })
  return {
    groups: [
      { id: WHO_GROUP, label: 'Policies' },
      { id: WHAT_GROUP, label: 'Constraints' },
    ],
    entries,
    ...(entries.length === 0 ? { empty: 'No rule is written: the Kernel’s defaults apply.' } : {}),
  }
}

/**
 * A row that stands for several rules — a card's fold (`class.X#call`, `class.X#holds`), or the
 * Domain functions card (`rules.functions`) — with a row per rule it holds; undefined for any
 * other id.
 */
export function ruleFoldOf(bundle: StudioSchemaBundle, id: string): SceneRule | undefined {
  if (!bundle.ir) return undefined
  const card = projectRules(bundle, {}).nodes.find((node) => node.id === ruleOwnerOf(id))
  if (id === DOMAIN_FUNCTIONS && card?.rules)
    return {
      id,
      label: 'calls',
      text: card.sublabel ?? '',
      title: 'Call Policies of the functions declared on no Class.',
      tone: 'who',
      op: 'call',
      marks: distinctMarks(card.rules.flatMap((row) => row.marks ?? [])),
      holds: card.rules.flatMap((row) => [row.id, ...(row.also ?? [])]),
      rows: card.rules,
    }
  return card?.rules?.find((row) => row.id === id && row.holds)
}

/**
 * A card's rules of one kind as the card reads them, a row per rule: who may call its functions
 * (`call`: each row naming the functions it guards), or its constraints (`holds`: its own
 * constraints and its relationships'). Its fold's rows, or its one row; none for a card whose
 * rules are another Domain's.
 */
export function cardRowsOf(
  bundle: StudioSchemaBundle,
  owner: string,
  kind: 'call' | 'holds',
): SceneRule[] {
  const fold = ruleFoldOf(bundle, owner === DOMAIN_FUNCTIONS ? owner : `${owner}#${kind}`)
  if (fold) return [...(fold.rows ?? [])]
  const card = projectRules(bundle, {}).nodes.find((node) => node.id === owner)
  return (card?.rules ?? []).filter(
    (row) => !row.holds && (kind === 'call' ? row.names !== undefined : row.tone === 'what'),
  )
}

/**
 * The row the map reads the rule `id` at, open or not: its own, or the row of a rule said
 * alike (a Method's call rule at the row of the rule it shares with others), which names the
 * functions it guards.
 */
export function ruleRowOf(bundle: StudioSchemaBundle, id: string): SceneRule | undefined {
  const card = projectRules(bundle, {}).nodes.find((node) => node.id === ruleOwnerOf(id))
  const rows = (card?.rules ?? []).flatMap((row) => [row, ...(row.rows ?? [])])
  return rows.find((row) => !row.holds && (row.id === id || row.also?.includes(id)))
}

const restDrawn = new WeakMap<StudioSchemaBundle, Set<string>>()

/**
 * What of a selection changes the Rules map: a rule whose walk reaches what the map does not
 * draw at rest, which is brought in. Anything else only lights the map — a fold that holds it
 * is raised open over the map, not laid out — so selecting it never moves a card.
 */
export function rulesFocus(
  bundle: StudioSchemaBundle,
  _options: LensOptions,
  selected: string | undefined,
): string | undefined {
  if (!selected?.includes('#') || !bundle.ir) return undefined
  const site = rulesOf(bundle).sites.find((each) => each.id === selected)
  if (site?.reading.status !== 'read' || unwrittenSite(site)) return undefined
  let drawn = restDrawn.get(bundle)
  if (!drawn) {
    const scene = projectRules(bundle, {})
    drawn = new Set([...scene.nodes.map((node) => node.id), ...scene.links.map((link) => link.id)])
    restDrawn.set(bundle, drawn)
  }
  return walked(site.reading.rule).some((id) => !drawn.has(id)) ? selected : undefined
}
