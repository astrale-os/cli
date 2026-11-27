/**
 * What a rule walks, step by step, in the order a reader follows it. The walk starts at what the
 * rule is about — the object a permission decides on, the parameter a Policy defines, else the
 * first thing it names — and goes out along each relationship it follows to the place at the
 * other end, nearest first, until it reaches you. Each alternative (`or`) is walked on its own,
 * in the order the reading says them, from what the walk knows where it opens; a place met in
 * one alternative is new again in the next.
 *
 * A step follows a relationship to a place it meets there first, or checks one that joins two
 * places it already knows; goes from a link the rule ranges over to one of its ends (`the fleet of
 * the link`), which stands for the Classes that end accepts; or checks that two places are the
 * same (`you are the role`). A step reads one node of the rule's Meaning: pointing at it lights
 * that node in the reading and in the Figure.
 *
 * A set holding every node (the Kernel's `Node`, or every node Class of a Domain) names no Class
 * on the map, and a Core Node the rule names by its path is a value: neither has a map id. The
 * map numbers each step beside the relationship it follows, the start beside its Class; the
 * numbers are the stage's, so a step the map does not draw leaves a gap rather than renumbering.
 */

import type { Key, NodeId, Rule, Text } from '@astrale-os/visual'

import { runsOf, textOf } from '@astrale-os/visual'

import { classOfTarget, selectionIdOf } from '../rules/model'

const KERNEL_NODE: Key = 'kernel.astrale.ai:class.Node'

/** Where a step stands: a thing the rule ranges over, an end of a link, you, or a named Node. */
export interface WalkPlace {
  /** the caller */
  readonly you?: true
  /** a Core Node the rule names by its path, by its name */
  readonly individual?: string
  /** the names of the Classes it may be, those no other of them extends, as the map titles them */
  readonly names: readonly string[]
  /** their selection ids */
  readonly ids: readonly string[]
  /** whether they are relationships: a link the rule ranges over */
  readonly link?: true
}

/** An alternative a step lies in: the `or` node and which of its operands. */
export interface WalkAlternative {
  readonly or: NodeId
  readonly operand: number
}

export type WalkStepKind = 'start' | 'follow' | 'join' | 'end' | 'same'

export interface WalkStep {
  /** 1 and up, in walking order: the number the stage, the Figure and the map show */
  readonly number: number
  readonly kind: WalkStepKind
  /** the Meaning node it reads: what pointing at it lights in the reading and the Figure */
  readonly node: NodeId
  /** the entity it stands at, for a start */
  readonly entity?: string
  /** where it comes from; none for a start */
  readonly from?: WalkPlace
  /** where it arrives */
  readonly to: WalkPlace
  /** the Meaning node that introduces where it arrives, when it meets an entity there first */
  readonly arrives?: NodeId
  /** whether it meets `to` here first */
  readonly fresh: boolean
  /** the relationship it follows or checks */
  readonly relationship?: { readonly id: string; readonly name: string }
  /** a relationship followed once or more (a path) */
  readonly repeat?: true
  /** the end of the link it goes to, for an `end` step */
  readonly role?: string
  /** the alternatives it lies in, outermost first */
  readonly within: readonly WalkAlternative[]
  /** the selection ids it lights on the map */
  readonly ids: readonly string[]
  /** the selection ids the map numbers it beside */
  readonly marks: readonly string[]
}

interface Meaningful {
  kind?: unknown
  id?: unknown
  entity?: unknown
  classes?: unknown
  relation?: unknown
  of?: unknown
  role?: unknown
  name?: unknown
  operands?: unknown
  source?: unknown
  target?: unknown
  left?: unknown
  right?: unknown
  from?: unknown
  to?: unknown
  path?: unknown
  parameter?: unknown
}

const isObject = (value: unknown): value is Meaningful =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A place as the walk reads it, by its id: an entity's (`e1`), an end's (`e1/target`), `you`. */
interface Place {
  id: string
  classes: readonly Key[]
  /** the Meaning node that introduces it */
  node?: NodeId
  you?: true
  individual?: string
  /** for an end: the link entity it is an end of, which end, and the nodes that say it */
  end?: { of: string; role: string; nodes: { node: NodeId; within: WalkAlternative[] }[] }
}

/** A relationship the rule follows, or two places it says are the same. */
interface Link {
  kind: 'related' | 'step' | 'same'
  node: NodeId
  relation?: Key
  places: string[]
  within: WalkAlternative[]
  repeat?: true
}

