/**
 * The Data level's sentences about Edges, in the Domain's own words: a relationship reads as the
 * reader's reading of it (`owned by the identity Kernel`), a Node as its Class's noun and name.
 * Where the reader has no reading, the relationship is said by its declared name.
 */

import type { Terms } from '../inspector/words'
import type { DataEdge, DatasetModel } from './model'

import { relationPhrase } from '../inspector/words'
import { relationKey } from './access'
import { endLabel } from './model'

export interface EdgeSentence {
  /** the words before the other end: `Owned by the identity`, `The cloudflare service` */
  readonly before: string
  /** the other end, by path, and as it is named */
  readonly other: { readonly path: string; readonly label: string }
  /** the words after it: `is owned by it`, or `points at it by` before the relationship's name */
  readonly after: string
  /** the relationship's declared name, said when the reader has no reading for it */
  readonly name?: string
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** What a Node, or an end the dataset does not hold, is called before its name. */
export function kindOf(
  model: DatasetModel,
  terms: Terms,
  identities: ReadonlySet<string>,
  path: string,
): string {
  if (identities.has(path)) return 'identity'
  const end = model.outside.get(path)
  if (end) return end.kind === 'domain' ? 'Domain' : 'path'
  const cls = model.classOf.get(path)
  if (!cls) return 'Node'
  const noun = terms.noun(cls.key)
  if (!noun) return cls.name
  return noun.origin === undefined ? noun.one : noun.one.replace(` (${noun.origin})`, '')
}

/**
 * An Edge said from one of its ends: from its source, `Owned by the identity Kernel`; from its
 * target, `The cloudflare service 354iwg4avm6wdmrs is owned by it`. A relationship the reader has
 * no reading for is said by name: `Points at the cloudflare service 354iwg4avm6wdmrs by deployment_of`.
 */
export function edgeSentence(
  model: DatasetModel,
  terms: Terms,
  identities: ReadonlySet<string>,
  edge: DataEdge,
  from: 'source' | 'target',
): EdgeSentence {
  const phrase = relationPhrase(terms.relation(relationKey(model, edge)), 'source')
  const otherPath = from === 'source' ? edge.to : edge.from
  const other = { path: otherPath, label: endLabel(model, otherPath) }
  const kind = kindOf(model, terms, identities, otherPath)
  if (from === 'source') {
    if (phrase === undefined)
      return { before: `Points at the ${kind}`, other, after: 'by', name: edge.name }
    return { before: `${capital(phrase.replace(/^is /, ''))} the ${kind}`, other, after: '' }
  }
  if (phrase === undefined)
    return { before: `The ${kind}`, other, after: 'points at it by', name: edge.name }
  return { before: `The ${kind}`, other, after: `${phrase} it` }
}
