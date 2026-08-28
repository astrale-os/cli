import type { SearchArtifacts } from './artifacts'

import { UiError } from '../model'
import {
  SEARCH_FIELD_NAMES,
  SEARCH_LIMITS,
  acceptMetadataPart,
  acceptSerializedIndex,
  acceptTermPart,
  type SearchDocument,
  type SearchManifest,
  type SearchScoring,
  type SerializedSearchIndex,
} from './model'

type Match = { queryPosition: number; queryTerm: string; term: string; weight: number }
type Ranked = { score: number; document: SearchDocument }
type QueryResult = { total: number; results: Ranked[] }

const stopwords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

export function tokenizeSearch(value: string): string[] {
  const expanded = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_/.-]+/gu, ' ')
    .toLowerCase()
  return (expanded.match(/[a-z0-9]+/gu) ?? []).filter(
    (term) => !stopwords.has(term) && term.length > 1,
  )
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  if (left === right) return true
  let leftIndex = 0
  let rightIndex = 0
  let edits = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1
}

function resolveTerms(
  terms: string[],
  documentFrequencies: ReadonlyMap<string, number>,
  query: string,
  scoring: SearchScoring,
): { queryTerms: string[]; matches: Match[] } {
  const queryTerms = [...new Set(tokenizeSearch(query))]
  const matches: Match[] = []
  for (const [queryPosition, queryTerm] of queryTerms.entries()) {
    if (documentFrequencies.has(queryTerm)) {
      matches.push({ queryPosition, queryTerm, term: queryTerm, weight: 1 })
      continue
    }
    const resolved = new Map<string, number>()
    if (queryTerm.length >= 3) {
      const prefixes = terms
        .filter((term) => term.startsWith(queryTerm))
        .sort(
          (left, right) =>
            left.length - right.length ||
            documentFrequencies.get(left)! - documentFrequencies.get(right)! ||
            left.localeCompare(right),
        )
        .slice(0, scoring.prefixTermLimit)
      for (const term of prefixes) resolved.set(term, scoring.prefixWeight)
    }
    if (queryTerm.length >= 5) {
      const fuzzy = terms
        .filter(
          (term) => Math.abs(term.length - queryTerm.length) <= 1 && withinOneEdit(term, queryTerm),
        )
        .sort(
          (left, right) =>
            Math.abs(left.length - queryTerm.length) - Math.abs(right.length - queryTerm.length) ||
            documentFrequencies.get(left)! - documentFrequencies.get(right)! ||
            left.localeCompare(right),
        )
        .slice(0, scoring.fuzzyTermLimit)
      for (const term of fuzzy) {
        resolved.set(term, Math.max(scoring.fuzzyWeight, resolved.get(term) ?? 0))
      }
    }
    for (const [term, weight] of resolved) {
      matches.push({ queryPosition, queryTerm, term, weight })
    }
  }
  return { queryTerms, matches }
}

function popcount(value: number): number {
  let count = 0
  let remaining = value >>> 0
  while (remaining !== 0) {
    remaining &= remaining - 1
    count += 1
  }
  return count
}

function rerank(
  preliminary: Array<{ id: number; score: number }>,
  documents: ReadonlyMap<number, SearchDocument> | SearchDocument[],
  query: string,
  queryTerms: string[],
  offset: number,
  limit: number,
): QueryResult {
  const phrase = queryTerms.join(' ')
  const exactQuery = query.trim().normalize('NFKC').toLowerCase()
  const document = (id: number) => (Array.isArray(documents) ? documents[id] : documents.get(id))
  const ranked = preliminary
    .map(({ id, score: initialScore }) => {
      const current = document(id)
      if (!current) {
        throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search metadata is incomplete.')
      }
      const title = tokenizeSearch(current.title).join(' ')
      const description = tokenizeSearch(current.description).join(' ')
      const address = tokenizeSearch(current.address).join(' ')
      let score = initialScore
      if (title.includes(phrase)) score *= 1.35
      if (description.includes(phrase)) score *= 1.25
      if (current.address.normalize('NFKC').toLowerCase() === exactQuery) score *= 100
      else if (address === phrase || tokenizeSearch(query).join(' ') === address) score *= 4
      return { score, document: current }
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.title.localeCompare(right.document.title) ||
        left.document.address.localeCompare(right.document.address),
    )
  return { total: ranked.length, results: ranked.slice(offset, offset + limit) }
}

function exactDocument(documents: SearchDocument[], query: string): SearchDocument | undefined {
  const normalized = query.trim().normalize('NFKC').toLowerCase()
  let low = 0
  let high = documents.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const current = documents[middle]!
    const compared = current.address.normalize('NFKC').toLowerCase().localeCompare(normalized)
    if (compared === 0) return current
    if (compared < 0) low = middle + 1
    else high = middle - 1
  }
  return undefined
}

