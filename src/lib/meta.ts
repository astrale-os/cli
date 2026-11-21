/**
 * Issuer reachability helpers — OIDC discovery + JWKS.
 *
 * Kernels don't expose `/meta`. They expose OIDC discovery at
 * `/.well-known/openid-configuration` (standard, returns `issuer` and
 * `jwks_uri`) and JWKS at `/.well-known/jwks.json`. These helpers probe
 * both to verify the issuer is alive and publishes at least one key.
 *
 * Domain deployment readiness uses the canonical Domain Publication; that is
 * outside this issuer-connectivity helper.
 */

import type { JWK } from 'jose'

import { IssuerUnreachableError } from '../errors'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type DiscoveryDocument = {
  /** OIDC issuer URL. */
  issuer: string
  /** JWKS URI (defaults to `<issuer>/.well-known/jwks.json`). */
  jwksUri: string
}

async function fetchDiscovery(
  url: string,
  timeoutMs = 5_000,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<DiscoveryDocument> {
  const discoveryUrl = url.replace(/\/+$/, '') + '/.well-known/openid-configuration'
  const body = await fetchIssuerJson<{ issuer?: string; jwks_uri?: string }>(
    discoveryUrl,
    timeoutMs,
    fetchImpl,
  )
  if (!body?.issuer) throw new IssuerUnreachableError(discoveryUrl, 'discovery missing "issuer"')
  const issuer = body.issuer
  const jwksUri = body.jwks_uri ?? `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`
  return { issuer, jwksUri }
}

async function fetchJwks(
  jwksUri: string,
  timeoutMs = 5_000,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ keys: JWK[] }> {
  const body = await fetchIssuerJson<{ keys?: unknown }>(jwksUri, timeoutMs, fetchImpl)
  if (!Array.isArray(body?.keys)) throw new IssuerUnreachableError(jwksUri, 'JWKS missing "keys"')
  return { keys: body.keys as JWK[] }
}

/** The JSON body at `url`: no answer, a non-2xx status, or a non-JSON body is an unreachable issuer. */
async function fetchIssuerJson<T>(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<T | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new IssuerUnreachableError(url, `HTTP ${response.status}`)
    return (await response.json()) as T | null
  } catch (error) {
    if (error instanceof IssuerUnreachableError) throw error
    throw new IssuerUnreachableError(url, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Discover the WorkOS organization an instance host pins
 */
export async function fetchOrgHint(url: string, timeoutMs = 5_000): Promise<string | undefined> {
  try {
    const origin = new URL(url).origin
    const r = await fetch(`${origin}/auth/org`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return undefined
    const body = (await r.json()) as { organizationId?: unknown }
    return typeof body.organizationId === 'string' ? body.organizationId : undefined
  } catch {
    return undefined
  }
}

/** Verify the pinned issuer publishes self-consistent OIDC discovery and a non-empty JWKS. */
export async function checkIssuerReachability(
  url: string,
  issuerOverride?: string,
  fetchImpl?: FetchLike,
): Promise<{ issuer: string; keys: JWK[] }> {
  const discoveryBase = issuerOverride ?? url
  const discovery = await fetchDiscovery(discoveryBase, 5_000, fetchImpl)
  if (issuerOverride !== undefined && discovery.issuer !== issuerOverride) {
    throw new IssuerUnreachableError(
      `${discoveryBase.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      `discovery declared issuer "${discovery.issuer}" instead of "${issuerOverride}"`,
    )
  }
  const jwks = await fetchJwks(discovery.jwksUri, 5_000, fetchImpl)
  if (jwks.keys.length === 0)
    throw new IssuerUnreachableError(discovery.jwksUri, 'no keys published')
  return { issuer: discovery.issuer, keys: jwks.keys }
}
