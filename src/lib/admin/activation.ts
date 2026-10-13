import type { Fetch } from '@astrale-os/sdk/client'

import { ClientSession } from '@astrale-os/sdk/client/session'
import { z } from 'zod'

import type { InstanceInfo } from '../../admin/instance'
import type { KernelCommandOpts } from '../../connection'

import { credentialRefused } from '../../connection/reasons'
import { AstraleError } from '../../errors'
import { readIdentities } from '../../identity'
import { fetchWithCaFile } from '../ca-fetch'
import { readConfig } from '../config'
import {
  accessTokenForAudience,
  BUILTIN_WORKOS_IDP_NAME,
  classifyRefreshFailure,
} from '../idp/provider'
import { ensureFreshSession } from '../idp/session'
import { resolveAdminTarget, type AdminTargetCommandOpts } from './target'

/**
 * Admin completes what it prepared for a human: the access an administrator prepared for a WorkOS
 * account at login, and the owner of an Instance it created. Both are one POST to an Admin
 * endpoint, authenticated by the human's primary credential for the Kernel the access is about.
 */
interface ActivationRequest {
  readonly endpoint: string
  readonly instanceOrigin: string
  readonly credential: () => Promise<string>
}

type AdminSelection = Pick<AdminTargetCommandOpts, 'admin' | 'adminUrl' | 'domainIssuer'>

/** Admin's endpoint `path` on its Domain issuer, when that is plain HTTPS. */
function adminEndpoint(domainIssuer: string, path: string): URL | undefined {
  const endpoint = new URL(path, domainIssuer)
  return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password
    ? endpoint
    : undefined
}

/** A canonical HTTPS Kernel audience: `https://<host>/api`. */
const isKernelAudience = (url: URL) => url.protocol === 'https:' && url.href === `${url.origin}/api`

/** The identity's primary credential for `audience`, fresh for the whole request. */
async function primaryCredential(
  identity: string,
  audience: string,
  organizationId: string | undefined,
  missing: () => Error,
): Promise<string> {
  const session = await ensureFreshSession(identity, {
    audience,
    ...(organizationId === undefined ? {} : { organizationId }),
    minimumRemainingSeconds: 150,
  })
  const token = accessTokenForAudience(session, audience)
  if (!token) throw missing()
  return token
}

/** POST one activation; the request budget starts after the credential's own locked rotation. */
function post(fetch: Fetch, request: ActivationRequest, token: string, signal: AbortSignal) {
  return fetch(request.endpoint, {
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ instanceOrigin: request.instanceOrigin }),
  })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// --- Account activation at login --------------------------------------------------------------

/**
 * `ready`: nothing is left to complete on Admin, and its Kernel accepted the account.
 * `unregistered`: the account has no access to Admin: outside its organization, or no Identity
 * there. Admin's own `ready` grants nothing and does not prove registration, so login asks its
 * Kernel. `rejected`: Admin refused this login itself. `denied`: Admin refused the pending admission.
 */
type AccountActivation =
  | 'ready'
  | 'pending'
  | 'unregistered'
  | 'rejected'
  | 'denied'
  | 'unavailable'

/** What a user should do when a login could not complete prepared access. */
export const ACCOUNT_ACTIVATION_WARNINGS = {
  pending: 'Astrale access is still being completed. Run `astrale auth login` again in a moment.',
  unregistered:
    'This account has no access to Astrale Admin, so Admin commands such as `astrale issue` are refused. Ask an administrator for an invitation, then run `astrale auth login` again.',
  rejected:
    'Astrale Admin did not accept this login, so no prepared access was completed. Check that this is the invited WorkOS account.',
  denied: 'Astrale Admin refused the access prepared for this account. Ask an administrator.',
  unavailable:
    'Astrale Admin could not be reached to complete prepared access. Run `astrale auth login` again later.',
} satisfies Record<Exclude<AccountActivation, 'ready'>, string>

const ready = z.strictObject({ status: z.literal('ready') })
const ACCOUNT_ATTEMPTS = 3
const MAXIMUM_RETRY_DELAY_MS = 5_000

