import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity, type Identity } from '../lib/identity'
import {
  IdpAudienceMismatchError,
  isSessionExpired,
  readIdpSession,
  refreshSession,
  tokenAudienceMatches,
} from '../lib/idp'
import { signAs } from '../lib/keys'
import { fetchOrgHint } from '../lib/meta'
import { KEYS_DIR } from '../lib/paths'

export type KeyIdentityAuthOptions = {
  issuer: string
  subject?: string
  audience: string
}

/**
 * Resolve a signed JWT credential from CLI options.
 *
 * The **audience** is passed in explicitly by the caller because transport URL
 * and kernel issuer can differ for remote deployments.
 *
 * Three cases, in order of priority:
 *   1. `opts.creds` — pre-signed credential, returned as-is.
 *   2. `opts.as` — sign as a named local identity.
 *   3. Default — sign as the active local identity. If the identity has a
 *      registration for the target instance, use that target-issued `(iss, sub)`.
 */
export async function resolveCredential(
  opts: { as?: string; creds?: string; defaultIdentity?: string },
  config: AstraleConfig,
  audience: string = config.issuer,
  instanceSlug?: string,
): Promise<string> {
  if (opts.creds) return opts.creds
  // Track the resolved identity so the catch block can tailor its hint: an
  // IdP-backed identity whose session lapsed needs `astrale auth login`, not
  // the `astrale identity create` keypair hint that suits local key identities.
  let resolvedIdentity: Identity | undefined
  let resolvedName: string | undefined
  try {
    const identityName = opts.as ?? opts.defaultIdentity
    // Explicit `--as` wins: sign with that identity's key. When the identity
    // has a registration record for the targeted instance (populated by
    // `astrale identity register`), use the kernel-derived `(iss, sub)` so the
    // JWT matches what the kernel published under its issuer store.
    if (identityName) {
      const identity = await getIdentity(identityName)
      resolvedIdentity = identity
      resolvedName = identityName
      if ((identity.source ?? 'key') === 'idp')
        return await resolveIdpAccessToken(identityName, identity, audience)
      return await signAs(
        identity.subject,
        KEYS_DIR,
        resolveKeyIdentityAuthOptions(identity, config, audience, instanceSlug),
      )
    }

    const identity = await getDefault()
    resolvedIdentity = identity
    resolvedName = identity.name
    if ((identity.source ?? 'key') === 'idp') {
      return await resolveIdpAccessToken(identity.name, identity, audience)
    }

    return await signAs(
      identity.subject,
      KEYS_DIR,
      resolveKeyIdentityAuthOptions(identity, config, audience, instanceSlug),
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to resolve credentials'
    const hint = resolveCredentialHint(opts, resolvedIdentity, resolvedName, e)
    throw new AuthError(message, hint)
  }
}

function resolveCredentialHint(
  opts: { as?: string; defaultIdentity?: string },
  identity: Identity | undefined,
  name: string | undefined,
  error?: unknown,
): string {
  // Audience mismatch: the IdP minted a token for a different `aud` than the
  // target requires (e.g. WorkOS stamps a fixed API audience and ignores the
  // requested one). Re-login mints the *same* aud again, so don't suggest it —
  // point at targeting an instance whose audience matches what the IdP issues.
  if (error instanceof IdpAudienceMismatchError) {
    return error.actual
      ? `The IdP issues tokens for audience ${error.actual}, not the target's ${error.requested}. Target an instance whose URL/issuer is ${error.actual} (re-login won't change the audience).`
      : `The IdP did not mint a token for the target audience ${error.requested}, and re-login won't change it. Target an instance whose audience the IdP issues, or reconfigure the bookmark/IdP.`
  }
  // IdP-backed identities fail when the cached session expires or the upstream
  // session is terminated (e.g. WorkOS "Session has already ended"). Re-login,
  // don't recreate keys.
  if (identity && (identity.source ?? 'key') === 'idp' && name) {
    const idpFlag = identity.idp ? ` --idp ${identity.idp}` : ''
    return `IdP session for "${name}" has expired. Run: astrale auth login --name ${name}${idpFlag}`
  }
  if (opts.as) {
    return 'Check identity name. Available identities: astrale identity list'
  }
  if (opts.defaultIdentity) {
    return `Check bookmark default identity "${opts.defaultIdentity}". Available identities: astrale identity list`
  }
  return 'Run `astrale identity create <name>` to set up keys'
}

export function resolveKeyIdentityAuthOptions(
  identity: Identity,
  config: AstraleConfig,
  audience: string = config.issuer,
  instanceSlug?: string,
): KeyIdentityAuthOptions {
  const registration = instanceSlug ? identity.registrations?.[instanceSlug] : undefined
  return {
    issuer:
      registration?.iss ?? identity.issuer ?? systemIdentityIssuer(identity, audience, config),
    subject: registration?.sub,
    audience,
  }
}

function systemIdentityIssuer(identity: Identity, audience: string, config: AstraleConfig): string {
  // Imported kernel bootstrap keys are subject=system and are published by the
  // target kernel's JWKS. Without a stored issuer, signing them as the global
  // CLI issuer makes the kernel try OIDC discovery for identity.astrale.ai.
  return identity.subject === 'system' ? audience : config.issuer
}

async function resolveIdpAccessToken(
  identityName: string,
  identity: Identity,
  audience: string,
): Promise<string> {
  const session = await readIdpSession(identityName)
  if (!session) {
    throw new Error(
      `No cached IdP session for "${identityName}". Run: astrale auth login --idp ${identity.idp ?? '<idp>'}`,
    )
  }

  let resolved = session
  if (isSessionExpired(resolved) || !tokenAudienceMatches(resolved.access_token, audience)) {
    if (!resolved.refresh_token)
      throw new Error(wrongAudienceHint(identityName, identity, audience))
    const organizationId = await fetchOrgHint(audience)
    try {
      resolved = await refreshSession(identityName, resolved, { audience, organizationId })
    } catch (e) {
      // An audience mismatch means the session is healthy but the IdP won't
      // mint this audience — re-login is futile, so propagate it verbatim for
      // the hint logic to handle. Anything else is a dead/ended session.
      if (e instanceof IdpAudienceMismatchError) throw e
      throw new Error(refreshFailureMessage(identityName, identity, e))
    }
  }

  if (!tokenAudienceMatches(resolved.access_token, audience)) {
    throw new Error(
      `IdP token for "${identityName}" was not minted for target audience ${audience}. ` +
        `Run: astrale auth login --name ${identityName} --idp ${identity.idp ?? '<idp>'} --audience ${audience}`,
    )
  }

  return resolved.access_token
}

function refreshFailureMessage(identityName: string, identity: Identity, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const idpFlag = identity.idp ? ` --idp ${identity.idp}` : ''
  // WorkOS terminates the upstream session (idle/absolute timeout, logout
  // elsewhere) and then rejects the refresh token. Other IdPs surface the same
  // class of failure as invalid_grant. Either way the cached session is dead —
  // the only recovery is an interactive re-login.
  return (
    `IdP session for "${identityName}" could not be refreshed (${reason}). ` +
    `The cached session has expired or ended — run: astrale auth login --name ${identityName}${idpFlag}`
  )
}

function wrongAudienceHint(identityName: string, identity: Identity, audience: string): string {
  return (
    `IdP token for "${identityName}" was not minted for target audience ${audience}, ` +
    'and the cached session cannot be refreshed. ' +
    `Run: astrale auth login --name ${identityName} --idp ${identity.idp ?? '<idp>'} --audience ${audience}`
  )
}