const YOU = 'you'

const sameWithin = (a: readonly WalkAlternative[], b: readonly WalkAlternative[]) =>
  a.length === b.length &&
  a.every((each, index) => each.or === b[index]!.or && each.operand === b[index]!.operand)

const opensUnder = (within: readonly WalkAlternative[], prefix: readonly WalkAlternative[]) =>
  within.length > prefix.length && sameWithin(within.slice(0, prefix.length), prefix)

/** Where each node is first said in the reading: the index of its first run, or past the end. */
function firstSaid(text: Text): (node: NodeId) => number {
  const first = new Map<NodeId, number>()
  runsOf(text).forEach((run, index) => {
    for (const part of run.parts)
      for (let at: NodeId | undefined = part.node; at !== undefined; at = text.nodes[at]?.parent)
        if (!first.has(at)) first.set(at, index)
  })
  return (node) => first.get(node) ?? Number.MAX_SAFE_INTEGER
}

/** The node that says an end in an alternative: the one said nearest it, else the first. */
function endNode(
  nodes: readonly { node: NodeId; within: WalkAlternative[] }[],
  within: WalkAlternative[],
) {
  let best = nodes[0]!
  for (const each of nodes)
    if (
      each.within.length <= within.length &&
      each.within.length >= best.within.length &&
      sameWithin(each.within, within.slice(0, each.within.length))
    )
      best = each
  return best.node
}

const read = new WeakMap<Rule, readonly WalkStep[]>()

/** The steps `rule` walks, numbered in walking order. */
export function walkStepsOf(rule: Rule): readonly WalkStep[] {
  const cached = read.get(rule)
  if (cached) return cached
  const steps = stepsOf(rule)
  read.set(rule, steps)
  return steps
}

