import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { AuthError } from '../errors'
import { getDefault, getIdentity, type Identity } from '../identity/registry'
import { signAs } from '../keys/index'
import {
  accessTokenForAudience,
  classifyRefreshFailure,
  IdpAudienceMismatchError,
  readIdpSession,
} from '../lib/idp/provider'
import {
  ensureFreshSession,
  IdpSessionMissingError,
  IdpSessionNoRefreshTokenError,
} from '../lib/idp/session'
import { KEYS_DIR } from '../state/index'

/** The stable (issuer, subject) of the selected source identity, as the exchange cache keys it. */
export interface SourceIdentity {
  readonly issuer: string
  readonly subject: string
}

/** The named identity, else the default one. */
async function selectIdentity(
  name: string | undefined,
): Promise<Identity & { readonly name: string }> {
  return name ? { ...(await getIdentity(name)), name } : getDefault()
}

/**
 * Read only stable IdP identity metadata for an exact persisted exchange-cache lookup: the cached
 * session's claims must name the selected identity. Credential freshness remains the exchange
 * cache's responsibility; any ambiguity falls through to the ordinary source-token resolver.
 */
export async function resolvePersistedIdpSourceIdentity(opts: {
  readonly as?: string
  readonly defaultIdentity?: string
}): Promise<SourceIdentity | undefined> {
  const identity = await selectIdentity(opts.as ?? opts.defaultIdentity)
  if (identity.source !== 'idp') return undefined
  const session = await readIdpSession(identity.name).catch(() => null)
  if (session === null || session.identity !== identity.name) return undefined
  const issuer = session.claims?.iss
  const subject = session.claims?.sub
  if (
    typeof issuer !== 'string' ||
    issuer === '' ||
    issuer !== identity.issuer ||
    typeof subject !== 'string' ||
    subject === '' ||
    subject !== identity.subject
  ) {
    return undefined
  }
  return Object.freeze({ issuer, subject })
}

/** Pin the local identity label before a session performs any authenticated effect. */
export async function bindCredentialIdentity<Options extends ConnectionOptions>(
  options: Options,
  target: ConnectionTarget,
): Promise<Options> {
  if (options.anonymous === true || options.creds !== undefined || options.as !== undefined) {
    return options
  }
  const identity = target.defaultIdentity ?? (await getDefault()).name
  return Object.freeze({ ...options, as: identity })
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
  opts: {
    as?: string
    creds?: string
    defaultIdentity?: string
    minimumRemainingSeconds?: number
  },
  config: AstraleConfig,
  audience: string = config.issuer,
  registrationKey?: string,
): Promise<string> {
  if (opts.creds) return opts.creds
  // Track the resolved identity so the catch block can tailor its hint: an
  // IdP-backed identity whose session lapsed needs `astrale auth login`, not
  // the `astrale identity create` keypair hint that suits local key identities.
  let resolved: (Identity & { readonly name: string }) | undefined
  try {
    // Explicit `--as` wins, then the bookmark's identity, then the default one. A key identity with
    // a registration for the target signs the Kernel-derived `(iss, sub)` the Kernel published.
    resolved = await selectIdentity(opts.as ?? opts.defaultIdentity)
    if (resolved.source === 'idp') {
      return await resolveIdpAccessToken(
        resolved.name,
        resolved,
        audience,
        opts.minimumRemainingSeconds,
      )
    }
    const registration = registrationKey ? resolved.registrations?.[registrationKey] : undefined
    return await signAs(resolved.subject, KEYS_DIR, {
      issuer:
        registration?.iss ?? resolved.issuer ?? systemIdentityIssuer(resolved, audience, config),
      subject: registration?.sub,
      audience,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to resolve credentials'
    const hint = resolveCredentialHint(opts, resolved, e)
    throw new AuthError(message, hint)
  }
}

function resolveCredentialHint(
  opts: { as?: string; defaultIdentity?: string },
  identity: (Identity & { readonly name: string }) | undefined,
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
  // Org-membership rejection: the session is healthy; the org we scoped the
  // token to doesn't hold this user. Re-login can never fix it.
  if (error instanceof IdpOrgMembershipError) {
    return 'This instance might belong to a different account.'
  }
  // A refused local session file: re-login writes the same files, so it cannot help.
  if (error instanceof IdpSessionFileAccessError) {
    return `Check that this user can read and write ${error.path} and its directory (owner, mode, a read-only mount or a sandbox), then retry.`
  }
  // Transient IdP outage: the cached session is still valid — retrying is the
  // fix, not re-login.
  if (error instanceof IdpRefreshTransientError) {
    return 'The IdP could not be reached. Check the network and retry — the cached session is likely still valid.'
  }
  // IdP-backed identities fail when the cached session expires or the upstream
  // session is terminated (e.g. WorkOS "Session has already ended"). Re-login,
  // don't recreate keys.
  if (identity?.source === 'idp') {
    const idpFlag = identity.idp ? ` --idp ${identity.idp}` : ''
    return `IdP session for "${identity.name}" has expired. Run: astrale auth login --name ${identity.name}${idpFlag}`
  }
  if (opts.as) {
    return 'Check identity name. Available identities: astrale identity list'
  }
  if (opts.defaultIdentity) {
    return `Check bookmark default identity "${opts.defaultIdentity}". Available identities: astrale identity list`
  }
  return 'Run `astrale identity create <name>` to set up keys'
}

function systemIdentityIssuer(identity: Identity, audience: string, config: AstraleConfig): string {
  // Imported kernel bootstrap keys are subject=system and are published by the
  // target kernel's JWKS. Without a stored issuer, signing them as the
  // placeholder CLI issuer makes the kernel try OIDC discovery for a
  // non-resolving host — use the audience (the target kernel) instead.
  return identity.subject === 'system' ? audience : config.issuer
}

async function resolveIdpAccessToken(
  identityName: string,
  identity: Identity,
  audience: string,
  minimumRemainingSeconds?: number,
): Promise<string> {
  let resolved
  try {
    resolved = await ensureFreshSession(identityName, { audience, minimumRemainingSeconds })
  } catch (e) {
    if (e instanceof IdpSessionMissingError) {
      throw new Error(
        `No cached IdP session for "${identityName}". Run: astrale auth login --idp ${identity.idp ?? '<idp>'}`,
      )
    }
    // Without a refresh token the session cannot mint another audience than its own.
    if (e instanceof IdpSessionNoRefreshTokenError) {
      throw identity.audience !== undefined && identity.audience !== audience
        ? new IdpAudienceMismatchError(audience, identity.audience)
        : e
    }
    // An audience mismatch means the session is healthy but the IdP won't
    // mint this audience — re-login is futile, so propagate it verbatim for
    // the hint logic to handle.
    if (e instanceof IdpAudienceMismatchError) throw e
    throw refreshFailureError(identityName, identity, e)
  }

  const token = accessTokenForAudience(resolved, audience)
  if (!token) {
    throw new Error(
      `IdP token for "${identityName}" was not minted for target audience ${audience}. ` +
        `Run: astrale auth login --name ${identityName} --idp ${identity.idp ?? '<idp>'} --audience ${audience}`,
    )
  }

  return token
}

/** A refresh attempt failed for a reason that re-login will NOT fix. */
class IdpRefreshTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdpRefreshTransientError'
  }
}

