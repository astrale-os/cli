import type { Fetch } from '@astrale-os/sdk/client'
import type { SessionAuth } from '@astrale-os/sdk/client/session'

import { credential, type IssuerId } from '@astrale-os/sdk/auth'

import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { remainingCredentialLifetimeSeconds } from '../lib/credential-lifetime'
import { resolveCredential, resolvePersistedIdpSourceIdentity } from './auth'
import { createExchangeCredentialResolver } from './exchange'
import { exchangeCredentialTtlSeconds, invocationCredentialTtlSeconds } from './lifetime'
import { registrationKeyForTarget } from './target'

const DELEGATION_TTL_SECONDS = 60

export interface SourceCredentialResolver {
  /** Stable local identity metadata may select an already-bound persisted exchange credential. */
  cacheIdentity?(): Promise<Readonly<{ issuer: string; subject: string }> | undefined>
  resolve(audience: IssuerId, signal: AbortSignal): Promise<string>
}

/** Resolve source authority; an omitted Session delegation preserves exact current authority. */
export function createConnectionCredential(
  expectedSourceIssuer: IssuerId,
  source: SourceCredentialResolver,
  ttlSeconds = DELEGATION_TTL_SECONDS,
): SessionAuth {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new TypeError('Connection credential ttlSeconds must be a positive safe integer.')
  }
  const resolveSource = source.resolve.bind(source)
  return Object.freeze({
    ttlSeconds,
    async resolve(
      _call: Parameters<SessionAuth['resolve']>[0],
      signal: Parameters<SessionAuth['resolve']>[1],
    ) {
      const resolved = await resolveSource(expectedSourceIssuer, signal)
      const delegatedTtlSeconds = sourceBoundDelegationTtl(resolved, ttlSeconds)
      return Object.freeze({
        credential: resolved,
        ...(delegatedTtlSeconds === undefined
          ? {}
          : { delegate: { ttlSeconds: delegatedTtlSeconds } }),
      })
    },
  })
}

/** Never request a destination carrier that could outlive its current source bearer. */
function sourceBoundDelegationTtl(input: string, requestedTtlSeconds: number): number | undefined {
  try {
    const expiresAt = credential.inspect(input).claims.exp
    if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return undefined
    const remaining = remainingCredentialLifetimeSeconds(expiresAt)
    if (remaining < requestedTtlSeconds) {
      throw new AstraleError(
        'CREDENTIAL_LIFETIME_INSUFFICIENT',
        'The selected credential cannot cover the requested command timeout.',
        `Use a fresh identity session or a shorter --timeout; ${Math.max(0, remaining)} seconds remain but ${requestedTtlSeconds} are required.`,
      )
    }
    return Math.max(1, Math.min(requestedTtlSeconds, remaining))
  } catch (cause) {
    if (cause instanceof AstraleError) throw cause
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
    minimumRemainingSeconds:
      target.domainIssuer === undefined
        ? invocationCredentialTtlSeconds(timeoutMs)
        : exchangeCredentialTtlSeconds(timeoutMs),
  })
  const source: SourceCredentialResolver = {
    async cacheIdentity() {
      return resolvePersistedIdpSourceIdentity(authOptions)
    },
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
  const ttlSeconds = invocationCredentialTtlSeconds(timeoutMs)
  return createConnectionCredential(target.kernelIssuer, effective, ttlSeconds)
}

/** Reject contradictory explicit credential selections before identity or network access. */
export function validateCredentialSelection(options: ConnectionOptions): void {
  if (options.as !== undefined && options.creds !== undefined) {
    throw new AstraleError('INVALID_FLAG', '--as cannot be combined with --creds.')
  }
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