function stepsOf(rule: Rule): WalkStep[] {
  const origin = rule.catalogue.origin
  const classes = rule.catalogue.words.schema.classes
  const places = new Map<string, Place>()
  /** Places in the order the rule names them. */
  const named: Place[] = []
  const links: Link[] = []
  /** The operand nodes of each `or`, by index. */
  const operandNodes = new Map<NodeId, NodeId[]>()

  const place = (found: Place) => {
    const known = places.get(found.id)
    if (known) return known.id
    places.set(found.id, found)
    named.push(found)
    return found.id
  }
  /** The end `role` of the link entity `of`: it stands for the Classes that end accepts. */
  const endOf = (of: string, role: string, node: NodeId, within: WalkAlternative[]) => {
    const known = places.get(`${of}/${role}`)?.end
    if (known) {
      if (!known.nodes.some((each) => each.node === node)) known.nodes.push({ node, within })
      return `${of}/${role}`
    }
    const edge = places.get(of)?.classes[0]
    const end = edge ? classes[edge]?.[role as 'source' | 'target'] : undefined
    return place({
      id: `${of}/${role}`,
      classes: end?.classes ?? [],
      end: { of, role, nodes: [{ node, within }] },
    })
  }
  /** The place a term stands for: a reference, an entity, an end, you, a named Node. */
  const placeOf = (value: unknown, within: WalkAlternative[]): string | undefined => {
    if (!isObject(value)) return undefined
    if (value.kind === 'subject') return place({ id: YOU, classes: [], you: true })
    if ((value.kind === 'ref' || value.kind === 'entity') && typeof value.entity === 'string')
      return places.has(value.entity) ? value.entity : undefined
    if (value.kind === 'end' && isObject(value.of) && typeof value.of.entity === 'string')
      return endOf(value.of.entity, String(value.role), String(value.id), within)
    if (value.kind === 'individual' && typeof value.name === 'string')
      return place({
        id: `individual:${value.name}`,
        classes: Array.isArray(value.classes) ? (value.classes as Key[]) : [],
        individual: value.name,
      })
    return undefined
  }
  /** Every entity first, so a link reads the places it joins whichever the rule names first. */
  const gather = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) gather(each)
    else if (isObject(value)) {
      if (value.kind === 'entity' && typeof value.entity === 'string')
        place({
          id: value.entity,
          classes: Array.isArray(value.classes) ? (value.classes as Key[]) : [],
          node: String(value.id),
        })
      for (const each of Object.values(value)) gather(each)
    }
  }
  /** The relationships a path takes, each with whether it repeats. */
  const pathSteps = (
    value: unknown,
    repeat = false,
  ): { node: NodeId; relation: Key; repeat: boolean }[] => {
    if (Array.isArray(value)) return value.flatMap((each) => pathSteps(each, repeat))
    if (!isObject(value)) return []
    if (value.kind === 'step' && typeof value.relation === 'string')
      return [{ node: String(value.id), relation: value.relation as Key, repeat }]
    const repeats = repeat || value.kind === 'repeat'
    return Object.values(value).flatMap((each) => pathSteps(each, repeats))
  }
  const follow = (value: unknown, within: WalkAlternative[]) => {
    if (Array.isArray(value)) {
      for (const each of value) follow(each, within)
      return
    }
    if (!isObject(value)) return
    const node = String(value.id)
    if (value.kind === 'or' && Array.isArray(value.operands)) {
      operandNodes.set(
        node,
        value.operands.map((operand, index) =>
          isObject(operand) && typeof operand.id === 'string'
            ? operand.id
            : `${node}/operands.${index}`,
        ),
      )
      value.operands.forEach((operand, index) =>
        follow(operand, [...within, { or: node, operand: index }]),
      )
      return
    }
    if (value.kind === 'related' && typeof value.relation === 'string') {
      const joined = [placeOf(value.source, within), placeOf(value.target, within)].filter(
        (id): id is string => id !== undefined,
      )
      links.push({ kind: 'related', node, relation: value.relation as Key, places: joined, within })
    } else if (value.kind === 'same') {
      const joined = [placeOf(value.left, within), placeOf(value.right, within)].filter(
        (id): id is string => id !== undefined,
      )
      if (joined.length === 2) links.push({ kind: 'same', node, places: joined, within })
    } else if (value.kind === 'reachable') {
      // A path between two places joins them at every relationship it takes.
      const joined = [placeOf(value.from, within), placeOf(value.to, within)].filter(
        (id): id is string => id !== undefined,
      )
      for (const step of pathSteps(value.path))
        links.push({
          kind: 'step',
          node: step.node,
          relation: step.relation,
          places: joined,
          within,
          ...(step.repeat ? { repeat: true as const } : {}),
        })
      return
    }
    for (const each of Object.values(value)) follow(each, within)
  }
  const frame = rule.meaning.frame as unknown
  gather(frame)
  follow(frame, [])

  const said = firstSaid(textOf(rule, 'en'))
  const toPlace = (found: Place): WalkPlace => {
    if (found.you) return { you: true, names: [], ids: [] }
    const tops = topsOf(found.classes, classes)
    const ids = tops.map((key) => selectionIdOf(key, origin))
    const link = tops.length > 0 && tops.every((key) => classes[key]?.kind === 'edge')
    return {
      ...(found.individual ? { individual: found.individual } : {}),
      names: ids.map((id) => classOfTarget(id).name),
      ids: found.individual ? [] : ids,
      ...(link ? { link: true as const } : {}),
    }
  }
  const relationshipOf = (relation: Key) => {
    const id = selectionIdOf(relation, origin)
    return { id, name: classOfTarget(id).name }
  }

  const drafts: Omit<WalkStep, 'number'>[] = []
  const used = new Set<Link>()

  /** Walks the links of one alternative from what it knows, nearest first. */
  const breadth = (
    here: readonly Link[],
    known: Set<string>,
    order: string[],
    within: WalkAlternative[],
  ) => {
    let next = 0
    const meet = (id: string) => {
      known.add(id)
      order.push(id)
    }
    for (;;) {
      while (next < order.length) {
        const at = order[next++]!
        const atPlace = places.get(at)
        // A link the rule ranges over reaches the ends it reads.
        for (const end of places.values()) {
          if (end.end?.of !== at || known.has(end.id)) continue
          if (!here.some((link) => !used.has(link) && link.places.includes(end.id))) continue
          const to = toPlace(end)
          drafts.push({
            kind: 'end',
            node: endNode(end.end.nodes, within),
            from: atPlace ? toPlace(atPlace) : to,
            to,
            fresh: true,
            role: end.end.role,
            within,
            ids: to.ids,
            marks: to.ids,
          })
          meet(end.id)
        }
        for (const link of here) {
          if (used.has(link) || !link.places.includes(at)) continue
          used.add(link)
          const other = link.places.find((id) => id !== at) ?? at
          const fresh = !known.has(other)
          const from = toPlace(atPlace!)
          const to = toPlace(places.get(other)!)
          const relationship = link.relation ? relationshipOf(link.relation) : undefined
          const arrives = fresh ? places.get(other)?.node : undefined
          drafts.push({
            kind: link.kind === 'same' ? 'same' : fresh ? 'follow' : 'join',
            node: link.node,
            from,
            to,
            fresh,
            ...(arrives ? { arrives } : {}),
            ...(relationship ? { relationship } : {}),
            ...(link.repeat ? { repeat: true as const } : {}),
            within,
            ids: [...(relationship ? [relationship.id] : []), ...(fresh ? to.ids : [])],
            marks: relationship ? [relationship.id] : [],
          })
          if (fresh) meet(other)
        }
      }
      const left = here.filter((link) => !used.has(link))
      if (left.length === 0) return
      // What no known place reaches is walked from you, else from the first place it names.
      const from =
        left.find((link) => link.places.includes(YOU) && !known.has(YOU)) !== undefined
          ? YOU
          : left[0]!.places.find((id) => !known.has(id))
      if (from === undefined) {
        // a link with no place the walk can stand at
        for (const link of left) if (link.places.length === 0) used.add(link)
        if (left.every((link) => link.places.length === 0)) return
        continue
      }
      if (from !== YOU) {
        const found = places.get(from)!
        const to = toPlace(found)
        drafts.push({
          kind: 'start',
          node: found.node ?? (found.end ? endNode(found.end.nodes, within) : String(from)),
          ...(found.end ? {} : { entity: from }),
          to,
          fresh: true,
          within,
          ids: to.ids,
          marks: to.ids,
        })
      }
      meet(from)
    }
  }

  /** Walks one alternative, then each alternative that opens inside it, in reading order. */
  const alternative = (prefix: WalkAlternative[], known: Set<string>, order: string[]) => {
    breadth(
      links.filter((link) => !used.has(link) && sameWithin(link.within, prefix)),
      known,
      order,
      prefix,
    )
    const inner = links.filter((link) => !used.has(link) && opensUnder(link.within, prefix))
    const ors = [...new Set(inner.map((link) => link.within[prefix.length]!.or))].sort(
      (a, b) => said(a) - said(b),
    )
    for (const or of ors) {
      const nodes = operandNodes.get(or) ?? []
      const operands = [
        ...new Set(
          inner
            .filter((link) => link.within[prefix.length]!.or === or)
            .map((link) => link.within[prefix.length]!.operand),
        ),
      ].sort((a, b) => said(nodes[a] ?? '') - said(nodes[b] ?? ''))
      for (const operand of operands)
        alternative([...prefix, { or, operand }], new Set(known), [...order])
    }
  }

  const target = isObject(frame)
    ? isObject((frame as Meaningful & { target?: unknown }).target)
      ? ((frame as { target: Meaningful }).target.entity as unknown)
      : isObject(frame.parameter)
        ? frame.parameter.entity
        : undefined
    : undefined
  const first =
    (typeof target === 'string' ? places.get(target) : undefined) ??
    named.find((each) => !each.you && !each.individual && !each.end)
  const known = new Set<string>()
  const order: string[] = []
  if (first) {
    const to = toPlace(first)
    drafts.push({
      kind: 'start',
      node: first.node ?? first.id,
      entity: first.id,
      to,
      fresh: true,
      within: [],
      ids: to.ids,
      marks: to.ids,
    })
    known.add(first.id)
    order.push(first.id)
  }
  alternative([], known, order)
  return drafts.map((draft, index) => ({ ...draft, number: index + 1 }))
}

