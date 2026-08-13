import type { HostAuth } from '@astrale-os/kernel-client/host'
import type { IssuerId } from '@astrale-os/kernel-core/auth'

import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { resolveCredential } from './auth'
import { registrationKeyForTarget } from './target'

const DELEGATION_TTL_SECONDS = 3_600

export interface SourceCredentialResolver {
  resolve(audience: IssuerId, signal: AbortSignal): Promise<string>
}

/** Resolve source authority; Host materializes the default self Delegate before route lookup. */
export function createConnectionCredential(
  expectedSourceIssuer: IssuerId,
  source: SourceCredentialResolver,
): HostAuth {
  const resolveSource = source.resolve.bind(source)
  return Object.freeze({
    ttlSeconds: DELEGATION_TTL_SECONDS,
    async resolve(
      _call: Parameters<HostAuth['resolve']>[0],
      signal: Parameters<HostAuth['resolve']>[1],
    ) {
      return Object.freeze({ credential: await resolveSource(expectedSourceIssuer, signal) })
    },
  })
}

/** Bind CLI identity state and Core Auth delegation to one Host credential capability. */
export function createCliCredential(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
): HostAuth | undefined {
  validateCredentialSelection(options)
  if (options.anonymous === true) return undefined
  const authOptions = Object.freeze({
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.creds === undefined ? {} : { creds: options.creds }),
    ...(target.defaultIdentity === undefined ? {} : { defaultIdentity: target.defaultIdentity }),
  })
  return createConnectionCredential(target.issuer, {
    async resolve(audience, signal) {
      requireLive(signal)
      const credential = await resolveCredential(
        authOptions,
        config,
        audience,
        registrationKeyForTarget(target),
      )
      requireLive(signal)
      return credential
    },
  })
}

/** Reject contradictory explicit credential selections before identity or network access. */
export function validateCredentialSelection(options: ConnectionOptions): void {
  if (options.anonymous !== true) return
  const conflicting = [
    ...(options.as === undefined ? [] : ['--as']),
    ...(options.creds === undefined ? [] : ['--creds']),
  ]
  if (conflicting.length === 0) return
  throw new AstraleError(
    'INVALID_FLAG',
    `--anonymous cannot be combined with ${conflicting.join(' or ')}.`,
  )
}

function requireLive(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