/** The IdP refused to scope the session to the target's organization. */
class IdpOrgMembershipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdpOrgMembershipError'
  }
}

/** The filesystem refused access to a local session file: its lock, the session or its write. */
class IdpSessionFileAccessError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'IdpSessionFileAccessError'
    this.path = path
  }
}

const FILE_ACCESS_REFUSALS: ReadonlySet<unknown> = new Set(['EACCES', 'EPERM', 'EROFS'])

function refreshFailureError(identityName: string, identity: Identity, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const idpFlag = identity.idp ? ` --idp ${identity.idp}` : ''
  // A local filesystem refusal says nothing about the IdP session. Only filesystem errors carry a
  // path, which keeps a socket EPERM (a sandbox blocking the network) out of this branch.
  const { code, path } = (cause ?? {}) as { readonly code?: unknown; readonly path?: unknown }
  if (FILE_ACCESS_REFUSALS.has(code) && typeof path === 'string') {
    return new IdpSessionFileAccessError(
      path,
      `Could not refresh the IdP session for "${identityName}": access to ${path} was refused (${String(code)}).`,
    )
  }
  // Only a definitively dead grant (invalid_grant: WorkOS idle/absolute
  // timeout, logout elsewhere, reuse-detection revocation) warrants a
  // re-login. Network failures and IdP 5xx leave the cached session valid —
  // telling the user to re-login for those would burn a perfectly good
  // session.
  switch (classifyRefreshFailure(cause)) {
    case 'transient':
      return new IdpRefreshTransientError(
        `Could not reach the IdP to refresh the session for "${identityName}" (${reason}). ` +
          'The cached session is likely still valid — retry the command.',
      )
    case 'org-rejected':
      // Healthy session, wrong org — re-login can never fix it.
      return new IdpOrgMembershipError(
        `The IdP refused to scope "${identityName}" to this instance's organization (${reason}).`,
      )
    default:
      return new Error(
        `IdP session for "${identityName}" could not be refreshed (${reason}). ` +
          `The cached session has expired or ended — run: astrale auth login --name ${identityName}${idpFlag}`,
      )
  }
}
