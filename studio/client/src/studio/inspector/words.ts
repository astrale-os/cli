/**
 * The words the Inspector says a Schema's structure in. Nouns and relation readings are
 * `@astrale-os/visual`'s designations of the Schema's items (`lookup`), never a wording of the
 * Inspector's own: this module only puts a count and a Class's name around them. Where the
 * reader has no reading for a relationship, the relationship is said by its declared name.
 */
import type { Catalogue, Noun, RelationDesignation } from '@astrale-os/visual'

import { lookup } from '@astrale-os/visual'

/** The designations the Inspector reads, by Kernel Key; empty when the Domain's words are unread. */
export interface Terms {
  readonly noun: (key: string) => Noun | undefined
  readonly relation: (key: string) => RelationDesignation | undefined
}

export const NO_TERMS: Terms = { noun: () => undefined, relation: () => undefined }

/**
 * The English designations of a Domain's catalogue. A Key its Schemas do not hold has none: the
 * reader is not asked to derive words for a Class it was never given.
 */
export function termsOf(catalogue: Catalogue | undefined): Terms {
  if (catalogue === undefined) return NO_TERMS
  const { words } = catalogue
  const held = (key: string) => words.schema.classes[key] !== undefined
  return {
    noun: (key) => (held(key) ? lookup(words, 'en', key, 'class')?.designation.noun : undefined),
    relation: (key) => (held(key) ? lookup(words, 'en', key, 'relation')?.designation : undefined),
  }
}

/** A declared count (`min..max`, `max: null` unbounded) in words; absent, any number. */
export function countWords(count: { min: number; max: number | null } | undefined): string {
  if (count === undefined) return 'any number of'
  const { min, max } = count
  if (max === null)
    return min <= 0 ? 'any number of' : min === 1 ? 'at least one' : `at least ${min}`
  if (min === max) return max === 1 ? 'exactly one' : `exactly ${max}`
  if (min <= 0) return max === 1 ? 'at most one' : `at most ${max}`
  return `between ${min} and ${max}`
}

/**
 * Whether the noun after a count's words is said in the plural: when the count admits more than
 * one, except after `at least one`, which English follows with the singular.
 */
export const countsMany = (count: { min: number; max: number | null } | undefined): boolean =>
  (count === undefined || count.max === null || count.max > 1) &&
  !countWords(count).endsWith(' one')

/** A noun's spelling with the origin it says after it (`role (Admin)`) left out. */
const bare = (spelling: string, noun: Noun) =>
  noun.origin === undefined ? spelling : spelling.replace(` (${noun.origin})`, '')

/**
 * A Class's name in the plural, as its noun's plural ends: the ending the noun's `other` puts in
 * place of its `one`'s, on the name (`FleetResource`, `fleet resource` → `fleet resources`:
 * `FleetResources`; `Policy` → `Policies`). Without a noun, the name with an `s`.
 */
export function pluralName(name: string, noun: Noun | undefined): string {
  if (noun === undefined || noun.names === 'link') return `${name}s`
  const one = bare(noun.one, noun)
  const other = bare(noun.other, noun)
  let common = 0
  while (common < one.length && common < other.length && one[common] === other[common]) common++
  const dropped = one.length - common
  if (dropped > name.length) return `${name}s`
  return `${name.slice(0, name.length - dropped)}${other.slice(common)}`
}

/** Letters whose name starts with a vowel sound, as an initialism reads them: `an HTTP route`. */
const VOWEL_LETTERS = /^[AEFHILMNORSX]/
/** Words spelled with a vowel that start with a consonant sound: `a user`, `a unique`, `a one`. */
const CONSONANT_SOUND = /^(u(ni|s[aeiu]|ser|ti|ri|ra|ro|ku|bi|ga)|eu|one|once)/i
/** Words spelled with a consonant that start with a vowel sound. */
const VOWEL_SOUND = /^(hour|honest|honou?r|heir)/i

/** The indefinite article a word takes, as it sounds: `a`, or `an` (`an Identity`, `an action`). */
export function indefiniteArticle(word: string): 'a' | 'an' {
  const initialism = /^[A-Z]{2,}(?![a-z])/.exec(word)
  if (initialism) return VOWEL_LETTERS.test(word) ? 'an' : 'a'
  if (VOWEL_SOUND.test(word)) return 'an'
  if (CONSONANT_SOUND.test(word)) return 'a'
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/** A phrase after the indefinite article it takes: `an Identity`, `a Ticket link`. */
export const withArticle = (phrase: string): string => `${indefiniteArticle(phrase)} ${phrase}`

/** A phrase as a sentence starts it: its first letter capital. */
export const opening = (phrase: string): string =>
  phrase.replace(/^./u, (first) => first.toUpperCase())

/** The indefinite article before a Class's name: the noun's own when it says one. */
export function articleOf(name: string, noun: Noun | undefined): 'A' | 'An' {
  const article = noun?.article ?? indefiniteArticle(noun?.one ?? name)
  return article === 'an' ? 'An' : 'A'
}

/**
 * How a relationship reads with a Class at `end` as its subject, before the count of the other
 * end: the reader's reading of it (`contains`, `runs on`, `is claimed by`), its passive when the
 * reading's subject is the other end and it is a verb (`is contained by`). Undefined when the
 * reader has no reading that end can say.
 */
export function relationPhrase(
  relation: RelationDesignation | undefined,
  end: 'source' | 'target',
): string | undefined {
  for (const reading of relation?.readings ?? []) {
    const object = reading.object === undefined ? '' : ` ${reading.object}`
    if (reading.subject === end) {
      if (reading.verb !== undefined)
        return `${reading.verb.forms?.s ?? `${reading.verb.lemma}s`}${object}`
      if (reading.participle !== undefined)
        return `is ${reading.participle.forms.one ?? Object.values(reading.participle.forms)[0]}${object}`
      if (reading.attribute !== undefined) return `is ${reading.attribute}${object}`
      if (object !== '') return `is${object}`
    } else if (reading.verb !== undefined && reading.object === undefined) {
      const participle = reading.verb.forms?.participle ?? `${reading.verb.lemma}ed`
      return `is ${participle} by`
    }
  }
  return undefined
}
