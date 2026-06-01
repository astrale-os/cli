/**
 * Issuer reachability helpers — OIDC discovery + JWKS.
 *
 * Kernels don't expose `/meta`. They expose OIDC discovery at
 * `/.well-known/openid-configuration` (standard, returns `issuer` and
 * `jwks_uri`) and JWKS at `/.well-known/jwks.json`. These helpers probe
 * both to verify the issuer is alive and publishes at least one key.
 *
 * Domain workers may expose `/meta` for deployment drift detection; that is
 * outside this connect-only CLI surface.
 */

import { IssuerUnreachableError } from '../errors'

export type DiscoveryDocument = {
  /** OIDC issuer URL. */
  issuer: string
  /** JWKS URI (defaults to `<issuer>/.well-known/jwks.json`). */
  jwksUri: string
}

export async function fetchDiscovery(url: string, timeoutMs = 5_000): Promise<DiscoveryDocument> {
  const discoveryUrl = url.replace(/\/+$/, '') + '/.well-known/openid-configuration'
  try {
    const r = await fetch(discoveryUrl, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const body = (await r.json()) as { issuer?: string; jwks_uri?: string }
    if (!body.issuer) throw new Error('discovery missing "issuer"')
    const issuer = body.issuer
    const jwksUri = body.jwks_uri ?? `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`
    return { issuer, jwksUri }
  } catch (e) {
    throw new IssuerUnreachableError(discoveryUrl, (e as Error).message)
  }
}

export async function fetchJwks(
  jwksUri: string,
  timeoutMs = 5_000,
): Promise<{ keys: Array<{ kid?: string }> }> {
  try {
    const r = await fetch(jwksUri, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()) as { keys: Array<{ kid?: string }> }
  } catch (e) {
    throw new IssuerUnreachableError(jwksUri, (e as Error).message)
  }
}

/**
 * Verify the issuer at `url` publishes OIDC discovery and a non-empty JWKS.
 * `issuerOverride` forces a specific expected issuer when discovery URL and
 * declared issuer differ.
 */
export async function checkIssuerReachability(
  url: string,
  issuerOverride?: string,
): Promise<{ issuer: string; keys: Array<{ kid?: string }> }> {
  const discovery = await fetchDiscovery(url)
  const issuer = issuerOverride ?? discovery.issuer
  const jwks = await fetchJwks(discovery.jwksUri)
  if (jwks.keys.length === 0)
    throw new IssuerUnreachableError(discovery.jwksUri, 'no keys published')
  return { issuer, keys: jwks.keys }
}