/**
 * The selection ids `rule` walks, in order: Classes and relationships, each once — those its
 * steps light, then what no step reaches, in the order the rule names it.
 */
export function walkOf(rule: Rule): string[] {
  const out = new Set<string>()
  for (const step of walkStepsOf(rule)) for (const id of step.ids) out.add(id)
  const origin = rule.catalogue.origin
  const classes = rule.catalogue.words.schema.classes
  const leftovers = (value: unknown) => {
    if (Array.isArray(value)) for (const each of value) leftovers(each)
    else if (isObject(value)) {
      if (value.kind === 'entity' && Array.isArray(value.classes))
        for (const key of topsOf(value.classes as Key[], classes))
          out.add(selectionIdOf(key, origin))
      if (typeof value.relation === 'string' && (value.kind === 'related' || value.kind === 'step'))
        out.add(selectionIdOf(value.relation as Key, origin))
      for (const each of Object.values(value)) leftovers(each)
    }
  }
  leftovers(rule.meaning.frame)
  return [...out]
}

/** A part of a step's phrase: a word, or a name the map draws. */
export interface WalkWord {
  readonly text: string
  /** a Class's name, a relationship's, or you: drawn as the map draws them */
  readonly kind?: 'class' | 'relationship' | 'you'
}

const ARTICLE_AN = /^[aeiou]/iu

