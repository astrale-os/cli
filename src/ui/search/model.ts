import { createHash } from 'node:crypto'

import { UiError } from '../model'

export const SEARCH_LIMITS = Object.freeze({
  queryCodePoints: 256,
  defaultResults: 5,
  maxResults: 10,
  maxOffset: 1_009,
  rerankCandidates: 1_010,
  maxCodeBytes: 64 * 1_024,
  maxManifestBytes: 4 * 1_024 * 1_024,
  maxArtifactBytes: 4 * 1_024 * 1_024,
})

export const SEARCH_FIELD_NAMES = Object.freeze([
  'identity',
  'description',
  'behavior',
  'dependencies',
])

export type SearchScoring = {
  boosts: number[]
  lengthNormalization: number[]
  saturation: number
  prefixWeight: number
  fuzzyWeight: number
  prefixTermLimit: number
  fuzzyTermLimit: number
  rerankCandidates: number
}

export type SearchArtifactFile = { path: string; bytes: number; sha256: string }

export type SearchManifest = {
  version: 1
  engine: 'lexical-v1'
  scoring: { fingerprint: string; parameters: SearchScoring }
  corpus: { registry: number; runtime: number; total: number }
  layout:
    | { kind: 'single'; index: SearchArtifactFile }
    | {
        kind: 'partitioned'
        documents: number
        terms: Array<[string, number, number]>
        documentMetadataParts: number[]
        termFiles: SearchArtifactFile[]
        metadataFiles: SearchArtifactFile[]
      }
}

export type SearchCode = {
  language: 'tsx' | 'css'
  path: string
  bytes: number
  sha256: string
}

export type SearchDocument = {
  address: string
  title: string
  description: string
  dependencies: string[]
  code: SearchCode
  family: string
  command?: string
  packageImport?: string
  lengths?: number[]
}

export type SerializedSearchIndex = {
  version: 1
  scoringFingerprint: string
  fieldNames: string[]
  averageLengths: number[]
  documents: SearchDocument[]
  terms: Array<[string, number[]]>
}

export type SearchResult = {
  address: string
  title: string
  description: string
  dependencies: string[]
  code: { language: 'tsx' | 'css'; source: string }
  command?: string
  packageImport?: string
}

export type SearchResponse = {
  query: string
  release: { version: string; commit: string }
  offset: number
  limit: number
  total: number
  nextOffset: number | null
  results: SearchResult[]
}

function unavailable(message: string): never {
  throw new UiError('UI_SEARCH_UNAVAILABLE', message)
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined
}

function safePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/[?#%]/u.test(value) &&
    !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  )
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function finite(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

export function acceptArtifactFile(value: unknown): SearchArtifactFile {
  const candidate = record(value)
  if (
    !candidate ||
    !safePath(candidate.path) ||
    !candidate.path.startsWith('search/public/') ||
    !integer(candidate.bytes, 1, SEARCH_LIMITS.maxArtifactBytes) ||
    !digest(candidate.sha256)
  ) {
    unavailable('Astrale UI search references an invalid artifact file.')
  }
  return candidate as SearchArtifactFile
}

function acceptScoring(value: unknown): { fingerprint: string; parameters: SearchScoring } {
  const candidate = record(value)
  const parameters = record(candidate?.parameters)
  const boosts = parameters?.boosts
  const lengthNormalization = parameters?.lengthNormalization
  if (
    !candidate ||
    !digest(candidate.fingerprint) ||
    !parameters ||
    !Array.isArray(boosts) ||
    boosts.length !== SEARCH_FIELD_NAMES.length ||
    !boosts.every((entry) => finite(entry, 0, 100)) ||
    !Array.isArray(lengthNormalization) ||
    lengthNormalization.length !== SEARCH_FIELD_NAMES.length ||
    !lengthNormalization.every((entry) => finite(entry, 0, 1)) ||
    !finite(parameters.saturation, 0.01, 100) ||
    !finite(parameters.prefixWeight, 0, 1) ||
    !finite(parameters.fuzzyWeight, 0, 1) ||
    !integer(parameters.prefixTermLimit, 1, 64) ||
    !integer(parameters.fuzzyTermLimit, 1, 64) ||
    parameters.rerankCandidates !== SEARCH_LIMITS.rerankCandidates
  ) {
    unavailable('Astrale UI search scoring metadata is incompatible.')
  }
  const expected = createHash('sha256')
    .update(
      JSON.stringify({
        engine: 'lexical-v1',
        fieldNames: SEARCH_FIELD_NAMES,
        ...parameters,
      }),
    )
    .digest('hex')
  if (candidate.fingerprint !== expected)
    unavailable('Astrale UI search scoring metadata is stale.')
  return candidate as { fingerprint: string; parameters: SearchScoring }
}

export function acceptSearchManifest(value: unknown): SearchManifest {
  const candidate = record(value)
  const corpus = record(candidate?.corpus)
  const layout = record(candidate?.layout)
  if (
    !candidate ||
    candidate.version !== 1 ||
    candidate.engine !== 'lexical-v1' ||
    !corpus ||
    !integer(corpus.registry, 1, 1_000_000) ||
    !integer(corpus.runtime, 1, 100_000) ||
    !integer(corpus.total, 1, 1_000_000) ||
    corpus.registry + corpus.runtime !== corpus.total ||
    !layout
  ) {
    unavailable('Astrale UI search manifest is incompatible.')
  }
  const scoring = acceptScoring(candidate.scoring)
  if (layout.kind === 'single') {
    return {
      version: 1,
      engine: 'lexical-v1',
      scoring,
      corpus: corpus as SearchManifest['corpus'],
      layout: { kind: 'single', index: acceptArtifactFile(layout.index) },
    }
  }
  if (
    layout.kind !== 'partitioned' ||
    !integer(layout.documents, 1, 1_000_000) ||
    layout.documents !== corpus.total ||
    !Array.isArray(layout.terms) ||
    !Array.isArray(layout.documentMetadataParts) ||
    layout.documentMetadataParts.length !== layout.documents ||
    !Array.isArray(layout.termFiles) ||
    layout.termFiles.length === 0 ||
    !Array.isArray(layout.metadataFiles) ||
    layout.metadataFiles.length === 0
  ) {
    unavailable('Astrale UI search partition manifest is incompatible.')
  }
  const termFiles = layout.termFiles.map(acceptArtifactFile)
  const metadataFiles = layout.metadataFiles.map(acceptArtifactFile)
  const terms = layout.terms.map((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      typeof entry[0] !== 'string' ||
      entry[0].length === 0 ||
      !integer(entry[1], 0, termFiles.length - 1) ||
      !integer(entry[2], 1, Number(layout.documents))
    ) {
      unavailable('Astrale UI search term manifest is malformed.')
    }
    return entry as [string, number, number]
  })
  if (
    new Set(terms.map(([term]) => term)).size !== terms.length ||
    terms.some(([term], index) => index > 0 && terms[index - 1]![0] >= term) ||
    !layout.documentMetadataParts.every((part) => integer(part, 0, metadataFiles.length - 1))
  ) {
    unavailable('Astrale UI search partition mapping is malformed.')
  }
  return {
    version: 1,
    engine: 'lexical-v1',
    scoring,
    corpus: corpus as SearchManifest['corpus'],
    layout: {
      kind: 'partitioned',
      documents: layout.documents as number,
      terms,
      documentMetadataParts: layout.documentMetadataParts as number[],
      termFiles,
      metadataFiles,
    },
  }
}

function acceptCode(value: unknown): SearchCode {
  const candidate = record(value)
  if (
    !candidate ||
    (candidate.language !== 'tsx' && candidate.language !== 'css') ||
    !safePath(candidate.path) ||
    !integer(candidate.bytes, 1, SEARCH_LIMITS.maxCodeBytes) ||
    !digest(candidate.sha256)
  ) {
    unavailable('Astrale UI search contains invalid canonical code metadata.')
  }
  return candidate as SearchCode
}

export function acceptSearchDocument(value: unknown, lengths: boolean): SearchDocument {
  const candidate = record(value)
  const command = candidate?.command
  const packageImport = candidate?.packageImport
  if (
    !candidate ||
    typeof candidate.address !== 'string' ||
    !/^(?:@astrale-os\/ui\/[a-z0-9-]+|component\/[a-z0-9-/]+|(?:pattern|block)\/[a-z0-9-/]+|theme\/[a-z0-9-]+)$/u.test(
      candidate.address,
    ) ||
    typeof candidate.title !== 'string' ||
    typeof candidate.description !== 'string' ||
    !Array.isArray(candidate.dependencies) ||
    !candidate.dependencies.every((dependency) => typeof dependency === 'string') ||
    typeof candidate.family !== 'string' ||
    Boolean(command) === Boolean(packageImport) ||
    (command !== undefined && command !== `astrale ui add ${candidate.address}`) ||
    (packageImport !== undefined && packageImport !== candidate.address) ||
    (lengths &&
      (!Array.isArray(candidate.lengths) ||
        candidate.lengths.length !== SEARCH_FIELD_NAMES.length ||
        !candidate.lengths.every((entry) => integer(entry, 0, 1_000_000))))
  ) {
    unavailable('Astrale UI search contains an invalid result document.')
  }
  return { ...(candidate as SearchDocument), code: acceptCode(candidate.code) }
}

