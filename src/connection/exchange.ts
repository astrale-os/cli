import type { IssuerId } from '@astrale-os/sdk/auth'
import type { Fetch } from '@astrale-os/sdk/client'

import { createAuth } from '@astrale-os/sdk/auth'
import { credential, exchange as exchangeProtocol, grant } from '@astrale-os/sdk/auth'
import { call, Client } from '@astrale-os/sdk/client'

import type { SourceCredentialResolver } from './credential'
import type { ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { remainingCredentialLifetimeSeconds } from '../lib/credential-lifetime'
import { exchangeCallerProof } from '../lib/exchange-grant'
import { ExchangeCredentialCache } from '../state/exchange-credentials'
import { cachedCredentialTtlSeconds, exchangeCredentialTtlSeconds } from './lifetime'

const MAXIMUM_RESPONSE_BYTES = 256 * 1024

/** Exchange exact authenticated User authority for a Domain bearer bound to this Kernel. */
export function createExchangeCredentialResolver(
  target: ConnectionTarget & { readonly domainIssuer: IssuerId },
  source: SourceCredentialResolver,
  fetch: Fetch,
  timeoutMs: number,
  cache = new ExchangeCredentialCache(),
): SourceCredentialResolver {
  requireExchangeTransport(target)
  const cacheTtlSeconds = cachedCredentialTtlSeconds(timeoutMs)
  const exchangeTtlSeconds = exchangeCredentialTtlSeconds(timeoutMs)
  return Object.freeze({
    async resolve(kernelIssuer: IssuerId, signal: AbortSignal): Promise<string> {
      requireLive(signal)
      const hintedIdentity = await readCacheIdentity(source)
      requireLive(signal)
      if (hintedIdentity !== undefined) {
        const cached = await cache.get(
          Object.freeze({
            kernelIssuer,
            domainIssuer: target.domainIssuer,
            sourceIssuer: hintedIdentity.issuer,
            sourceSubject: hintedIdentity.subject,
          }),
          cacheTtlSeconds,
        )
        requireLive(signal)
        if (cached !== undefined) return cached
      }

      const sourceToken = await source.resolve(kernelIssuer, signal)
      const sourceIdentity = sourceCacheIdentity(sourceToken)
      requireLive(signal)

      return await cache.getOrRefresh(
        Object.freeze({
          kernelIssuer,
          domainIssuer: target.domainIssuer,
          sourceIssuer: sourceIdentity.issuer,
          sourceSubject: sourceIdentity.subject,
        }),
        cacheTtlSeconds,
        async () => {
          const delegationTtlSeconds = delegationLifetime(sourceToken, exchangeTtlSeconds)
          const exchangeEndpoint = discoverExchangeEndpoint(target.domainIssuer, fetch, signal)
          const client = new Client({ url: `${kernelIssuer}/invoke`, fetch, timeoutMs })
          try {
            const delegated = delegate(
              client,
              sourceToken,
              target.domainIssuer,
              delegationTtlSeconds,
              signal,
            )
            const [{ envelope, user }, endpoint] = await Promise.all([delegated, exchangeEndpoint])
            return {
              ...(await exchange(
                endpoint,
                target.domainIssuer,
                kernelIssuer,
                envelope,
                cacheTtlSeconds,
                fetch,
                signal,
              )),
              user,
              sourceIssuer: sourceIdentity.issuer,
              sourceSubject: sourceIdentity.subject,
            }
          } finally {
            client.close()
          }
        },
      )
    },
  })
}

async function delegate(
  client: Client,
  sourceToken: string,
  domainIssuer: IssuerId,
  ttlSeconds: number,
  signal: AbortSignal,
): Promise<{ readonly envelope: string; readonly user: string }> {
  const authenticated = client.as(sourceToken)
  const auth = createAuth(async (path, input, options) => {
    const result = await authenticated.call(call(path, input), {
      ...options,
      delegate: { ttlSeconds },
    })
    return result.value
  })
  const user = await auth.whoami({ signal })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const envelope = await auth.delegate(
        user.id,
        {
          audience: domainIssuer,
          ttlSeconds,
          attenuation: { kind: 'identity', self: true },
        },
        { signal },
      )
      return Object.freeze({ envelope, user: user.id })
    } catch (cause) {
      if (attempt === 2 || !unknownFunctionOutcome(cause)) throw cause
    }
  }
  throw new Error('Token delegation returned no credential.')
}

