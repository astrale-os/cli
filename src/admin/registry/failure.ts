import { ResponseError, TransportError } from '@astrale-os/sdk/client'

import { AstraleError } from '../../errors'
import { publicationFromAdmin } from './decode'
import { RegistryError } from './model'

/** The RELEASE_INVALID reasons that say Admin found nothing to read at the deployment. */
const UNREACHABLE_REASONS = new Set(['release-absent', 'bundle-absent'])

/**
 * Translate one failure of a registry read or change into the CT29 vocabulary. Admin's declared
 * refusals (CT27, as A4/A5 ship them) keep their details; Kernel protocol refusals keep their
 * numeric code in `details.status`. CLI errors (target, credential, input) pass through unchanged.
 */
export function registryFailure(error: unknown, action: 'read' | 'change'): AstraleError {
  if (error instanceof AstraleError) return error
  if (error instanceof TransportError) {
    const delivery = transportDelivery(error)
    return new RegistryError(
      'REGISTRY_UNAVAILABLE',
      action === 'change' && delivery === 'unknown'
        ? 'Admin did not answer; the change may have applied. Rerun the same command: it is idempotent.'
        : 'Admin did not answer.',
      { reason: 'transport', phase: error.phase, ...(delivery === undefined ? {} : { delivery }) },
      { cause: error },
    )
  }
  if (error instanceof ResponseError) return responseFailure(error, action)
  return new RegistryError(
    'REGISTRY_UNAVAILABLE',
    error instanceof TypeError
      ? `Admin answered something this CLI cannot read: ${error.message}`
      : 'The registry call failed before Admin answered.',
    { reason: error instanceof TypeError ? 'response-invalid' : 'client' },
    { cause: error },
  )
}

function responseFailure(error: ResponseError, action: 'read' | 'change'): RegistryError {
  const code = error.reason?.code
  const details = (error.reason?.details ?? {}) as Readonly<Record<string, unknown>>
  const options = { cause: error }
  switch (code) {
    case 'PUBLICATION_VERSION_CONFLICT': {
      let existing
      try {
        existing = publicationFromAdmin(details.existing).summary
      } catch {
        return unavailable(error, 'response-invalid')
      }
      return new RegistryError(
        'PUBLICATION_VERSION_CONFLICT',
        `Version ${existing.version} already names release ${existing.releaseDigest}; publish a higher version.`,
        { existing },
        options,
      )
    }
    case 'RELEASE_DIGEST_MISMATCH':
      return new RegistryError(
        'PUBLICATION_RELEASE_MISMATCH',
        'The deployment does not serve the release digest the request names.',
        pick(details, ['expected', 'served']),
        options,
      )
    case 'RELEASE_INVALID': {
      const reason = typeof details.reason === 'string' ? details.reason : undefined
      return UNREACHABLE_REASONS.has(reason ?? '')
        ? new RegistryError(
            'PUBLICATION_RELEASE_UNREACHABLE',
            'Admin found no release to read at the deployment URL.',
            { reason },
            options,
          )
        : new RegistryError(
            'PUBLICATION_RELEASE_MISMATCH',
            'The deployment does not serve a release this Domain can publish.',
            reason === undefined ? {} : { reason },
            options,
          )
    }
    case 'VERSION_INVALID':
      return new RegistryError(
        'PUBLICATION_VERSION_INVALID',
        'Admin refused the version: SemVer 2.0.0 without a leading v or build metadata.',
        pick(details, ['version']),
        options,
      )
    case 'RELEASE_UNAVAILABLE':
      return new RegistryError(
        'PUBLICATION_RELEASE_UNREACHABLE',
        'Admin could not read the deployment now; rerun the same command.',
        { retryable: true, ...pick(details, ['reason']) },
        options,
      )
    case 'REGISTERED_DOMAIN_CONFLICT':
      // A concurrent change or a refused commit that left nothing behind: a rerun is safe.
      return new RegistryError(
        'REGISTRY_UNAVAILABLE',
        'Admin could not complete the change now; rerun the same command.',
        { retryable: true, ...pick(details, ['reason']) },
        options,
      )
    default:
      break
  }
  if (error.code >= 2001 && error.code <= 2004) {
    return new RegistryError(
      'REGISTRY_FORBIDDEN',
      error.code !== 2004
        ? 'Admin refused the credential.'
        : action === 'change'
          ? 'Admin refused this caller: the change needs domain_admin on the Domain.'
          : 'Admin refused this caller the read.',
      { status: error.code },
      options,
    )
  }
  if (error.code === 3002) {
    return new RegistryError(
      'REGISTRY_DOMAIN_NOT_FOUND',
      'Admin knows no such Registered Domain or Publication for this caller.',
      { status: error.code },
      options,
    )
  }
  return unavailable(error)
}

function unavailable(error: ResponseError, reason?: string): RegistryError {
  return new RegistryError(
    'REGISTRY_UNAVAILABLE',
    `Admin did not give a usable answer (${error.code}).`,
    {
      status: error.code,
      ...(reason !== undefined
        ? { reason }
        : error.reason === undefined
          ? {}
          : { reason: error.reason.code }),
    },
    { cause: error },
  )
}

function transportDelivery(error: TransportError): 'not-sent' | 'unknown' | undefined {
  const context = (error as { readonly context?: { readonly delivery?: unknown } }).context
  const delivery = context?.delivery
  return delivery === 'not-sent' || delivery === 'unknown' ? delivery : undefined
}

function pick(
  details: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(keys.filter((key) => key in details).map((key) => [key, details[key]]))
}