/**
 * A human login through the built-in WorkOS IdP completes Admin's prepared access, such as a Fleet
 * invitation; other logins hold none there. The login itself never fails because of it.
 */
export async function activateLoggedInAccount(
  login: {
    readonly identityName: string
    readonly idpName: string
    readonly clientCredentials?: boolean
  },
  selection: AdminSelection = {},
): Promise<AccountActivation | undefined> {
  if (login.idpName !== BUILTIN_WORKOS_IDP_NAME || login.clientCredentials) return undefined
  return activateAccount(login.identityName, selection).catch(
    (): AccountActivation => 'unavailable',
  )
}

async function activateAccount(
  identityName: string,
  selection: AdminSelection,
): Promise<AccountActivation> {
  const admin = await resolveAdminTarget(selection, await readConfig())
  const kernel = new URL(admin.kernelIssuer)
  const endpoint = adminEndpoint(admin.domainIssuer, '/v1/account-activation')
  if (!isKernelAudience(kernel) || endpoint === undefined) return 'unavailable'
  const missing = () => new Error('No primary credential for the Admin audience is available.')
  // An Admin bookmark's CA file covers these requests as it covers the Admin connection.
  const fetch = admin.caFile ? fetchWithCaFile(admin.caFile) : globalThis.fetch
  try {
    return await requestAccountActivation(
      {
        endpoint: endpoint.href,
        instanceOrigin: kernel.origin,
        credential: () => primaryCredential(identityName, kernel.href, undefined, missing),
        registered: (credential, signal) => kernelKnows(kernel.href, credential, signal, fetch),
      },
      { fetch, sleep: wait },
    )
  } catch (cause) {
    // WorkOS issues no Admin credential to an account outside Admin's organization.
    if (classifyRefreshFailure(cause) === 'org-rejected') return 'unregistered'
    throw cause
  }
}

/**
 * Whether the Kernel knows the Identity this primary credential names. It refuses an unknown
 * account with 2002; any other failure proves nothing about registration.
 */
export async function kernelKnows(
  kernel: string,
  credential: string,
  signal: AbortSignal,
  fetch: Fetch = globalThis.fetch,
): Promise<boolean> {
  const session = new ClientSession({
    kernel,
    fetch,
    timeoutMs: 15_000,
    policy: { maximumRouteAgeMs: 30_000 },
    auth: { ttlSeconds: 30, resolve: () => ({ credential }) },
  })
  try {
    await session.auth.whoami({ signal })
    return true
  } catch (error) {
    return !credentialRefused(error)
  } finally {
    session.close()
  }
}

/**
 * One bounded resume; only a registration still in progress is retried, after Admin's delay. Once
 * Admin answers `ready`, its Kernel says whether it knows the account.
 */
export async function requestAccountActivation(
  request: ActivationRequest & {
    readonly registered: (credential: string, signal: AbortSignal) => Promise<boolean>
  },
  dependencies: { fetch: Fetch; sleep: (ms: number) => Promise<void> } = {
    fetch: globalThis.fetch,
    sleep: wait,
  },
): Promise<AccountActivation> {
  const token = await request.credential()
  const signal = AbortSignal.timeout(60_000)
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await post(dependencies.fetch, request, token, signal)
    } catch {
      return 'unavailable'
    }
    if (response.status === 200) {
      if (!ready.safeParse(await response.json().catch(() => undefined)).success)
        return 'unavailable'
      return (await request.registered(token, signal)) ? 'ready' : 'unregistered'
    }
    const code = await response
      .json()
      .then((body: unknown) => (body as { code?: unknown } | null)?.code)
      .catch(() => undefined)
    if (response.status === 401) return 'rejected'
    if (response.status === 403) return 'denied'
    if (response.status !== 503 || code !== 'ACCOUNT_ACTIVATION_PENDING') return 'unavailable'
    if (attempt === ACCOUNT_ATTEMPTS) return 'pending'
    const delay = Number(response.headers.get('retry-after'))
    await dependencies.sleep(
      Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1_000, MAXIMUM_RETRY_DELAY_MS) : 1_000,
    )
    if (signal.aborted) return 'pending'
  }
}

