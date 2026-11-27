/**
 * The versions island: runs inside the extractor process (`extractor --versions <request>`) with
 * one project's installed SDK and nothing else, and answers one request on stdout.
 *
 * - `compare` judges a dependent Schema against versions of its dependencies with the DSL's
 *   dependency-scoped `compare`. Capability requirements are not judged (they are not part of the
 *   Schema), and the binding is judged as a new one.
 * - `project` decodes a Publication's bundle, checks it is the Publication's Schema, and projects
 *   it into Studio's render IR, exactly as a workspace Domain's admitted Schema is projected.
 *
 * It imports only the island builder, the canonical projection and Node's file system, so the
 * extractor stays free of the Studio server.
 */
import { readFile } from 'node:fs/promises'

import type { SchemaIR } from '../../../shared/contracts/schema'
import type { ObservedValue, UnsatisfiedAssessment } from '../../../shared/contracts/versions'
import type { CanonicalDomainSchemaV1, SchemaSdk } from '../../introspect/canonical-schema'

import { extractCanonicalSchemaFromSdk } from '../../introspect/canonical-schema'
import { evaluateIsland, installedSdkExport } from '../../introspect/island'

export const VERSIONS_MODE = '--versions'

/** A Schema and its dependency Schemas, as a DSL Bundle carries them. */
export interface IslandDocument {
  root: unknown
  closure: unknown[]
}

/** One version of a dependency to judge against: an admitted document, or a Publication's bundle. */
export interface CompareTarget {
  id: string
  origin: string
  revision: string
  source: { document: IslandDocument } | { bundleFile: string }
}

export type IslandRequest =
  | { op: 'compare'; projectRoot: string; dependent: IslandDocument; targets: CompareTarget[] }
  | { op: 'project'; projectRoot: string; bundleFile: string; origin: string; revision: string }

export interface IslandJudgement {
  compatible: boolean
  equivalent: boolean
  unsatisfied: UnsatisfiedAssessment[]
  evidence: { structure: string; meaning: string }
}

export type IslandAnswer =
  | {
      ok: true
      op: 'compare'
      results: Array<
        ({ id: string; ok: true } & IslandJudgement) | { id: string; ok: false; message: string }
      >
    }
  | { ok: true; op: 'project'; ir: SchemaIR; root: unknown; closure: unknown[]; revision: string }
  | { ok: false; error: { message: string } }

/** A value larger than this, as JSON, is carried only by its size. */
export const OBSERVED_VALUE_LIMIT = 2_000
/** At most this many differences are carried per assessment. */
export const DIFFERENCES_LIMIT = 50

type AnyRecord = Record<string, any>

interface VersionsSdk extends SchemaSdk {
  readonly bundle: SchemaSdk['bundle'] & {
    readonly FORMAT: string
    readonly VERSION: unknown
    decode(bytes: Uint8Array): { root: CanonicalDomainSchemaV1; closure: readonly unknown[] }
  }
  readonly schema: SchemaSdk['schema'] & {
    revision(root: unknown): string
    compatibility: { compare(input: unknown): AnyRecord }
  }
}

export async function runVersionsIsland(requestFile: string | undefined): Promise<void> {
  if (!requestFile) throw new Error('extractor --versions: missing <requestFile>')
  const request = JSON.parse(await readFile(requestFile, 'utf8')) as IslandRequest
  const sdkPath = await installedSdkExport(request.projectRoot, './schema')
  const island = await evaluateIsland({
    projectRoot: request.projectRoot,
    // Nothing is authored here: the SDK itself is the only module to read.
    authoredPath: sdkPath,
    sdkPath,
    label: 'versions',
  })
  const sdk = island.sdk as unknown as VersionsSdk
  const answer: IslandAnswer =
    request.op === 'compare' ? await compareAll(sdk, request) : await project(sdk, request)
  process.stdout.write(JSON.stringify(answer))
}

function accept(sdk: VersionsSdk, document: IslandDocument): CanonicalDomainSchemaV1 {
  return sdk.bundle.accept({
    format: sdk.bundle.FORMAT,
    version: sdk.bundle.VERSION,
    root: document.root,
    closure: document.closure,
  }).root
}

/** The bundle a Publication names, admitted only as that origin at that Schema revision. */
async function publishedRoot(
  sdk: VersionsSdk,
  file: string,
  origin: string,
  revision: string,
): Promise<{ root: CanonicalDomainSchemaV1; closure: readonly unknown[] }> {
  const decoded = sdk.bundle.decode(new Uint8Array(await readFile(file)))
  if (decoded.root.origin !== origin) {
    throw new Error(`The bundle holds ${decoded.root.origin}, not ${origin}.`)
  }
  const actual = sdk.schema.revision(decoded.root)
  if (actual !== revision) {
    throw new Error(`The bundle's Schema revision is ${actual}, not the published ${revision}.`)
  }
  return decoded
}

