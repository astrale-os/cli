import type { Node } from '@astrale-os/sdk/graph/node'

import { Path } from '@astrale-os/sdk/graph/path'
import { patterns } from '@astrale-os/sdk/schema'
import { acceptVersion, parseReference, type Reference } from '@astrale-os/sdk/versioning'

import type {
  PublicationDependencyV1,
  PublicationSummaryV1,
  PublishRequestV1,
  PublishRetentionV1,
  RegistryDigest,
} from './model'

import { AstraleError } from '../../errors'
import { AdminContract } from '../contract'
import { RegistryError } from './model'

/**
 * Strict local decoders for what Admin answers (the Admin registry graph and Methods, CT26/CT27)
 * and for the publish request a caller writes. Every field this module reads is checked; fields
 * Admin adds later are ignored, so an additive Admin release never breaks a published CLI.
 */

/** One Publication Node, with the Node id its Methods are addressed by. */
export interface ObservedPublication {
  readonly node: string
  readonly summary: PublicationSummaryV1
}

/** A deployment URL reference, which `parseReference` reads before any `<origin>@` split. */
const URL_SCHEME = /^https?:\/\//u
const DIGEST = /^sha256:[0-9a-f]{64}$/u
const COMMIT = /^[0-9a-f]{40}$/u
const COMMIT_INPUT = /^[0-9A-Fa-f]{40}$/u
const MAXIMUM_DEPENDENCIES = 32
const RETENTIONS: ReadonlySet<unknown> = new Set(['marked', 'failed', 'not-applicable'])

/** A Publication Node value read from Admin's graph. */
export function observedPublication(node: Node): ObservedPublication {
  const keys = AdminContract.properties.publication
  const props = node.props as Readonly<Record<string, unknown>>
  return Object.freeze({
    node: String(node.id),
    summary: summary({
      version: props[keys.version],
      url: props[keys.deploymentUrl],
      releaseDigest: props[keys.releaseDigest],
      buildDigest: props[keys.buildDigest],
      schemaRevision: props[keys.schemaRevision],
      dependencies: props[keys.dependencies],
      commit: props[keys.commit],
      dirty: props[keys.dirty],
      yankedAt: props[keys.yankedAt],
      createdAt: props[keys.createdAt],
    }),
  })
}

/** A `PublicationSummary` as Admin's Methods and `PUBLICATION_VERSION_CONFLICT` return it. */
export function publicationFromAdmin(input: unknown): ObservedPublication {
  const value = record(input, 'Admin Publication')
  const id = string(value.id, 'Admin Publication id')
  let node: string
  try {
    const path = Path.parse(id)
    if (!path.raw.startsWith('@')) throw new TypeError('not a Node id')
    node = path.raw.slice(1)
  } catch {
    throw invalid('Admin Publication id')
  }
  return Object.freeze({
    node,
    summary: summary({
      version: value.version,
      url: value.deploymentUrl,
      releaseDigest: value.releaseDigest,
      buildDigest: value.buildDigest,
      schemaRevision: value.schemaRevision,
      dependencies: value.dependencies,
      commit: value.commit,
      dirty: value.dirty,
      yankedAt: value.yankedAt,
      createdAt: value.createdAt,
    }),
  })
}

/** The published-and-verified state Admin answers `publish` with. */
export function publishedFromAdmin(input: unknown): {
  readonly publication: ObservedPublication
  readonly created: boolean
  readonly retention: PublishRetentionV1
} {
  const value = record(input, 'Admin publish result')
  if (typeof value.created !== 'boolean') throw invalid('Admin publish result created flag')
  if (!RETENTIONS.has(value.retention)) throw invalid('Admin publish result retention')
  return Object.freeze({
    publication: publicationFromAdmin(value.publication),
    created: value.created,
    retention: value.retention as PublishRetentionV1,
  })
}

/** Admit the publish request a caller writes on stdin (CT29 `PublishRequestV1`). */
export function publishRequest(input: unknown): PublishRequestV1 {
  const value = requestRecord(input, 'Publish request')
  exactKeys(value, ['format', 'version', 'publication'], 'Publish request')
  if (value.format !== 'astrale.registry-publish-request' || value.version !== 1) {
    throw requestInvalid('Publish request is not an astrale.registry-publish-request version 1.')
  }
  const publication = requestRecord(value.publication, 'Publish request publication')
  exactKeys(
    publication,
    ['origin', 'version', 'url', 'releaseDigest', 'commit', 'dirty'],
    'Publish request publication',
    ['commit'],
  )
  const origin = requestString(publication.origin, 'publication.origin', 253)
  if (!patterns.origin.test(origin))
    throw requestInvalid('publication.origin is not a Domain origin.')
  const version = publicationVersion(publication.version)
  const url = requestString(publication.url, 'publication.url', 2_048)
  if (typeof publication.releaseDigest !== 'string' || !DIGEST.test(publication.releaseDigest)) {
    throw requestInvalid('publication.releaseDigest must be a sha256: digest of 64 lower-case hex.')
  }
  if (
    publication.commit !== undefined &&
    (typeof publication.commit !== 'string' || !COMMIT_INPUT.test(publication.commit))
  ) {
    throw requestInvalid('publication.commit must be a full 40-hex commit.')
  }
  if (typeof publication.dirty !== 'boolean') {
    throw requestInvalid('publication.dirty must be a boolean.')
  }
  return Object.freeze({
    format: 'astrale.registry-publish-request',
    version: 1,
    publication: Object.freeze({
      origin,
      version,
      url,
      releaseDigest: publication.releaseDigest as RegistryDigest,
      ...(publication.commit === undefined ? {} : { commit: publication.commit as string }),
      dirty: publication.dirty,
    }),
  })
}

