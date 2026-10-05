import { accept, url as releaseUrl, type DomainRelease } from '@astrale-os/sdk/release'
import { createHash } from 'node:crypto'

import type { PublicationBundleV1, PublicationSummaryV1 } from './model'

import { AstraleError } from '../../errors'
import { RegistryError } from './model'

/** One GET, as the global `fetch` answers it. */
export type DeploymentFetch = (input: string, init: RequestInit) => Promise<Response>

/** How the bundle plumbing reads what a published deployment serves. */
export interface DeploymentReader {
  readonly fetch: DeploymentFetch
  /** The bound of each GET, its body included. */
  readonly timeoutMs: number
}

/** Admin reads at most this much of a served release when it publishes one. */
const MAXIMUM_RELEASE_BYTES = 2 * 1_024 * 1_024

type Absent = 'release-absent' | 'bundle-absent'

/**
 * The release a Publication names, read where its deployment serves it (`release.json`). Only the
 * release whose digest is the Publication's release digest is admitted: a deployment is
 * immutable, so any other answer is a deployment that no longer serves the published release.
 * The refusals are the ones Admin's `publish` gives for the same answers (CT29).
 */
export async function publishedRelease(
  reader: DeploymentReader,
  publication: PublicationSummaryV1,
): Promise<DomainRelease> {
  let location: string
  try {
    location = releaseUrl(publication.url)
  } catch {
    // Admin admitted this URL when it published the version: the answer is Admin's.
    throw new RegistryError('REGISTRY_UNAVAILABLE', 'Admin Publication URL is invalid.', {
      reason: 'response-invalid',
    })
  }
  const bytes = await get(reader, location, 'release-absent', (body) =>
    readBounded(body, MAXIMUM_RELEASE_BYTES),
  )
  let release: DomainRelease
  try {
    if (bytes === undefined) throw new RangeError('release too large')
    release = accept(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    throw mismatch('The deployment does not serve a Domain release.', {
      reason: 'release-document-invalid',
    })
  }
  if (release.digest !== publication.releaseDigest) {
    throw mismatch('The deployment does not serve the release its Publication names.', {
      expected: publication.releaseDigest,
      served: release.digest,
    })
  }
  return release
}

/**
 * Stream the Schema Bundle a release describes (`schema.bundle.href`) through `write`, then check
 * its byte count and sha256 digest against the descriptor (`schema.bundle.ref`). The caller keeps
 * what was written only when this resolves.
 */
export async function readPublishedBundle(
  reader: DeploymentReader,
  release: DomainRelease,
  write: (chunk: Uint8Array) => Promise<void>,
): Promise<PublicationBundleV1> {
  const { href, ref } = release.schema.bundle
  // The digest Admin verified pins this descriptor, which Admin bounded when it published.
  const expected = Object.freeze({ digest: ref.digest, mediaType: ref.mediaType, size: ref.size })
  const served = await get(reader, href, 'bundle-absent', async (body) => {
    const hash = createHash('sha256')
    let size = 0
    if (body === null) return { digest: `sha256:${hash.digest('hex')}`, size }
    const chunks = body.getReader()
    try {
      for (;;) {
        const next = await chunks.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > expected.size) {
          await chunks.cancel().catch(() => undefined)
          return undefined
        }
        hash.update(next.value)
        await write(next.value)
      }
    } finally {
      chunks.releaseLock()
    }
    return { digest: `sha256:${hash.digest('hex')}`, size }
  })
  if (served === undefined || served.size !== expected.size || served.digest !== expected.digest) {
    throw mismatch('The bundle the deployment serves does not match its release.', {
      reason: 'bundle-mismatch',
      expected: { digest: expected.digest, size: expected.size },
      ...(served === undefined ? { oversized: true } : { served }),
    })
  }
  return expected
}

/**
 * One GET of a published deployment, bounded by `reader.timeoutMs` body included, following no
 * redirect: a deployment serves its release and bundle in place.
 */
async function get<Value>(
  reader: DeploymentReader,
  location: string,
  absent: Absent,
  read: (body: ReadableStream<Uint8Array> | null) => Promise<Value>,
): Promise<Value> {
  const signal = AbortSignal.timeout(reader.timeoutMs)
  try {
    const response = await reader.fetch(location, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw refused(response.status, absent)
    }
    return await read(response.body)
  } catch (error) {
    // A refusal decided here, or the caller's own `write` failure, keeps its meaning.
    if (error instanceof AstraleError) throw error
    throw new RegistryError(
      'PUBLICATION_RELEASE_UNREACHABLE',
      'The deployment did not answer; rerun the same command.',
      { reason: signal.aborted ? 'timeout' : 'network', retryable: true },
      { cause: error },
    )
  }
}

/** A deployment's non-OK answer, read as Admin reads it when it publishes. */
function refused(status: number, absent: Absent): RegistryError {
  if (status === 408 || status === 429 || status >= 500) {
    return new RegistryError(
      'PUBLICATION_RELEASE_UNREACHABLE',
      'The deployment cannot answer now; rerun the same command.',
      { reason: `http-${status}`, retryable: true },
    )
  }
  if (status < 400) {
    return mismatch('The deployment does not serve its release in place.', {
      reason: absent === 'release-absent' ? 'release-document-invalid' : 'bundle-mismatch',
    })
  }
  return new RegistryError(
    'PUBLICATION_RELEASE_UNREACHABLE',
    absent === 'release-absent'
      ? 'The deployment serves no release.'
      : 'The deployment serves no bundle for its release.',
    { reason: absent },
  )
}

function mismatch(message: string, details: Readonly<Record<string, unknown>>): RegistryError {
  return new RegistryError('PUBLICATION_RELEASE_MISMATCH', message, details)
}

/** The whole body, or undefined once it exceeds `maximum` bytes. */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
): Promise<Uint8Array | undefined> {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