async function compareAll(
  sdk: VersionsSdk,
  request: Extract<IslandRequest, { op: 'compare' }>,
): Promise<IslandAnswer> {
  const dependent = accept(sdk, request.dependent)
  const results: Extract<IslandAnswer, { op: 'compare' }>['results'] = []
  for (const target of request.targets) {
    try {
      const root =
        'document' in target.source
          ? accept(sdk, target.source.document)
          : (await publishedRoot(sdk, target.source.bundleFile, target.origin, target.revision))
              .root
      if (root.origin !== target.origin)
        throw new Error(`The target is ${root.origin}, not ${target.origin}.`)
      if (sdk.schema.revision(root) !== target.revision) {
        throw new Error(`The target's Schema revision is not ${target.revision}.`)
      }
      const comparison = sdk.schema.compatibility.compare({
        scope: { kind: 'dependency', dependent },
        target: root,
      })
      results.push({ id: target.id, ok: true, ...judgementOf(comparison) })
    } catch (error) {
      results.push({ id: target.id, ok: false, message: messageOf(error) })
    }
  }
  return { ok: true, op: 'compare', results }
}

/** The verdict of one `Comparison`: before is what the dependent requires, after what is provided. */
export function judgementOf(comparison: AnyRecord): IslandJudgement {
  const entries: AnyRecord[] = Array.isArray(comparison.entries) ? comparison.entries : []
  const assessments: AnyRecord[] = comparison.structure?.assessments ?? []
  return {
    compatible: comparison.structure?.compatible === true,
    equivalent: comparison.meaning?.equivalent === true,
    unsatisfied: assessments
      .filter((assessment) => assessment.satisfied !== true)
      .map((assessment) => unsatisfiedOf(assessment, entries)),
    evidence: {
      structure: String(comparison.evidence?.structure?.fingerprint ?? ''),
      meaning: String(comparison.evidence?.meaning?.fingerprint ?? ''),
    },
  }
}

function unsatisfiedOf(assessment: AnyRecord, entries: AnyRecord[]): UnsatisfiedAssessment {
  const observation: AnyRecord = assessment.observation ?? {}
  const subject = { key: String(assessment.subject?.key), kind: String(assessment.subject?.kind) }
  const entry = entries.find(
    (candidate) =>
      candidate.subject?.key === subject.key && candidate.subject?.kind === subject.kind,
  )
  const differences: AnyRecord[] = Array.isArray(observation.differences)
    ? observation.differences
    : []
  return {
    subject,
    facet: String(observation.facet),
    requirement: String(assessment.requirement?.kind),
    state: observation.state,
    ...observed('required', observation, 'before'),
    ...observed('provided', observation, 'after'),
    differences: differences.slice(0, DIFFERENCES_LIMIT).map((difference) => ({
      path: String(difference.path),
      ...observed('required', difference, 'before'),
      ...observed('provided', difference, 'after'),
    })),
    differencesOmitted: Math.max(0, differences.length - DIFFERENCES_LIMIT),
    usages: (Array.isArray(entry?.usages) ? entry.usages : []).map((usage: AnyRecord) => ({
      origin: String(usage.source?.origin),
      ...(typeof usage.key === 'string' ? { key: usage.key } : {}),
      relation: String(usage.relation),
    })),
  }
}

/** `{ [as]: value }` when `from[field]` is present; a large value is carried by its size only. */
function observed<K extends 'required' | 'provided'>(
  as: K,
  from: AnyRecord,
  field: 'before' | 'after',
): Partial<Record<K, ObservedValue>> {
  if (!(field in from) || from[field] === undefined) return {}
  const text = JSON.stringify(from[field])
  const value: ObservedValue =
    text.length > OBSERVED_VALUE_LIMIT
      ? { elided: true, bytes: Buffer.byteLength(text) }
      : { value: from[field] }
  return { [as]: value } as Partial<Record<K, ObservedValue>>
}

async function project(
  sdk: VersionsSdk,
  request: Extract<IslandRequest, { op: 'project' }>,
): Promise<IslandAnswer> {
  const decoded = await publishedRoot(sdk, request.bundleFile, request.origin, request.revision)
  const extraction = extractCanonicalSchemaFromSdk(sdk, decoded.root)
  if (extraction.status !== 'admitted' || extraction.revision !== request.revision) {
    throw new Error(`The installed SDK does not admit ${request.origin} at ${request.revision}.`)
  }
  return {
    ok: true,
    op: 'project',
    ir: extraction.ir,
    root: extraction.root,
    closure: [...(extraction.closure ?? [])],
    revision: extraction.revision,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