async function readCacheIdentity(
  source: SourceCredentialResolver,
): Promise<Readonly<{ issuer: string; subject: string }> | undefined> {
  try {
    return await source.cacheIdentity?.()
  } catch {
    return undefined
  }
}

function sourceCacheIdentity(sourceToken: string): { issuer: string; subject: string } {
  const inspected = credential.inspect(sourceToken)
  if (
    typeof inspected.iss !== 'string' ||
    inspected.iss.length === 0 ||
    typeof inspected.sub !== 'string' ||
    inspected.sub.length === 0
  ) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_INVALID',
      'The source identity credential has no stable issuer and subject.',
    )
  }
  return Object.freeze({ issuer: inspected.iss, subject: inspected.sub })
}

function unknownFunctionOutcome(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false
  const error = cause as { readonly code?: unknown; readonly reason?: unknown }
  if (error.code === 5002) return true
  if (error.reason === null || typeof error.reason !== 'object') return false
  return (error.reason as { readonly code?: unknown }).code === 'FUNCTION_OUTCOME_UNKNOWN'
}

function delegationLifetime(sourceToken: string, requiredTtlSeconds: number): number {
  const expiresAt = credential.inspect(sourceToken).claims.exp
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_INVALID',
      'The source identity credential has no valid expiration.',
    )
  }
  const remaining = remainingCredentialLifetimeSeconds(expiresAt)
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_EXPIRED',
      'The source identity credential has no lifetime available for token exchange.',
    )
  }
  if (remaining < requiredTtlSeconds) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_LIFETIME_INSUFFICIENT',
      'The source credential cannot cover the requested command timeout.',
      `Refresh the identity session or use a shorter --timeout; ${remaining} seconds remain but ${requiredTtlSeconds} are required.`,
    )
  }
  return requiredTtlSeconds
}

async function discoverExchangeEndpoint(
  domainIssuer: IssuerId,
  fetch: Fetch,
  signal: AbortSignal,
): Promise<string> {
  const configurationUrl = new URL(
    exchangeProtocol.paths(domainIssuer).configuration,
    domainIssuer,
  ).toString()
  const configurationResponse = await fetchExchange(
    fetch,
    configurationUrl,
    {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
      signal,
    },
    'Domain issuer discovery could not be reached.',
  )
  if (!configurationResponse.ok) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_DISCOVERY_FAILED',
      `Domain issuer discovery failed with HTTP ${configurationResponse.status}.`,
    )
  }
  const configuration = exchangeProtocol.acceptConfiguration(
    await boundedJson(configurationResponse, signal),
    domainIssuer,
  )
  const endpoint = configuration.token_exchange_endpoint
  if (endpoint === undefined) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_UNSUPPORTED',
      `Domain issuer ${domainIssuer} does not advertise token exchange.`,
      'This command has no legacy token fallback.',
    )
  }
  return endpoint
}

