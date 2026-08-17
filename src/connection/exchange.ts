import type { Fetch } from '@astrale-os/kernel-client'
import type { IssuerId } from '@astrale-os/sdk/auth'

import { call, Client } from '@astrale-os/kernel-client'
import { createAuth } from '@astrale-os/kernel-client/auth'
import { credential, exchange as exchangeProtocol } from '@astrale-os/sdk/auth'

import type { SourceCredentialResolver } from './credential'
import type { ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { ExchangeCredentialCache } from '../state/exchange-credentials'

const EXCHANGE_TTL_SECONDS = 300
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
  return Object.freeze({
    async resolve(kernelIssuer: IssuerId, signal: AbortSignal): Promise<string> {
      requireLive(signal)
      const sourceToken = await source.resolve(kernelIssuer, signal)
      requireLive(signal)

      const client = new Client({ url: target.url, fetch, timeoutMs })
      try {
        const authenticated = client.as(sourceToken)
        const auth = createAuth((path, input, options) =>
          authenticated.call(call(path, input), {
            ...options,
            delegate: { ttlSeconds: EXCHANGE_TTL_SECONDS },
          }),
        )
        const user = await auth.whoami({ signal })
        const key = Object.freeze({
          kernelIssuer,
          domainIssuer: target.domainIssuer,
          user: user.id,
        })
        return await cache.getOrRefresh(key, async () => {
          const envelope = await auth.delegate(
            user.id,
            {
              audience: target.domainIssuer,
              ttlSeconds: EXCHANGE_TTL_SECONDS,
              attenuation: { kind: 'identity', self: true },
            },
            { signal },
          )
          return exchange(target.domainIssuer, kernelIssuer, envelope, fetch, signal)
        })
      } finally {
        client.close()
      }
    },
  })
}

async function exchange(
  domainIssuer: IssuerId,
  kernelIssuer: IssuerId,
  envelope: string,
  fetch: Fetch,
  signal: AbortSignal,
): Promise<{ readonly credential: string; readonly expiresAt: number }> {
  const configurationUrl = new URL(
    exchangeProtocol.paths(domainIssuer).configuration,
    domainIssuer,
  ).toString()
  const configurationResponse = await fetch(configurationUrl, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { accept: 'application/json' },
    signal,
  })
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

  const response = await fetch(endpoint, {
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
  })
  const body = await boundedJson(response, signal)
  if (!response.ok) {
    let admitted: exchangeProtocol.ErrorResponse
    try {
      admitted = exchangeProtocol.acceptErrorResponse(body)
    } catch (cause) {
      throw new AstraleError(
        'TOKEN_EXCHANGE_PROTOCOL_ERROR',
        `Token exchange failed with HTTP ${response.status} and an invalid error response.`,
        cause instanceof Error ? cause.message : undefined,
      )
    }
    throw new AstraleError(String(admitted.error.code), admitted.error.message)
  }
  requireExchangeResponseHeaders(response)
  const exchanged = exchangeProtocol.acceptResponse(body)
  const inspected = credential.inspect(exchanged.token)
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
  return Object.freeze({ credential: exchanged.token, expiresAt: exchanged.expiresAt })
}

function requireExchangeTransport(
  target: ConnectionTarget & { readonly domainIssuer: IssuerId },
): void {
  const kernel = new URL(target.url)
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
