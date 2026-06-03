import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity, type Identity } from '../lib/identity'
import { isSessionExpired, readIdpSession, refreshSession, tokenAudienceMatches } from '../lib/idp'
import { signAs } from '../lib/keys'
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
  try {
    const identityName = opts.as ?? opts.defaultIdentity
    // Explicit `--as` wins: sign with that identity's key. When the identity
    // has a registration record for the targeted instance (populated by
    // `astrale identity register`), use the kernel-derived `(iss, sub)` so the
    // JWT matches what the kernel published under its issuer store.
    if (identityName) {
      const identity = await getIdentity(identityName)
      if ((identity.source ?? 'key') === 'idp')
        return await resolveIdpAccessToken(identityName, identity, audience)
      return await signAs(
        identity.subject,
        KEYS_DIR,
        resolveKeyIdentityAuthOptions(identity, config, audience, instanceSlug),
      )
    }

    const identity = await getDefault()
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
    let hint = 'Run `astrale identity create <name>` to set up keys'
    if (opts.as) {
      hint = 'Check identity name. Available identities: astrale identity list'
    } else if (opts.defaultIdentity) {
      hint = `Check bookmark default identity "${opts.defaultIdentity}". Available identities: astrale identity list`
    }
    throw new AuthError(message, hint)
  }
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
    resolved = await refreshSession(identityName, resolved, { audience })
  }

  if (!tokenAudienceMatches(resolved.access_token, audience)) {
    throw new Error(
      `IdP token for "${identityName}" was not minted for target audience ${audience}. ` +
        `Run: astrale auth login --name ${identityName} --idp ${identity.idp ?? '<idp>'} --audience ${audience}`,
    )
  }

  return resolved.access_token
}

function wrongAudienceHint(identityName: string, identity: Identity, audience: string): string {
  return (
    `IdP token for "${identityName}" was not minted for target audience ${audience}, ` +
    'and the cached session cannot be refreshed. ' +
    `Run: astrale auth login --name ${identityName} --idp ${identity.idp ?? '<idp>'} --audience ${audience}`
  )
}
