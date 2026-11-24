import type { InstalledPin } from '@astrale-os/sdk/client/schema'
import type { bundle } from '@astrale-os/sdk/schema'

import {
  accept,
  COMPACT_BUNDLE_MEDIA_TYPE,
  compactBundleHint,
  decodeBundle,
  decodeCompactBundle,
  isCompactBundleRepresentationError,
  MEDIA_TYPE,
  PATH,
  url as releaseDocumentUrl,
  type ArtifactRef,
  type CompactBundleHint,
  type DomainRelease,
} from '@astrale-os/sdk/release'
import { defaultLimits } from '@astrale-os/sdk/value'

import { cancel, DocumentSizeError, hasMediaType, readBounded } from './document'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * What one deployment URL serves, read the way the Kernel reads it at install: its pinned document
 * (a `DomainRelease` v4), the origin and issuer that document
 * declares, and the pin an install of it records.
 */
export interface ServedDeployment {
  readonly origin: string
  readonly issuer: string
  readonly revision: string
  readonly pin: Extract<InstalledPin, { readonly kind: 'release' }>
  /** The admitted `DomainRelease` v4 itself, present exactly when `pin` is a release pin. */
  readonly release: DomainRelease
  /** Alternate advertisement observed on the exact issuer's pinned Release response. */
  readonly bundleLink?: string
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

/** Read the canonical release document at the deployment origin, without redirects or fallback. */
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
    const release = await acceptRelease(response, releaseUrl)
    const link = response.headers.get('link')
    const etag = response.headers.get('etag')
    const exact =
      (etag === null || etag === `"${release.digest}"`) &&
      !response.redirected &&
      response.url === releaseUrl.href &&
      releaseDocumentUrl(release.identity.issuer) === releaseUrl.href
    return served(release, exact ? link : null)
  }
  await cancel(response.body)
  if (response.status !== 200) {
    throw new DeploymentReadError(`GET ${releaseUrl.href} → ${response.status}`, {
      status: response.status,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    })
  }
  throw new DeploymentReadError(`GET ${releaseUrl.href} is not served as ${MEDIA_TYPE}.`)
}

/** Whether two pins name the same pinned document: one meaning per variant. */
export function samePin(left: InstalledPin, right: InstalledPin): boolean {
  if (left.kind === 'release' && right.kind === 'release') {
    return left.release === right.release && left.build === right.build
  }
  return left.kind === 'artifact' && right.kind === 'artifact' && left.artifact === right.artifact
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

function served(release: DomainRelease, link: string | null): ServedDeployment {
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
    ...(link === null ? {} : { bundleLink: link }),
  })
}

/** Maximum physical Bundle size admitted by the production Host. */
export const MAXIMUM_BUNDLE_BYTES = 1_000_000

/** Read and verify the Bundle of the exact discovered Release for the install precheck. */
export async function readReleaseBundle(
  release: DomainRelease,
  url: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
  bundleLink?: string,
): Promise<bundle.Bundle> {
  const descriptor = release.schema.bundle
  const bundleUrl = new URL(descriptor.href)
  if (bundleUrl.origin !== new URL(url).origin) {
    throw new DeploymentReadError(
      `The release served by ${new URL(url).origin} names its bundle on another origin (${bundleUrl.origin}).`,
    )
  }
  if (descriptor.ref.size > defaultLimits.maxBytes) {
    throw new DeploymentReadError(
      `Bundle exceeded the decoded limit of ${defaultLimits.maxBytes} bytes.`,
    )
  }
  const hint = compactBundleHint(release.identity.issuer, descriptor.href, bundleLink)
  if (hint !== undefined && new URL(hint.href).origin === bundleUrl.origin) {
    try {
      return await readCompact(release, hint, fetchImpl, signal)
    } catch (cause) {
      const unusable =
        cause instanceof UnusableAlternate || isCompactBundleRepresentationError(cause)
      if (!unusable || descriptor.ref.size > MAXIMUM_BUNDLE_BYTES) {
        if (cause instanceof DeploymentReadError) throw cause
        throw new DeploymentReadError(`GET ${hint.href} failed to verify the compact Bundle.`, {
          cause,
        })
      }
    }
  }
  if (descriptor.ref.size > MAXIMUM_BUNDLE_BYTES) {
    throw new DeploymentReadError(`GET ${bundleUrl.href} exceeded ${MAXIMUM_BUNDLE_BYTES} bytes`)
  }
  const bytes = await artifactBytes(
    bundleUrl,
    descriptor.ref,
    descriptor.ref.size,
    fetchImpl,
    signal,
  )
  try {
    return decodeBundle(release, bytes)
  } catch (cause) {
    throw new DeploymentReadError(
      `GET ${bundleUrl.href} returned another bundle than the release names.`,
      { cause },
    )
  }
}

