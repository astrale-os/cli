import type { InstalledPin } from '@astrale-os/sdk/client/schema'
import type { bundle } from '@astrale-os/sdk/schema'

import {
  accept,
  decodeBundle,
  legacy,
  MEDIA_TYPE,
  PATH,
  type DomainRelease,
} from '@astrale-os/sdk/release'

import {
  cancel,
  DomainDocumentStatusError,
  fetchDomainPublication,
  readBounded,
} from './domain-publication'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * What one deployment URL serves, read the way the Kernel reads it at install: its pinned document
 * (a `DomainRelease` v4, or a legacy v2/v3 Publication), the origin and issuer that document
 * declares, and the pin an install of it records.
 */
export interface ServedDeployment {
  readonly origin: string
  readonly issuer: string
  readonly revision: string
  readonly pin: InstalledPin
  /** The admitted `DomainRelease` v4 itself, present exactly when `pin` is a release pin. */
  readonly release?: DomainRelease
}

/**
 * Why a deployment's document could not be read. `retryable` holds only for a 503, the answer of a
 * deployment that is not serving yet; `retryAfterMs` is its `Retry-After` when it sent one.
 */
export class DeploymentReadError extends Error {
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(
    message: string,
    options: {
      readonly status?: number
      readonly retryAfter?: string
      readonly cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DeploymentReadError'
    this.retryable = options.status === 503
    const retryAfterMs = parseRetryAfter(options.retryAfter)
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

/**
 * Read the document one deployment URL serves. `release.json` under the v4 media type is the
 * release; a 404, or a 2xx under another media type, reads the legacy `domain.json`; any other
 * answer fails without falling back, so an unavailable release is never read as a legacy pin. Both
 * documents live at the URL's origin, as the Kernel resolves them.
 */
export async function readServedDeployment(
  url: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<ServedDeployment> {
  const origin = new URL(url).origin
  const releaseUrl = new URL(PATH, origin)
  let response: Response
  try {
    response = await fetchImpl(releaseUrl, {
      redirect: 'error',
      headers: { accept: MEDIA_TYPE },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    throw new DeploymentReadError(`GET ${releaseUrl.href} failed.`, { cause })
  }
  if (response.status === 200 && hasMediaType(response, MEDIA_TYPE)) {
    return served(await acceptRelease(response, releaseUrl))
  }
  const success = response.status >= 200 && response.status <= 299
  if (response.status !== 404 && !success) {
    await cancel(response.body)
    throw new DeploymentReadError(`GET ${releaseUrl.href} → ${response.status}`, {
      status: response.status,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    })
  }
  await cancel(response.body)
  try {
    return servedLegacy(await fetchDomainPublication(origin, signal, fetchImpl))
  } catch (cause) {
    if (cause instanceof DomainDocumentStatusError) {
      throw new DeploymentReadError(cause.message, {
        status: cause.status,
        retryAfter: cause.retryAfter,
        cause,
      })
    }
    throw new DeploymentReadError(
      cause instanceof Error ? cause.message : `GET ${legacy.url(origin)} failed.`,
      { cause },
    )
  }
}

/** Whether two pins name the same pinned document: one meaning per variant. */
export function samePin(left: InstalledPin, right: InstalledPin): boolean {
  if (left.kind === 'release') {
    return right.kind === 'release' && left.release === right.release && left.build === right.build
  }
  return right.kind === 'legacy' && left.document === right.document && left.etag === right.etag
}

async function acceptRelease(response: Response, url: URL): Promise<DomainRelease> {
  const bytes = await readBounded(response, url)
  try {
    return accept(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
  } catch (cause) {
    throw new DeploymentReadError(`GET ${url.href} returned an invalid Domain release.`, {
      cause,
    })
  }
}

function served(release: DomainRelease): ServedDeployment {
  return Object.freeze({
    origin: release.origin,
    issuer: release.identity.issuer,
    revision: release.schema.revision,
    pin: Object.freeze({
      kind: 'release' as const,
      release: release.digest,
      build: release.build.digest,
    }),
    release,
  })
}

/**
 * The most Schema Bundle bytes the CLI reads: the Kernel's production profile admits no larger
 * bundle (`maximumBundleBytes`, astrale-os/kernel `host/kernel/profiles/falkordb/production.ts`).
 */
export const MAXIMUM_BUNDLE_BYTES = 1_000_000

/**
 * Read the Schema Bundle one release names, the way the Kernel reads it at install
 * (astrale-os/kernel `runtime/schema/installation/source/retrieval.ts`): from the bundle `href`
 * the release declares, which must stay on the origin that serves the release, with no redirect,
 * asking for and requiring the descriptor's media type, and reading no more bytes than its
 * descriptor declares nor than the Kernel admits. `decodeBundle` checks the bytes against the
 * descriptor's digest and the release's inventory, so the Bundle is the one the Kernel would
 * accept, its root carrying the exact dependency closure it was built against.
 */
export async function readReleaseBundle(
  release: DomainRelease,
  url: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<bundle.Bundle> {
  const descriptor = release.schema.bundle
  const bundleUrl = new URL(descriptor.href)
  if (bundleUrl.origin !== new URL(url).origin) {
    throw new DeploymentReadError(
      `The release served by ${new URL(url).origin} names its bundle on another origin (${bundleUrl.origin}).`,
    )
  }
  let response: Response
  try {
    response = await fetchImpl(bundleUrl, {
      redirect: 'error',
      headers: { accept: descriptor.ref.mediaType },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    throw new DeploymentReadError(`GET ${bundleUrl.href} failed.`, { cause })
  }
  if (response.status !== 200) {
    await cancel(response.body)
    throw new DeploymentReadError(`GET ${bundleUrl.href} → ${response.status}`, {
      status: response.status,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    })
  }
  if (!hasMediaType(response, descriptor.ref.mediaType)) {
    await cancel(response.body)
    throw new DeploymentReadError(
      `GET ${bundleUrl.href} is not served as ${descriptor.ref.mediaType}, the media type its release names.`,
    )
  }
  let bytes: Uint8Array
  try {
    bytes = await readBounded(
      response,
      bundleUrl,
      Math.min(descriptor.ref.size, MAXIMUM_BUNDLE_BYTES),
    )
  } catch (cause) {
    throw new DeploymentReadError(
      cause instanceof Error ? cause.message : `GET ${bundleUrl.href} failed.`,
      { cause },
    )
  }
  try {
    return decodeBundle(release, bytes)
  } catch (cause) {
    throw new DeploymentReadError(
      `GET ${bundleUrl.href} returned another bundle than the release names.`,
      {
        cause,
      },
    )
  }
}

function servedLegacy(publication: legacy.Publication): ServedDeployment {
  return Object.freeze({
    origin: publication.origin,
    issuer: publication.identity.issuer,
    revision: publication.schema.revision,
    pin: Object.freeze({
      kind: 'legacy' as const,
      document: publication.version,
      etag: publication.etag,
    }),
  })
}

/** The Kernel's media type comparison: parameters kept, case and whitespace ignored. */
function hasMediaType(response: Response, expected: string): boolean {
  const actual = response.headers.get('content-type')
  return actual !== null && normalizeMediaType(actual) === normalizeMediaType(expected)
}

function normalizeMediaType(input: string): string {
  return input
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .join(';')
}

/** `Retry-After` in delta-seconds; an HTTP date or an invalid value is ignored. */
function parseRetryAfter(input: string | undefined): number | undefined {
  if (input === undefined || !/^\d{1,6}$/u.test(input.trim())) return undefined
  return Number(input.trim()) * 1000
}