function finalizeScores(
  scores: Float64Array,
  masks: Uint32Array,
  touched: number[],
  queryTerms: string[],
  limit: number,
): Array<{ id: number; score: number }> {
  return touched
    .map((id) => ({
      id,
      score: scores[id]! * (0.5 + popcount(masks[id]!) / Math.max(queryTerms.length, 1)),
    }))
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .slice(0, limit)
}

function executeSingle(
  serialized: SerializedSearchIndex,
  manifest: SearchManifest,
  query: string,
  offset: number,
  limit: number,
): QueryResult {
  const exact = exactDocument(serialized.documents, query)
  if (exact) {
    return {
      total: 1,
      results: offset === 0 ? [{ score: Number.POSITIVE_INFINITY, document: exact }] : [],
    }
  }
  const width = SEARCH_FIELD_NAMES.length + 1
  const postings = new Map<string, number[][]>()
  for (const [term, flat] of serialized.terms) {
    const values: number[][] = []
    for (let position = 0; position < flat.length; position += width) {
      const posting = flat.slice(position, position + width)
      const id = posting[0]!
      if (id >= serialized.documents.length) {
        throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search posting escapes its corpus.')
      }
      values.push(posting)
    }
    postings.set(term, values)
  }
  const terms = [...postings.keys()]
  const frequencies = new Map(terms.map((term) => [term, postings.get(term)!.length]))
  const resolution = resolveTerms(terms, frequencies, query, manifest.scoring.parameters)
  if (resolution.queryTerms.length === 0) return { total: 0, results: [] }
  const scores = new Float64Array(serialized.documents.length)
  const masks = new Uint32Array(serialized.documents.length)
  const touched: number[] = []
  for (const match of resolution.matches) {
    const currentPostings = postings.get(match.term)!
    const documentFrequency = currentPostings.length
    const inverseFrequency = Math.log(
      1 + (serialized.documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
    )
    for (const [id, ...fieldFrequencies] of currentPostings) {
      const document = serialized.documents[id]!
      let combined = 0
      for (const [field, frequency] of fieldFrequencies.entries()) {
        if (frequency === 0) continue
        const average = Math.max(serialized.averageLengths[field]!, 1)
        const normalization =
          1 -
          manifest.scoring.parameters.lengthNormalization[field]! +
          manifest.scoring.parameters.lengthNormalization[field]! *
            (document.lengths![field]! / average)
        combined += manifest.scoring.parameters.boosts[field]! * (frequency / normalization)
      }
      const contribution =
        inverseFrequency *
        ((combined * (manifest.scoring.parameters.saturation + 1)) /
          (combined + manifest.scoring.parameters.saturation)) *
        match.weight
      if (scores[id] === 0) touched.push(id)
      scores[id] = scores[id]! + contribution
      masks[id] = masks[id]! | (1 << (match.queryPosition % 31))
    }
  }
  return rerank(
    finalizeScores(
      scores,
      masks,
      touched,
      resolution.queryTerms,
      manifest.scoring.parameters.rerankCandidates,
    ),
    serialized.documents,
    query,
    resolution.queryTerms,
    offset,
    limit,
  )
}

function termHash(value: string): number {
  let result = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16_777_619)
  }
  return result >>> 0
}