/** A place said with its determiner: `the Instance`, `a Host or Instance`, `you`. */
function placeWords(place: WalkPlace, determiner: 'the' | 'a'): WalkWord[] {
  if (place.you) return [{ text: 'you', kind: 'you' }]
  if (place.individual) return [{ text: place.individual, kind: 'class' }]
  const { names } = place
  if (names.length === 0) return [{ text: determiner === 'a' ? 'any Node' : 'the Node' }]
  const kind = place.link ? 'relationship' : 'class'
  const shown = names.length > 3 ? names.slice(0, 2) : names
  const article = determiner === 'the' ? 'the ' : ARTICLE_AN.test(names[0]!) ? 'an ' : 'a '
  const words: WalkWord[] = [{ text: article }]
  shown.forEach((name, index) => {
    if (index > 0)
      words.push({ text: index === shown.length - 1 && names.length <= 3 ? ' or ' : ', ' })
    words.push({ text: name, kind })
  })
  if (names.length > 3) words.push({ text: ` or ${names.length - 2} more` })
  if (place.link) words.push({ text: ' link' })
  return words
}

/** A step as a short phrase, in parts: `Follow fleet_contains to a Fleet`. */
export function walkWords(step: WalkStep): WalkWord[] {
  const relationship: WalkWord[] = step.relationship
    ? [{ text: step.relationship.name, kind: 'relationship' }]
    : []
  switch (step.kind) {
    case 'start':
      return [{ text: 'Start at ' }, ...placeWords(step.to, step.number === 1 ? 'the' : 'a')]
    case 'follow':
      return [
        { text: 'Follow ' },
        ...relationship,
        ...(step.repeat ? [{ text: ', once or more,' }] : []),
        { text: ' to ' },
        ...placeWords(step.to, 'a'),
      ]
    case 'join':
      return [
        { text: 'Check ' },
        ...relationship,
        { text: ' links ' },
        ...placeWords(step.from!, 'the'),
        { text: ' and ' },
        ...placeWords(step.to, 'the'),
      ]
    case 'end':
      return [{ text: `Go to its ${step.role}, ` }, ...placeWords(step.to, 'a')]
    case 'same': {
      const [one, other] = step.to.you ? [step.to, step.from!] : [step.from!, step.to]
      return one.you
        ? [{ text: 'Check you are ' }, ...placeWords(other, 'the')]
        : [
            { text: 'Check ' },
            ...placeWords(one, 'the'),
            { text: ' is ' },
            ...placeWords(other, 'the'),
          ]
    }
  }
}

/** A step's phrase as plain text. */
export const walkPhrase = (step: WalkStep): string =>
  walkWords(step)
    .map((word) => word.text)
    .join('')

/**
 * The Classes a set is said by: those no other member extends. None for a set of every node —
 * the Kernel's `Node` among them, or every node Class of one Domain.
 */
function topsOf(
  set: readonly Key[],
  classes: Rule['catalogue']['words']['schema']['classes'],
): Key[] {
  if (set.length === 0 || set.includes(KERNEL_NODE)) return []
  const members = new Set(set)
  const domain = set[0]!.slice(0, set[0]!.indexOf(':'))
  const nodes = Object.entries(classes).filter(
    ([key, cls]) => cls.kind === 'node' && key.startsWith(`${domain}:`),
  )
  if (nodes.length > 1 && nodes.length === members.size && nodes.every(([key]) => members.has(key)))
    return []
  const ancestors = (key: Key): Set<Key> => {
    const found = new Set<Key>()
    const pending = [...(classes[key]?.extends ?? [])]
    while (pending.length > 0) {
      const next = pending.pop()!
      if (found.has(next)) continue
      found.add(next)
      pending.push(...(classes[next]?.extends ?? []))
    }
    return found
  }
  return set.filter((key) => ![...ancestors(key)].some((parent) => members.has(parent)))
}