export function acceptSerializedIndex(
  value: unknown,
  manifest: SearchManifest,
): SerializedSearchIndex {
  const candidate = record(value)
  if (
    !candidate ||
    candidate.version !== 1 ||
    candidate.scoringFingerprint !== manifest.scoring.fingerprint ||
    JSON.stringify(candidate.fieldNames) !== JSON.stringify(SEARCH_FIELD_NAMES) ||
    !Array.isArray(candidate.averageLengths) ||
    candidate.averageLengths.length !== SEARCH_FIELD_NAMES.length ||
    !candidate.averageLengths.every((entry) => finite(entry, 0, 1_000_000)) ||
    !Array.isArray(candidate.documents) ||
    candidate.documents.length !== manifest.corpus.total ||
    !Array.isArray(candidate.terms)
  ) {
    unavailable('Astrale UI search index is incompatible.')
  }
  const documents = candidate.documents.map((document) => acceptSearchDocument(document, true))
  for (let index = 1; index < documents.length; index += 1) {
    if (documents[index - 1]!.address.localeCompare(documents[index]!.address) >= 0) {
      unavailable('Astrale UI search index documents are not canonical.')
    }
  }
  const width = SEARCH_FIELD_NAMES.length + 1
  const candidateTerms = candidate.terms as unknown[]
  const terms = candidateTerms.map((entry, termIndex) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      entry[0].length === 0 ||
      !Array.isArray(entry[1]) ||
      entry[1].length === 0 ||
      entry[1].length % width !== 0 ||
      !entry[1].every((number) => finite(number, 0, 1_000_000))
    ) {
      unavailable('Astrale UI search index postings are malformed.')
    }
    if (
      termIndex > 0 &&
      (candidateTerms[termIndex - 1] as unknown[])[0]!.toString().localeCompare(entry[0]) >= 0
    ) {
      unavailable('Astrale UI search index terms are not canonical.')
    }
    let previousDocument = -1
    for (let offset = 0; offset < entry[1].length; offset += width) {
      const document = entry[1][offset]
      if (!integer(document, 0, documents.length - 1) || document <= previousDocument) {
        unavailable('Astrale UI search index postings are not canonical.')
      }
      previousDocument = document
    }
    return entry as [string, number[]]
  })
  return {
    version: 1,
    scoringFingerprint: manifest.scoring.fingerprint,
    fieldNames: [...SEARCH_FIELD_NAMES],
    averageLengths: candidate.averageLengths as number[],
    documents,
    terms,
  }
}

export function acceptTermPart(value: unknown, documents: number): Array<[string, number[]]> {
  if (!Array.isArray(value)) unavailable('Astrale UI search term partition is malformed.')
  return value.map((entry, termIndex) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      entry[0].length === 0 ||
      !Array.isArray(entry[1]) ||
      entry[1].length === 0 ||
      entry[1].length % 2 !== 0
    ) {
      unavailable('Astrale UI search term partition is malformed.')
    }
    if (
      termIndex > 0 &&
      (value[termIndex - 1] as unknown[])[0]!.toString().localeCompare(entry[0]) >= 0
    ) {
      unavailable('Astrale UI search term partition is not canonical.')
    }
    let previousDocument = -1
    for (let offset = 0; offset < entry[1].length; offset += 2) {
      const document = entry[1][offset]
      if (
        !integer(document, 0, documents - 1) ||
        document <= previousDocument ||
        !finite(entry[1][offset + 1], 0, 1_000)
      ) {
        unavailable('Astrale UI search term posting is malformed.')
      }
      previousDocument = document
    }
    return entry as [string, number[]]
  })
}

export function acceptMetadataPart(
  value: unknown,
  documents: number,
): Array<[number, SearchDocument]> {
  if (!Array.isArray(value)) unavailable('Astrale UI search metadata partition is malformed.')
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !integer(entry[0], 0, documents - 1)) {
      unavailable('Astrale UI search metadata partition is malformed.')
    }
    if (index > 0 && ((value[index - 1] as unknown[])[0] as number) >= entry[0]) {
      unavailable('Astrale UI search metadata partition is not canonical.')
    }
    return [entry[0], acceptSearchDocument(entry[1], false)]
  })
}