async function executePartitioned(
  artifacts: SearchArtifacts,
  query: string,
  offset: number,
  limit: number,
): Promise<QueryResult> {
  const manifest = artifacts.manifest
  if (manifest.layout.kind !== 'partitioned') {
    throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search layout changed unexpectedly.')
  }
  const layout = manifest.layout
  const terms = layout.terms.map(([term]) => term)
  const frequency = new Map(layout.terms.map(([term, _part, count]) => [term, count]))
  const resolution = resolveTerms(terms, frequency, query, manifest.scoring.parameters)
  if (resolution.queryTerms.length === 0) return { total: 0, results: [] }
  const partByTerm = new Map(layout.terms.map(([term, part]) => [term, part]))
  const selectedPartIds = new Set(resolution.matches.map(({ term }) => partByTerm.get(term)!))
  const normalizedQuery = query.trim().normalize('NFKC').toLowerCase()
  const exactTerm = `\0${normalizedQuery}`
  const mayBeAddress = /^(?:@astrale-os\/ui\/|(?:component|pattern|block|theme)\/)/u.test(
    normalizedQuery,
  )
  if (mayBeAddress) selectedPartIds.add(termHash(exactTerm) % layout.termFiles.length)
  const loadedParts = await Promise.all(
    [...selectedPartIds].map(async (part) => ({
      part,
      values: acceptTermPart(await artifacts.readJson(layout.termFiles[part]!), layout.documents),
    })),
  )
  const postings = new Map<string, number[]>()
  for (const { part, values } of loadedParts) {
    for (const [term, valuesForTerm] of values) {
      const manifestPart = partByTerm.get(term)
      const exactAddressTerm = term.startsWith('\0')
      if (
        termHash(term) % layout.termFiles.length !== part ||
        (!exactAddressTerm && manifestPart !== part) ||
        (!exactAddressTerm && valuesForTerm.length / 2 !== frequency.get(term)) ||
        postings.has(term)
      ) {
        throw new UiError(
          'UI_SEARCH_UNAVAILABLE',
          'Astrale UI search term partition ownership is invalid.',
        )
      }
      postings.set(term, valuesForTerm)
    }
  }
  if (resolution.matches.some(({ term }) => !postings.has(term))) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search term partition is incomplete.')
  }
  if (mayBeAddress && postings.has(exactTerm)) {
    const exactPosting = postings.get(exactTerm)!
    if (exactPosting.length !== 2 || exactPosting[1] !== 1) {
      throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI exact posting is malformed.')
    }
    const id = exactPosting[0]!
    const metadataPart = layout.documentMetadataParts[id]!
    const metadata = acceptMetadataPart(
      await artifacts.readJson(layout.metadataFiles[metadataPart]!),
      layout.documents,
    )
    if (
      metadata.some(([documentId]) => layout.documentMetadataParts[documentId] !== metadataPart)
    ) {
      throw new UiError(
        'UI_SEARCH_UNAVAILABLE',
        'Astrale UI search metadata partition ownership is invalid.',
      )
    }
    const document = metadata.find(([documentId]) => documentId === id)?.[1]
    if (!document) {
      throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI exact result metadata is missing.')
    }
    if (document.address.normalize('NFKC').toLowerCase() !== normalizedQuery) {
      throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI exact result identity is invalid.')
    }
    return {
      total: 1,
      results: offset === 0 ? [{ score: Number.POSITIVE_INFINITY, document }] : [],
    }
  }

  const scores = new Float64Array(layout.documents)
  const masks = new Uint32Array(layout.documents)
  const touched: number[] = []
  for (const match of resolution.matches) {
    const flat = postings.get(match.term)
    if (!flat) continue
    const documentFrequency = flat.length / 2
    const inverseFrequency = Math.log(
      1 + (layout.documents - documentFrequency + 0.5) / (documentFrequency + 0.5),
    )
    for (let position = 0; position < flat.length; position += 2) {
      const id = flat[position]!
      const normalizedFrequency = flat[position + 1]!
      const contribution =
        inverseFrequency *
        ((normalizedFrequency * (manifest.scoring.parameters.saturation + 1)) /
          (normalizedFrequency + manifest.scoring.parameters.saturation)) *
        match.weight
      if (scores[id] === 0) touched.push(id)
      scores[id] = scores[id]! + contribution
      masks[id] = masks[id]! | (1 << (match.queryPosition % 31))
    }
  }
  const preliminary = finalizeScores(
    scores,
    masks,
    touched,
    resolution.queryTerms,
    manifest.scoring.parameters.rerankCandidates,
  )
  const metadataPartIds = new Set(preliminary.map(({ id }) => layout.documentMetadataParts[id]!))
  const metadata = new Map<number, SearchDocument>()
  await Promise.all(
    [...metadataPartIds].map(async (part) => {
      for (const [id, document] of acceptMetadataPart(
        await artifacts.readJson(layout.metadataFiles[part]!),
        layout.documents,
      )) {
        if (layout.documentMetadataParts[id] !== part || metadata.has(id)) {
          throw new UiError(
            'UI_SEARCH_UNAVAILABLE',
            'Astrale UI search metadata partition ownership is invalid.',
          )
        }
        metadata.set(id, document)
      }
    }),
  )
  return rerank(preliminary, metadata, query, resolution.queryTerms, offset, limit)
}

export async function executeSearch(
  artifacts: SearchArtifacts,
  query: string,
  offset: number,
  limit: number,
): Promise<QueryResult> {
  const { manifest } = artifacts
  if (manifest.layout.kind === 'partitioned') {
    return executePartitioned(artifacts, query, offset, limit)
  }
  const serialized = acceptSerializedIndex(
    await artifacts.readJson(manifest.layout.index),
    manifest,
  )
  return executeSingle(serialized, manifest, query, offset, limit)
}

export function admitSearchRequest(
  query: string,
  options: { limit?: number; offset?: number },
): { query: string; limit: number; offset: number } {
  const normalized = query.trim()
  const limit = options.limit ?? SEARCH_LIMITS.defaultResults
  const offset = options.offset ?? 0
  if (
    normalized.length === 0 ||
    [...normalized].length > SEARCH_LIMITS.queryCodePoints ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > SEARCH_LIMITS.maxResults ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > SEARCH_LIMITS.maxOffset
  ) {
    throw new UiError(
      'UI_SEARCH_QUERY_INVALID',
      'UI search requires a non-empty query, limit 1-10, and offset 0-1009.',
    )
  }
  return { query: normalized, limit, offset }
}
