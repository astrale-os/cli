/**
 * A Domain's Policies as a reader lists them: each name said in words, and the names that start
 * alike gathered under what they share, so a long list of long names reads as a few families.
 *
 * A Policy's name is a phrase its subject completes (`ownsOrBelongsToProjectOfIssue`: "owns or
 * belongs to Project of Issue"). Its words are the name's own, lower-cased, a Class the Schema
 * declares keeping its name. Names are code and stay as written wherever code is read; this is
 * how a list says them.
 *
 * A family is the longest opening three Policies or more share, picked to save the most words:
 * `owns or belongs to Project` holds `… of Issue`, `… of Tag`; the Policy whose whole name is
 * the opening is listed by it, first. A Policy no family holds is listed alone, in words.
 */

import { parseClassRefKey } from '@shared/schema/identity'

import type { SceneEntry, SceneGroup } from '../scene/types'
import type { DomainRules, PolicyRule } from './model'

/** A name's parts, where a word starts: a capital after a lower-case letter or a digit, an acronym's end, a separator. */
const PARTS = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[\s._:-]+/u

/** Words that join others: a family's opening never ends on one. */
const JOINING = new Set([
  'a',
  'an',
  'and',
  'as',
  'by',
  'for',
  'from',
  'in',
  'is',
  'its',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

/** A Class name is at most this many of a name's parts (`CorporateGroupMember`). */
const CLASS_PARTS = 4

/** The fewest Policies a family holds. */
const FAMILY_SIZE = 3

/**
 * A name in words, lower-cased; a run of parts that spells a Class (`classes`: each name by its
 * lower-case form) is that Class, as declared.
 */
export function policyWords(name: string, classes: ReadonlyMap<string, string>): string[] {
  const parts = name.split(PARTS).filter(Boolean)
  const words: string[] = []
  for (let at = 0; at < parts.length;) {
    let taken = 0
    for (let count = Math.min(CLASS_PARTS, parts.length - at); count > 0 && taken === 0; count--) {
      const declared = classes.get(
        parts
          .slice(at, at + count)
          .join('')
          .toLowerCase(),
      )
      if (declared === undefined) continue
      words.push(declared)
      taken = count
    }
    if (taken === 0) {
      words.push(parts[at]!.toLowerCase())
      taken = 1
    }
    at += taken
  }
  return words
}

export interface PolicyFamily {
  /** stable for the same opening: `owns-or-belongs-to-project` */
  readonly id: string
  /** `Owns or belongs to Project` */
  readonly label: string
  /** its Policies' names, the one that is the opening first, then by what follows */
  readonly names: readonly string[]
}

export interface PolicyListing {
  /** largest first */
  readonly families: readonly PolicyFamily[]
  /** by Policy name */
  readonly entries: ReadonlyMap<
    string,
    {
      /** as its row reads: `… of Issue` under its family, `authored Comment` alone */
      readonly label: string
      /** the whole name in words: `owns or belongs to Project of Issue` */
      readonly phrase: string
      readonly family?: string
    }
  >
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The Policies named `names`, listed: in words, by family. */
export function listPolicies(
  names: readonly string[],
  classes: ReadonlyMap<string, string>,
): PolicyListing {
  const words = new Map(names.map((name) => [name, policyWords(name, classes)]))
  const key = (opening: readonly string[]) => opening.join('\u0000')
  const left = new Set(words.keys())
  const families: { opening: string[]; names: string[] }[] = []
  for (;;) {
    const openings = new Map<string, { opening: string[]; names: string[] }>()
    for (const name of left) {
      const own = words.get(name)!
      for (let count = 1; count <= own.length; count++) {
        const opening = own.slice(0, count)
        if (JOINING.has(opening.at(-1)!.toLowerCase())) continue
        const found = openings.get(key(opening)) ?? { opening, names: [] }
        found.names.push(name)
        openings.set(key(opening), found)
      }
    }
    // the opening that saves the most words: every Policy but one no longer repeats it
    const saved = (one: { opening: string[]; names: string[] }) =>
      (one.names.length - 1) * one.opening.length
    const best = [...openings.values()]
      .filter((one) => one.names.length >= FAMILY_SIZE)
      .sort(
        (a, b) =>
          saved(b) - saved(a) ||
          b.opening.length - a.opening.length ||
          key(a.opening).localeCompare(key(b.opening)),
      )[0]
    if (!best) break
    families.push(best)
    for (const name of best.names) left.delete(name)
  }
  families.sort((a, b) => b.names.length - a.names.length)

  const entries = new Map<string, { label: string; phrase: string; family?: string }>()
  const listed: PolicyFamily[] = families.map(({ opening, names: members }) => {
    const id = opening.join('-').toLowerCase()
    const rest = (name: string) => words.get(name)!.slice(opening.length).join(' ')
    const ordered = [...members].sort((a, b) => rest(a).localeCompare(rest(b)))
    for (const name of ordered) {
      const phrase = words.get(name)!.join(' ')
      entries.set(name, {
        label: rest(name) === '' ? phrase : `… ${rest(name)}`,
        phrase,
        family: id,
      })
    }
    return { id, label: capitalized(opening.join(' ')), names: ordered }
  })
  for (const name of left) {
    const phrase = words.get(name)!.join(' ')
    entries.set(name, { label: phrase, phrase })
  }
  return { families: listed, entries }
}

const listings = new WeakMap<DomainRules, PolicyListing>()

/**
 * The Node Classes a Domain's rules name, each by its lower-case form: its own and those of its
 * closure. A relationship is no thing a Policy's name speaks of by its Class: a word that happens
 * to spell one (`raised`, with a relationship `Raised`) stays a word.
 */
function classesOf(rules: DomainRules): Map<string, string> {
  const classes = new Map<string, string>()
  for (const [key, declared] of Object.entries(rules.catalogue?.words.schema.classes ?? {})) {
    if (declared.kind !== 'node') continue
    const name = parseClassRefKey(key)?.name
    if (name !== undefined && !classes.has(name.toLowerCase()))
      classes.set(name.toLowerCase(), name)
  }
  return classes
}

/** Whether the Index lists a Policy: the Domain's own, and another's that one of its places checks. */
export const isListedPolicy = (rules: DomainRules, policy: DomainRules['policies'][number]) =>
  policy.origin === rules.origin || policy.sitsOn.length > 0

/** The listing of the Policies a Domain's Index lists. */
export function policyListing(rules: DomainRules): PolicyListing {
  let listing = listings.get(rules)
  if (!listing) {
    const names = [...rules.policies, ...rules.imported]
      .filter((policy) => isListedPolicy(rules, policy))
      .map((policy) => policy.name)
    listing = listPolicies([...new Set(names)], classesOf(rules))
    listings.set(rules, listing)
  }
  return listing
}

const FAMILY_GROUP = 'policies.'

/** The Index group a family is listed under. */
export const familyGroup = (family: string) => `${FAMILY_GROUP}${family}`

/** Whether an Index group is a family of Policies. */
export const isPolicyGroup = (group: string) => group.startsWith(FAMILY_GROUP)

/**
 * A Domain's listed Policies as the Index lists them: a group per family, then `rest` for those
 * no family holds (`Policies`, or `Other Policies` beside families); each Policy an entry `entry`
 * makes, given the label its row reads and the group it is listed under.
 */
export function policyIndex(
  rules: DomainRules,
  rest: string,
  entry: (policy: PolicyRule, label: string, group: string) => SceneEntry,
): { groups: SceneGroup[]; entries: SceneEntry[] } {
  const listing = policyListing(rules)
  const byName = new Map<string, PolicyRule>()
  for (const policy of [...rules.policies, ...rules.imported])
    if (isListedPolicy(rules, policy) && !byName.has(policy.name)) byName.set(policy.name, policy)
  const made = (name: string, group: string): SceneEntry => {
    const policy = byName.get(name)!
    const said = listing.entries.get(name)!
    const one = entry(policy, said.label, group)
    // found by its name as written and by its whole phrase, whatever its row reads
    return { ...one, keywords: [...new Set([name, said.phrase, ...(one.keywords ?? [])])] }
  }
  const alone = [...byName.keys()].filter((name) => listing.entries.get(name)?.family === undefined)
  return {
    groups: [
      ...listing.families.map((family) => ({
        id: familyGroup(family.id),
        label: family.label,
        phrase: true as const,
      })),
      ...(alone.length > 0
        ? [{ id: rest, label: listing.families.length > 0 ? 'Other Policies' : 'Policies' }]
        : []),
    ],
    entries: [
      ...listing.families.flatMap((family) =>
        family.names.map((name) => made(name, familyGroup(family.id))),
      ),
      ...alone.map((name) => made(name, rest)),
    ],
  }
}
