import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity, type Identity } from '../lib/identity'
import { isSessionExpired, readIdpSession, refreshSession } from '../lib/idp'
import { fileExists, keypairPaths, signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'

/**
 * Resolve a signed JWT credential from CLI options.
 *
 * The **audience** is passed in explicitly by the caller, because URL
 * (transport) and issuer (identity) diverge for local children bound to
 * tunnels — the CLI talks to them at `http://localhost:<port>/<id>` but
 * their `kernelIssuer` is the tunneled URL. See `resolveAudience` in
 * `lib/instance-issuer.ts` for how this is computed.
 *
 * Three cases, in order of priority:
 *   1. `opts.creds` — pre-signed credential, returned as-is.
 *   2. `opts.as` — sign as a named local identity.
 *   3. Default — when `instanceSlug` is set AND a per-instance keypair
 *      exists on disk, sign **as the instance itself** (`iss = audience,
 *      sub = slug, aud = audience`) so the child recognizes the caller
 *      as its own bootstrap identity. Otherwise, sign as the active
 *      identity against the manager issuer.
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

    // Instance-scoped signing: when targeting a child for which the CLI
    // generated a dedicated keypair at `instance create`, sign with the
    // child's own identity so its authenticator short-circuits.
    if (instanceSlug && instanceSlug !== 'manager') {
      const { privatePath } = keypairPaths(instanceSlug, KEYS_DIR)
      if (await fileExists(privatePath)) {
        return await signAs(instanceSlug, KEYS_DIR, {
          issuer: audience,
          audience,
        })
      }
    }

    // Default: sign as the active local identity against the manager
    // issuer.
    return await signAs(identity.subject, KEYS_DIR, {
      issuer: config.issuer,
      audience,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to resolve credentials'
    const hint = opts.as
      ? `Check identity name. Available identities: astrale identity list`
      : 'Run `astrale identity create <name>` or `astrale init` to set up keys'
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
