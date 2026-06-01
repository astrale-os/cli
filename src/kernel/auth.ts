import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity, type Identity } from '../lib/identity'
import { isSessionExpired, readIdpSession, refreshSession } from '../lib/idp'
import { signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'

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
  opts: { as?: string; creds?: string },
  config: AstraleConfig,
  audience: string = config.issuer,
  instanceSlug?: string,
): Promise<string> {
  if (opts.creds) return opts.creds
  try {
    // Explicit `--as` wins: sign with that identity's key. When the identity
    // has a registration record for the targeted instance (populated by
    // `astrale identity register`), use the kernel-derived `(iss, sub)` so the
    // JWT matches what the kernel published under its issuer store.
    if (opts.as) {
      const identity = await getIdentity(opts.as)
      if ((identity.source ?? 'key') === 'idp')
        return await resolveIdpAccessToken(opts.as, identity)
      const registration = instanceSlug ? identity.registrations?.[instanceSlug] : undefined
      return await signAs(identity.subject, KEYS_DIR, {
        issuer: registration?.iss ?? config.issuer,
        subject: registration?.sub,
        audience,
      })
    }

    const identity = await getDefault()
    if ((identity.source ?? 'key') === 'idp') {
      return await resolveIdpAccessToken(identity.name, identity)
    }

    const registration = instanceSlug ? identity.registrations?.[instanceSlug] : undefined
    return await signAs(identity.subject, KEYS_DIR, {
      issuer: registration?.iss ?? config.issuer,
      subject: registration?.sub,
      audience,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to resolve credentials'
    const hint = opts.as
      ? `Check identity name. Available identities: astrale identity list`
      : 'Run `astrale identity create <name>` to set up keys'
    throw new AuthError(message, hint)
  }
}

async function resolveIdpAccessToken(identityName: string, identity: Identity): Promise<string> {
  const session = await readIdpSession(identityName)
  if (!session) {
    throw new Error(
      `No cached IdP session for "${identityName}". Run: astrale auth login --idp ${identity.idp ?? '<idp>'}`,
    )
  }
  if (isSessionExpired(session)) {
    const refreshed = await refreshSession(identityName, session)
    return refreshed.access_token
  }
  return session.access_token
}
