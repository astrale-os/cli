import type { InstalledPin } from '@astrale-os/sdk/client/schema'

import {
  acceptVersion,
  parseReference,
  resolveVersion,
  type PublishedVersion,
  type Reference,
} from '@astrale-os/sdk/versioning'

import type { AdminRegistryApi, PublicationSummaryV1 } from '../../admin/registry'

import { RegistryError } from '../../admin/registry'
import { AstraleError } from '../../errors'

/**
 * Résolution [.77742]: the CLI translates a version into a release once, at install. A version
 * reference names a Domain's published version, `<origin>@<major>.<minor>.<patch>[-<pre>]` or
 * `<origin>@<major>.<minor>`; it is read in the Admin registry with the caller's own credential and
 * becomes the deployment URL and the release the Kernel must find there. The Kernel never sees the
 * version (invariant [.68398]).
 */

/** A reference the registry resolves: an exact version or a minor line of one origin. */
export type VersionSelector = Exclude<Reference, { readonly kind: 'url' }>

/** One version reference as the operator wrote it. */
export interface VersionReference {
  readonly reference: string
  readonly selector: VersionSelector
}

/** The Publication one version reference resolved to (CT24 `version`, `yanked`). */
export interface ResolvedVersion {
  readonly reference: string
  readonly origin: string
  readonly version: string
  /** Only an exact reference ever resolves to a yanked version ([.79339]). */
  readonly yanked: boolean
  /** The Publication's deployment URL, as Admin wrote it. */
  readonly url: string
  /** The release the Kernel must find at `url`: the Publication's release and build digests. */
  readonly pin: Extract<InstalledPin, { readonly kind: 'release' }>
}

export type VersionUnresolvedReason = 'unknown-version' | 'no-stable-match' | 'yanked-only'

/**
 * Whether a reference names a version rather than a deployment ([.78896], the syntax decides):
 * `<origin>@<version>` has no scheme and an `@`, which no Domain origin holds. A deployment URL
 * starts with `https://` or `http://` (AM-58); anything else is a Fleet catalog origin.
 */
export function isVersionReference(reference: string): boolean {
  return (
    !reference.startsWith('https://') && !reference.startsWith('http://') && reference.includes('@')
  )
}

/**
 * Admit one version reference with the parser installs share (`parseReference`): an exact version
 * or a minor line, never a major (`@1`), a range or build metadata. Throws
 * PUBLICATION_VERSION_INVALID, the registry's code for a version it does not admit.
 */
export function admitVersionReference(reference: string): VersionReference {
  let parsed: Reference
  try {
    parsed = parseReference(reference)
  } catch (cause) {
    throw versionInvalid(reference, cause)
  }
  if (parsed.kind === 'url') throw versionInvalid(reference)
  return Object.freeze({ reference, selector: parsed })
}

/**
 * Translate every version reference with one index read per origin (Résolution [.78020]): an exact
 * reference names any published version, a pre-release or a yanked one included; a line names its
 * highest stable version that is not yanked ([.78086]). The first reference that resolves to
 * nothing is refused with VERSION_UNRESOLVED; a registry refusal (an unreadable Domain reads as an
 * absent one, [.79495]) passes through. Nothing is installed before every reference resolved.
 */
export async function resolveVersionReferences(
  references: readonly VersionReference[],
  registry: Pick<AdminRegistryApi, 'index'>,
): Promise<readonly ResolvedVersion[]> {
  refuseRepeatedOrigins(references)
  const indexes = await Promise.all(
    references.map((reference) => registry.index(reference.selector.origin)),
  )
  return Object.freeze(
    references.map((reference, index) => {
      const { publications } = indexes[index]!
      const published = publishedVersions(publications)
      let resolved: ReturnType<typeof resolveVersion>
      try {
        resolved = resolveVersion(published, reference.selector)
      } catch (cause) {
        // AM-56: a reference the module refuses is a refused reference, never a guess.
        throw versionInvalid(reference.reference, cause)
      }
      if (resolved.kind === 'unresolved') {
        throw new VersionUnresolvedError(reference, resolved.reason)
      }
      return resolvedVersion(reference, publications, published, resolved)
    }),
  )
}

/**
 * The exact reference that names `resolved` again: a retry of the same operation pins the version
 * the first run resolved, never the line it was asked for.
 */
