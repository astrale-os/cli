import type { Fetch } from '@astrale-os/kernel-client'
import type { SessionAuth } from '@astrale-os/kernel-client/session'
import { credential, type IssuerId } from '@astrale-os/sdk/auth'

import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { resolveCredential } from './auth'
import { createExchangeCredentialResolver } from './exchange'
import { registrationKeyForTarget } from './target'

const DELEGATION_TTL_SECONDS = 60

export interface SourceCredentialResolver {
  resolve(audience: IssuerId, signal: AbortSignal): Promise<string>
}

/** Resolve source authority; an omitted Session delegation preserves exact current authority. */
export function createConnectionCredential(
  expectedSourceIssuer: IssuerId,
  source: SourceCredentialResolver,
): SessionAuth {
  const resolveSource = source.resolve.bind(source)
  return Object.freeze({
    ttlSeconds: DELEGATION_TTL_SECONDS,
    async resolve(
      _call: Parameters<SessionAuth['resolve']>[0],
      signal: Parameters<SessionAuth['resolve']>[1],
    ) {
      const resolved = await resolveSource(expectedSourceIssuer, signal)
      const ttlSeconds = sourceBoundDelegationTtl(resolved)
      return Object.freeze({
        credential: resolved,
        ...(ttlSeconds === undefined ? {} : { delegate: { ttlSeconds } }),
      })
    },
  })
}

/** Never request a destination carrier that could outlive its current source bearer. */
function sourceBoundDelegationTtl(input: string): number | undefined {
  try {
    const expiresAt = credential.inspect(input).claims.exp
    if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return undefined
    const remaining = expiresAt - Math.ceil(Date.now() / 1_000) - 1
    return Math.max(1, Math.min(DELEGATION_TTL_SECONDS, remaining))
  } catch {
    // Preserve opaque explicit credentials; the Kernel remains their authority.
    return undefined
  }
}

/** Bind CLI identity state and Core Auth delegation to one Session auth capability. */
export function createCliCredential(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
  fetch: Fetch = globalThis.fetch,
  timeoutMs = 30_000,
): SessionAuth | undefined {
  validateCredentialSelection(options)
  if (options.anonymous === true) return undefined
  const authOptions = Object.freeze({
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.creds === undefined ? {} : { creds: options.creds }),
    ...(target.defaultIdentity === undefined ? {} : { defaultIdentity: target.defaultIdentity }),
  })
  const source: SourceCredentialResolver = {
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
  }
  const effective =
    target.domainIssuer === undefined || options.creds !== undefined
      ? source
      : createExchangeCredentialResolver(
          { ...target, domainIssuer: target.domainIssuer },
          source,
          fetch,
          timeoutMs,
        )
  return createConnectionCredential(target.kernelIssuer, effective)
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