// --- Owner activation of a created Instance ----------------------------------------------------

const completion = z.strictObject({
  status: z.literal('completed'),
  user: z.string().min(1).max(256),
})
export type InstanceActivation = z.infer<typeof completion>

/** Finish Admin's retained owner activation with the selected human's child-audience proof. */
export async function activateInstance(
  instance: InstanceInfo,
  options: KernelCommandOpts & AdminTargetCommandOpts,
): Promise<InstanceActivation> {
  const identityRequired = (message: string) =>
    new AstraleError('OWNER_ACTIVATION_IDENTITY_REQUIRED', message)
  if (options.creds)
    throw identityRequired(
      'Select the WorkOS identity with --as; an Admin bearer cannot activate a child audience.',
    )
  if (instance.state !== 'ready' || !instance.organizationId)
    throw new AstraleError(
      'OWNER_ACTIVATION_NOT_READY',
      'The Instance is not ready for owner activation.',
    )
  const identities = await readIdentities()
  const name = options.as ?? identities.default
  if (identities.identities[name]?.source !== 'idp')
    throw identityRequired('Owner activation requires a WorkOS identity.')
  const admin = await resolveAdminTarget(options, await readConfig())
  const target = new URL(instance.issuer ?? instance.url)
  if (!isKernelAudience(target))
    throw new AstraleError(
      'OWNER_ACTIVATION_TARGET_INVALID',
      'The Instance has no canonical HTTPS Kernel audience.',
    )
  const endpoint = adminEndpoint(admin.domainIssuer, '/v1/owner-activation')
  if (endpoint === undefined)
    throw new AstraleError(
      'OWNER_ACTIVATION_TARGET_INVALID',
      'Admin activation requires a configured HTTPS Domain issuer.',
    )
  const { organizationId } = instance
  return activateOwner({
    endpoint: endpoint.href,
    instanceOrigin: target.origin,
    credential: () =>
      primaryCredential(name, target.href, organizationId, () =>
        identityRequired('No primary credential for the Instance audience is available.'),
      ),
    whoami: async (token, signal) => {
      const session = new ClientSession({
        kernel: target.href,
        timeoutMs: 15_000,
        policy: { maximumRouteAgeMs: 30_000 },
        auth: { ttlSeconds: 30, resolve: () => ({ credential: token }) },
      })
      try {
        return (await session.auth.whoami({ signal })).id
      } finally {
        session.close()
      }
    },
  })
}

/** Finalize one retained owner, then verify it. A new create invocation owns recovery. */
export async function activateOwner(
  request: ActivationRequest & {
    readonly whoami: (credential: string, signal: AbortSignal) => Promise<string>
  },
  dependencies: { fetch: Fetch } = { fetch: globalThis.fetch },
): Promise<InstanceActivation> {
  const token = await request.credential()
  const signal = AbortSignal.timeout(120_000)
  let response: Response
  try {
    response = await post(dependencies.fetch, request, token, signal)
  } catch {
    throw new AstraleError(
      'OWNER_ACTIVATION_UNAVAILABLE',
      'The Instance exists, but owner access could not be confirmed.',
    )
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new AstraleError(
      response.status === 503
        ? 'OWNER_ACTIVATION_UNAVAILABLE'
        : response.status === 401
          ? 'OWNER_ACTIVATION_REJECTED'
          : 'OWNER_ACTIVATION_PROTOCOL_INVALID',
      'Admin could not confirm this owner activation.',
    )
  }
  const result = completion.safeParse(await response.json().catch(() => undefined))
  if (!result.success)
    throw new AstraleError(
      'OWNER_ACTIVATION_PROTOCOL_INVALID',
      'Admin returned an invalid activation receipt.',
    )
  if ((await request.whoami(token, signal)) !== result.data.user)
    throw new AstraleError(
      'OWNER_ACTIVATION_IDENTITY_MISMATCH',
      'The activated owner does not match the authenticated Instance identity.',
    )
  return result.data
}
