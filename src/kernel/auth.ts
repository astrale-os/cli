import type { AstraleConfig } from '../lib/config'

import { AuthError } from '../errors'
import { getDefault, getIdentity } from '../lib/identity'
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
    // Explicit `--as` wins: sign with that identity's key.
    if (opts.as) {
      const identity = await getIdentity(opts.as)
      return await signAs(identity.subject, KEYS_DIR, {
        issuer: config.issuer,
        audience,
      })
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
    const identity = await getDefault()
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