class UnusableAlternate extends DeploymentReadError {}

async function readCompact(
  release: DomainRelease,
  hint: CompactBundleHint,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<bundle.Bundle> {
  const mediaType = COMPACT_BUNDLE_MEDIA_TYPE
  const bytes = await artifactBytes(
    new URL(hint.href),
    { mediaType, digest: hint.digest },
    MAXIMUM_BUNDLE_BYTES,
    fetchImpl,
    signal,
  )
  return decodeCompactBundle(
    release,
    { mediaType, digest: hint.digest, size: bytes.byteLength },
    bytes,
  )
}

/** Fetch a single bounded representation. Only representation failures permit a v1 retry. */
async function artifactBytes(
  url: URL,
  ref: Pick<ArtifactRef, 'mediaType' | 'digest'>,
  maximum: number,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const compact = ref.mediaType === COMPACT_BUNDLE_MEDIA_TYPE
  const invalid = compact ? UnusableAlternate : DeploymentReadError
  let response: Response
  try {
    response = await fetchImpl(url, {
      redirect: 'error',
      headers: { accept: ref.mediaType },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    throw new DeploymentReadError(`GET ${url.href} failed.`, { cause })
  }
  if (response.redirected || ((compact || response.url !== '') && response.url !== url.href)) {
    await cancel(response.body)
    throw new DeploymentReadError(`GET ${url.href} did not return the exact requested URL.`)
  }
  if (response.status !== 200) {
    await cancel(response.body)
    const failure =
      response.status === 404 || response.status === 410 ? invalid : DeploymentReadError
    throw new failure(`GET ${url.href} → ${response.status}`, {
      status: response.status,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    })
  }
  if (!hasMediaType(response, ref.mediaType)) {
    await cancel(response.body)
    throw new invalid(
      `GET ${url.href} is not served as ${ref.mediaType}, the media type its release names.`,
    )
  }
  const etag = response.headers.get('etag')
  const encoding = response.headers.get('content-encoding')
  if (
    compact &&
    ((etag !== null && etag !== `"${ref.digest}"`) ||
      (encoding !== null && encoding.toLowerCase() !== 'identity'))
  ) {
    await cancel(response.body)
    throw new invalid(`GET ${url.href} returned incompatible Bundle headers.`)
  }
  try {
    const bytes = await readBounded(response, url, maximum)
    const length = response.headers.get('content-length')
    if (compact && length !== null && Number(length) !== bytes.byteLength) {
      throw new UnusableAlternate(`GET ${url.href} returned a different length than advertised.`)
    }
    return bytes
  } catch (cause) {
    if (cause instanceof DocumentSizeError) throw new invalid(cause.message, { cause })
    if (cause instanceof DeploymentReadError) throw cause
    throw new DeploymentReadError(`GET ${url.href} failed.`, { cause })
  }
}

/** `Retry-After` in delta-seconds; an HTTP date or an invalid value is ignored. */
function parseRetryAfter(input: string | undefined): number | undefined {
  if (input === undefined || !/^\d{1,6}$/u.test(input.trim())) return undefined
  return Number(input.trim()) * 1000
}