/**
 * Read `<origin>@<version>` as one exact version reference, with the parser installs use
 * (`parseReference` of `@astrale-os/sdk/versioning`). A line (`@1.5`), a range or a URL names no
 * single Publication. The part before the first `@` is checked as an origin first, as
 * `registryOrigin` checks it, so a malformed origin is told apart from a malformed version.
 */
export function exactPublicationReference(input: string): {
  readonly origin: string
  readonly version: string
} {
  const at = input.indexOf('@')
  if (at !== -1 && !URL_SCHEME.test(input)) registryOrigin(input.slice(0, at))
  let reference: Reference
  try {
    reference = parseReference(input)
  } catch {
    reference = { kind: 'url', url: input }
  }
  if (reference.kind !== 'exact') {
    throw new RegistryError(
      'PUBLICATION_VERSION_INVALID',
      `${JSON.stringify(input)} names no exact version; write <origin>@<major>.<minor>.<patch>[-<pre>].`,
      { reference: input },
    )
  }
  return Object.freeze({ origin: reference.origin, version: reference.version })
}

/** A Domain origin as the Kernel admits it (`patterns.origin`): a lower-case DNS name. */
export function registryOrigin(input: string): string {
  if (!patterns.origin.test(input)) {
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `${JSON.stringify(input)} is not a Domain origin.`,
      'Name the Domain by its origin, for example issues.astrale.ai.',
    )
  }
  return input
}

/** One canonical SemVer 2.0.0 version, as `@astrale-os/sdk/versioning` admits it. */
export function publicationVersion(input: unknown, reference?: string): string {
  try {
    return acceptVersion(input)
  } catch {
    throw new RegistryError(
      'PUBLICATION_VERSION_INVALID',
      `${JSON.stringify(input)} is not a SemVer 2.0.0 version without a leading v or build metadata.`,
      reference === undefined ? { version: input } : { reference },
    )
  }
}

function summary(input: {
  readonly version: unknown
  readonly url: unknown
  readonly releaseDigest: unknown
  readonly buildDigest: unknown
  readonly schemaRevision: unknown
  readonly dependencies: unknown
  readonly commit: unknown
  readonly dirty: unknown
  readonly yankedAt: unknown
  readonly createdAt: unknown
}): PublicationSummaryV1 {
  let version: string
  try {
    version = acceptVersion(input.version)
  } catch {
    throw invalid('Admin Publication version')
  }
  if (
    input.commit !== undefined &&
    (typeof input.commit !== 'string' || !COMMIT.test(input.commit))
  )
    throw invalid('Admin Publication commit')
  if (input.dirty !== undefined && input.dirty !== true)
    throw invalid('Admin Publication dirty flag')
  if (input.yankedAt !== undefined) string(input.yankedAt, 'Admin Publication yank time')
  return Object.freeze({
    version,
    url: string(input.url, 'Admin Publication deployment URL'),
    releaseDigest: digest(input.releaseDigest, 'Admin Publication release digest'),
    buildDigest: digest(input.buildDigest, 'Admin Publication build digest'),
    schemaRevision: string(input.schemaRevision, 'Admin Publication schema revision'),
    dependencies: dependencies(input.dependencies),
    ...(input.commit === undefined ? {} : { commit: input.commit as string }),
    dirty: input.dirty === true,
    yanked: input.yankedAt !== undefined,
    publishedAt: string(input.createdAt, 'Admin Publication creation time'),
  })
}

function dependencies(input: unknown): readonly PublicationDependencyV1[] {
  if (!Array.isArray(input) || input.length > MAXIMUM_DEPENDENCIES)
    throw invalid('Admin Publication dependencies')
  return Object.freeze(
    input.map((entry) => {
      const value = record(entry, 'Admin Publication dependency')
      return Object.freeze({
        origin: string(value.origin, 'Admin Publication dependency origin'),
        revision: string(value.revision, 'Admin Publication dependency revision'),
      })
    }),
  )
}

function digest(input: unknown, label: string): RegistryDigest {
  if (typeof input !== 'string' || !DIGEST.test(input)) throw invalid(label)
  return input as RegistryDigest
}

function string(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0) throw invalid(label)
  return input
}

function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid(label)
  return input as Readonly<Record<string, unknown>>
}

/** Admin answered something this CLI cannot read: the registry gave no usable answer. */
function invalid(label: string): RegistryError {
  return new RegistryError('REGISTRY_UNAVAILABLE', `${label} is invalid.`, {
    reason: 'response-invalid',
  })
}

function requestRecord(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw requestInvalid(`${label} must be a JSON object.`)
  return input as Readonly<Record<string, unknown>>
}

function requestString(input: unknown, label: string, maximum: number): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > maximum)
    throw requestInvalid(`${label} must be a non-empty string of at most ${maximum} characters.`)
  return input
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0)
    throw requestInvalid(`${label} has unknown fields: ${unknown.sort().join(', ')}.`)
  const missing = allowed.filter((key) => !optional.includes(key) && !(key in value))
  if (missing.length > 0) throw requestInvalid(`${label} misses: ${missing.join(', ')}.`)
}

/** A malformed request is the caller's input error, not a registry refusal. */
function requestInvalid(message: string): AstraleError {
  return new AstraleError('INVALID_INPUT', message)
}