async function exchange(
  endpoint: string,
  domainIssuer: IssuerId,
  kernelIssuer: IssuerId,
  envelope: string,
  requiredTtlSeconds: number,
  fetch: Fetch,
  signal: AbortSignal,
): Promise<{ readonly credential: string; readonly expiresAt: number }> {
  const response = await fetchExchange(
    fetch,
    endpoint,
    {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        authorization: `Bearer ${envelope}`,
        accept: exchangeProtocol.MEDIA_TYPE,
      },
      signal,
    },
    'Domain token exchange could not be reached.',
  )
  const body = await boundedJson(response, signal)
  if (!response.ok) {
    let admitted: exchangeProtocol.ErrorResponse
    try {
      admitted = exchangeProtocol.acceptErrorResponse(body)
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause
      throw new AstraleError(
        'TOKEN_EXCHANGE_PROTOCOL_ERROR',
        `Token exchange failed with HTTP ${response.status} and an invalid error response.`,
        cause instanceof Error ? cause.message : undefined,
      )
    }
    throw new AstraleError(String(admitted.error.code), admitted.error.message)
  }
  requireExchangeResponseHeaders(response)
  let exchanged: exchangeProtocol.Response
  let inspected: ReturnType<typeof credential.inspect>
  try {
    exchanged = exchangeProtocol.acceptResponse(body)
    inspected = credential.inspect(exchanged.token)
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange returned an invalid success response.',
      cause.message,
    )
  }
  if (
    inspected.iss !== domainIssuer ||
    inspected.aud !== kernelIssuer ||
    inspected.claims.exp !== exchanged.expiresAt
  ) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange returned a credential inconsistent with the requested Domain and Kernel.',
    )
  }
  const remaining = effectiveExchangeLifetime(inspected, exchanged.expiresAt)
  if (remaining < requiredTtlSeconds) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT',
      'The Domain exchange credential cannot cover the requested command timeout.',
      `The Domain issuer returned ${Math.max(0, remaining)} seconds but ${requiredTtlSeconds} are required. Use a shorter --timeout or update the Domain execution service.`,
    )
  }
  return Object.freeze({ credential: exchanged.token, expiresAt: exchanged.expiresAt })
}

/** The outer Domain bearer and its carried Kernel proof must both survive the operation. */
function effectiveExchangeLifetime(
  inspected: ReturnType<typeof credential.inspect>,
  outerExpiresAt: number,
): number {
  let proofExpiresAt: number
  try {
    const carried = exchangeCallerProof(grant.acceptUnresolved(inspected.claims.grant).expr)
    if (carried === undefined) {
      throw new TypeError('Domain credential does not carry an identity proof.')
    }
    const value = credential.inspect(carried).claims.exp
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TypeError('Domain credential carries an identity proof without an expiration.')
    }
    proofExpiresAt = value
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange returned an invalid carried identity proof.',
      cause.message,
    )
  }
  return remainingCredentialLifetimeSeconds(Math.min(outerExpiresAt, proofExpiresAt))
}

async function fetchExchange(
  fetch: Fetch,
  input: string,
  init: RequestInit,
  message: string,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new AstraleError('TOKEN_EXCHANGE_UNAVAILABLE', message, undefined, { cause })
  }
}

function requireExchangeTransport(
  target: ConnectionTarget & { readonly domainIssuer: IssuerId },
): void {
  const kernel = new URL(target.kernelIssuer)
  const domain = new URL(target.domainIssuer)
  if (domain.protocol === 'https:') return
  if (domain.protocol === 'http:' && kernel.protocol === 'http:') return
  throw new AstraleError(
    'TOKEN_EXCHANGE_INSECURE',
    'An HTTP Domain issuer is allowed only with an explicitly configured HTTP Kernel target.',
  )
}

function requireExchangeResponseHeaders(response: Response): void {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== exchangeProtocol.MEDIA_TYPE) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange returned an unsupported Content-Type.',
    )
  }
  if (
    !response.headers
      .get('cache-control')
      ?.toLowerCase()
      .split(',')
      .some((v) => v.trim() === 'no-store')
  ) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange response is missing Cache-Control: no-store.',
    )
  }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)
  ) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Issuer response exceeds the size limit.',
    )
  }
  if (response.body === null) {
    throw new AstraleError('TOKEN_EXCHANGE_PROTOCOL_ERROR', 'Issuer response body is missing.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      requireLive(signal)
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAXIMUM_RESPONSE_BYTES) {
        throw new AstraleError(
          'TOKEN_EXCHANGE_PROTOCOL_ERROR',
          'Issuer response exceeds the size limit.',
        )
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
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (cause) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Issuer response is not valid UTF-8 JSON.',
      cause instanceof Error ? cause.message : undefined,
    )
  }
}

function requireLive(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
