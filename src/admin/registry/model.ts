import { AstraleError } from '../../errors'

/**
 * Wire contracts of the Domain version registry plumbing (CT29). `astrale domain versions --json`
 * prints a `RegistryIndexV1`; the hidden `astrale __domain-registry` commands print the other
 * documents. Each document names its `format` and `version`, so a reader refuses anything else.
 */

/** A `sha256:` digest as Admin stores it. */
export type RegistryDigest = `sha256:${string}`

/**
 * A published release's Schema Bundle, as the release its deployment serves describes it
 * (`release.json` `schema.bundle.ref`). Admin keeps no copy.
 */
export interface PublicationBundleV1 {
  readonly digest: RegistryDigest
  readonly mediaType: string
  readonly size: number
}

/** One direct dependency of the published release's Schema, as its bundle pins it. */
export interface PublicationDependencyV1 {
  readonly origin: string
  readonly revision: string
}

/** One published version: the immutable name Admin gives one release of a Domain. */
export interface PublicationSummaryV1 {
  readonly version: string
  /** The deployment's URL, which is also the release's issuer. */
  readonly url: string
  readonly releaseDigest: RegistryDigest
  readonly buildDigest: RegistryDigest
  readonly schemaRevision: string
  readonly dependencies: readonly PublicationDependencyV1[]
  /** The 40-hex commit the release was built from, lower case, when the publisher recorded it. */
  readonly commit?: string
  readonly dirty: boolean
  /** A yanked version is never chosen by a line reference; it still names the same release. */
  readonly yanked: boolean
  readonly publishedAt: string
}

/** Every Publication of one Domain the caller may read, pre-releases and yanked ones included. */
export interface RegistryIndexV1 {
  readonly format: 'astrale.registry-index'
  readonly version: 1
  readonly origin: string
  /** SemVer precedence, highest first. */
  readonly publications: readonly PublicationSummaryV1[]
}

/**
 * The bundle of one Publication, read from its deployment and written to a local file after its
 * digest and size matched the descriptor of the release the Publication names.
 */
export interface RegistryBundleV1 {
  readonly format: 'astrale.registry-bundle'
  readonly version: 1
  readonly publication: { readonly origin: string; readonly version: string }
  readonly bundle: PublicationBundleV1
}

/** What `__domain-registry publish` reads on stdin. */
export interface PublishRequestV1 {
  readonly format: 'astrale.registry-publish-request'
  readonly version: 1
  readonly publication: {
    readonly origin: string
    readonly version: string
    readonly url: string
    readonly releaseDigest: RegistryDigest
    readonly commit?: string
    readonly dirty: boolean
  }
}

/**
 * Whether Admin's Services marked the published deployment retained: `marked`, `failed` (the
 * Publication stands; rerunning the same publish marks again) or `not-applicable` (a deployment
 * Admin's Services do not host).
 */
export type PublishRetentionV1 = 'marked' | 'failed' | 'not-applicable'

export interface PublishResultV1 {
  readonly format: 'astrale.registry-publish-result'
  readonly version: 1
  /** `unchanged`: the version already named this release; nothing was written. */
  readonly status: 'created' | 'unchanged'
  readonly publication: PublicationSummaryV1
  /** The retention mark of this run, on a created and an unchanged Publication alike. */
  readonly retention: PublishRetentionV1
}

export interface YankResultV1 {
  readonly format: 'astrale.registry-yank-result'
  readonly version: 1
  /** `unchanged`: the version was already in the requested state. */
  readonly status: 'changed' | 'unchanged'
  readonly publication: PublicationSummaryV1
}

export const REGISTRY_ERROR_CODES = [
  /** No Domain of that origin is readable by the caller: absent or not permitted. */
  'REGISTRY_DOMAIN_NOT_FOUND',
  /** The Domain is readable but the caller holds no version of that number. */
  'PUBLICATION_NOT_FOUND',
  /** Admin refused the caller (no `domain_admin` for a change, or a credential refusal). */
  'REGISTRY_FORBIDDEN',
  /**
   * Admin did not give a usable answer. A rerun of the same command is always safe (reads, and
   * idempotent publish and yank); it can help only when `details.retryable` is true. On a change,
   * `details.delivery === 'unknown'` says the change may have applied.
   */
  'REGISTRY_UNAVAILABLE',
  /** The version already names another release. `details.existing` is that Publication. */
  'PUBLICATION_VERSION_CONFLICT',
  /**
   * The deployment does not serve the named release, serves no publishable release, or serves a
   * bundle that does not match its release.
   */
  'PUBLICATION_RELEASE_MISMATCH',
  /** Admin, or this CLI for `bundle`, could not read the deployment's release or bundle. */
  'PUBLICATION_RELEASE_UNREACHABLE',
  /** Not a canonical SemVer 2.0.0 version, or not one exact version where one is required. */
  'PUBLICATION_VERSION_INVALID',
] as const

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number]

/** One refusal of the registry plumbing, printed as `{ error: { code, message, details? } }`. */
export class RegistryError extends AstraleError {
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: RegistryErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(code, message, undefined, options)
    this.name = 'RegistryError'
    if (details !== undefined) this.details = Object.freeze({ ...details })
  }
}