export function exactReference(resolved: ResolvedVersion): string {
  return `${resolved.origin}@${resolved.version}`
}

/** A version reference that names no published version readable by the caller (CT24). */
export class VersionUnresolvedError extends AstraleError {
  constructor(reference: VersionReference, reason: VersionUnresolvedReason) {
    const { origin } = reference.selector
    super(
      'VERSION_UNRESOLVED',
      reference.selector.kind === 'exact'
        ? `${origin} has no published version ${reference.selector.version} readable by this caller.`
        : reason === 'yanked-only'
          ? `Every published ${reference.selector.line}.x version of ${origin} is yanked; a yanked version is installed only by its exact version.`
          : `${origin} has no published stable ${reference.selector.line}.x version readable by this caller; a pre-release is installed only by its exact version.`,
      `Run \`astrale domain versions ${origin}\` to see the versions you can install.`,
    )
    this.details = Object.freeze({ origin, reference: reference.reference, reason })
  }
}

/**
 * The Publication a reference resolved to, as the install will name it again. Its deployment URL
 * and its exact version are rebuilt from Admin data into references (the URL the Kernel installs,
 * the exact version a retry names): each must read back through `parseReference` and resolve to
 * this same Publication, else the reference is refused, never installed from a guess (AM-56).
 */
function resolvedVersion(
  reference: VersionReference,
  publications: readonly PublicationSummaryV1[],
  published: readonly PublishedVersion[],
  resolved: { readonly version: string; readonly yanked: boolean },
): ResolvedVersion {
  const { origin } = reference.selector
  const publication = publications.find((entry) => entry.version === resolved.version)
  const url = rebuilt(publication?.url)
  const exact = rebuilt(publication === undefined ? undefined : `${origin}@${publication.version}`)
  let again: ReturnType<typeof resolveVersion> | undefined
  try {
    again = exact?.kind === 'exact' ? resolveVersion(published, exact) : undefined
  } catch {
    again = undefined
  }
  if (
    publication === undefined ||
    url?.kind !== 'url' ||
    exact?.kind !== 'exact' ||
    exact.origin !== origin ||
    again?.kind !== 'resolved' ||
    again.version !== resolved.version ||
    again.yanked !== resolved.yanked
  ) {
    throw new RegistryError(
      'REGISTRY_UNAVAILABLE',
      `Admin answered a Publication of ${origin} that names no installable deployment; nothing was installed.`,
      {
        reason: 'response-invalid',
        reference: reference.reference,
        version: resolved.version,
      },
    )
  }
  return Object.freeze({
    reference: reference.reference,
    origin,
    version: publication.version,
    yanked: resolved.yanked,
    url: publication.url,
    pin: Object.freeze({
      kind: 'release' as const,
      release: publication.releaseDigest,
      build: publication.buildDigest,
    }),
  })
}

/** The index as the resolution module reads it; the registry decoder admitted every version. */
function publishedVersions(
  publications: readonly PublicationSummaryV1[],
): readonly PublishedVersion[] {
  return publications.map(({ version, yanked }) =>
    Object.freeze({ version: acceptVersion(version), yanked }),
  )
}

function rebuilt(input: string | undefined): Reference | undefined {
  if (input === undefined) return undefined
  try {
    return parseReference(input)
  } catch {
    return undefined
  }
}

function refuseRepeatedOrigins(references: readonly VersionReference[]): void {
  const seen = new Map<string, string>()
  for (const reference of references) {
    const { origin } = reference.selector
    const earlier = seen.get(origin)
    if (earlier !== undefined) {
      throw new AstraleError(
        'DUPLICATE_ORIGIN',
        `Origin ${origin} is named by several references: ${earlier}, ${reference.reference}.`,
        'One install pins one release per origin; keep the reference you mean.',
      )
    }
    seen.set(origin, reference.reference)
  }
}

function versionInvalid(reference: string, cause?: unknown): RegistryError {
  return new RegistryError(
    'PUBLICATION_VERSION_INVALID',
    cause instanceof TypeError
      ? cause.message
      : `${JSON.stringify(reference)} is not a version reference: write <origin>@<major>.<minor>.<patch>[-<pre>] or <origin>@<major>.<minor>.`,
    { reference },
    cause === undefined ? undefined : { cause },
  )
}
