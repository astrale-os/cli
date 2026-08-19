import { withFileLock } from '../state/index'
import {
  accessTokenForAudience,
  classifyRefreshFailure,
  idpSessionPath,
  OAuthTokenError,
  readIdpSession,
  refreshSession,
  type IdpSession,
} from './idp'
import { orgIdForAudience } from './instance'
import { fetchOrgHint } from './meta'

/** No cached session file exists for the identity — only a login creates one. */
export class IdpSessionMissingError extends Error {
  readonly identityName: string

  constructor(identityName: string) {
    super(`No cached IdP session for "${identityName}"`)
    this.name = 'IdpSessionMissingError'
    this.identityName = identityName
  }
}

/** The session needs a refresh but never received a refresh token. */
export class IdpSessionNoRefreshTokenError extends Error {
  readonly identityName: string

  constructor(identityName: string) {
    super(`IdP session for "${identityName}" has no refresh token`)
    this.name = 'IdpSessionNoRefreshTokenError'
    this.identityName = identityName
  }
}

export type EnsureFreshSessionOptions = {
  audience?: string
  organizationId?: string
  /**
   * Org-hint resolver, consulted only when a refresh actually happens.
   * Defaults to `fetchOrgHint`; injectable for tests.
   */
  resolveOrganizationId?: (audience: string) => Promise<string | undefined>
}

export function idpSessionLockPath(identityName: string): string {
  // Lives next to the session file; listIdpSessions only picks up *.json.
  return `${idpSessionPath(identityName)}.lock`
}

/**
 * Return a session holding a fresh access token for `audience`, refreshing it
 * if needed. This is the ONLY correct way to refresh: WorkOS refresh tokens
 * are single-use, so two processes refreshing concurrently burn the same
 * token — the loser's `invalid_grant` can revoke the whole upstream session.
 * All refreshes therefore serialize on a per-identity file lock, and waiters
 * re-read the rotated session instead of re-exchanging.
 *
 * `IdpAudienceMismatchError` propagates verbatim (the session is healthy; the
 * IdP just won't mint that audience).
 */
export async function ensureFreshSession(
  identityName: string,
  opts: EnsureFreshSessionOptions = {},
): Promise<IdpSession> {
  const session = await readIdpSession(identityName)
  if (!session) throw new IdpSessionMissingError(identityName)
  if (accessTokenForAudience(session, opts.audience)) return session
  if (!session.refresh_token) throw new IdpSessionNoRefreshTokenError(identityName)

  return withFileLock(idpSessionLockPath(identityName), async () => {
    // Re-read under the lock: a process that held the lock before us may have
    // already rotated the session — using its result is the whole point.
    const current = await readIdpSession(identityName)
    if (!current) throw new IdpSessionMissingError(identityName)
    if (accessTokenForAudience(current, opts.audience)) return current

    // Org resolution order: explicit > bookmarked-at-create > router lookup.
    const bookmarkOrg =
      opts.organizationId ?? (opts.audience ? await orgIdForAudience(opts.audience) : undefined)
    const organizationId =
      bookmarkOrg ??
      (opts.audience
        ? await (opts.resolveOrganizationId ?? fetchOrgHint)(opts.audience)
        : undefined)
    try {
      return await refreshSession(identityName, current, {
        audience: opts.audience,
        organizationId,
      })
    } catch (e) {
      // A bookmarked org can go stale (instance deleted/recreated elsewhere).
      // On an org rejection, retry once with the router's view and let the
      // bookmark heal on the next `instance create`.
      if (
        bookmarkOrg &&
        !opts.organizationId &&
        opts.audience &&
        classifyRefreshFailure(e) === 'org-rejected'
      ) {
        const routerOrg = await (opts.resolveOrganizationId ?? fetchOrgHint)(opts.audience)
        if (routerOrg && routerOrg !== bookmarkOrg) {
          return await refreshSession(identityName, current, {
            audience: opts.audience,
            organizationId: routerOrg,
          })
        }
      }
      const rescued = await rescueAfterInvalidGrant(identityName, current, opts.audience, e)
      if (rescued) return rescued
      throw e
    }
  })
}

/**
 * Last-resort race recovery: an `invalid_grant` ("refresh token already
 * exchanged") can mean a non-locking process — an older CLI build, or a
 * stale-lock takeover window — won the exchange and saved the rotated
 * session. If the file changed since we read it and now serves the audience,
 * use it instead of declaring the session dead.
 */
async function rescueAfterInvalidGrant(
  identityName: string,
  seen: IdpSession,
  audience: string | undefined,
  error: unknown,
): Promise<IdpSession | undefined> {
  if (!(error instanceof OAuthTokenError) || error.code !== 'invalid_grant') return undefined
  const latest = await readIdpSession(identityName).catch(() => null)
  if (!latest || latest.updatedAt === seen.updatedAt) return undefined
  if (!accessTokenForAudience(latest, audience)) return undefined
  return latest
}
