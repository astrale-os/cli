import type { Fetch } from '@astrale-os/sdk/client'

import { z } from 'zod'

import { resolveAdminTarget } from './admin-target'
import { readConfig } from './config'
import { accessTokenForAudience, BUILTIN_WORKOS_IDP_NAME, classifyRefreshFailure } from './idp'
import { ensureFreshSession } from './idp-session'

/**
 * `ready`: nothing is left to complete on Admin; it grants nothing and does not prove registration.
 * `rejected`: Admin refused this login itself. `denied`: Admin refused the pending admission.
 */
export type AccountActivation = 'ready' | 'pending' | 'rejected' | 'denied' | 'unavailable'

/** What a user should do when a login could not complete prepared access. */
export const ACCOUNT_ACTIVATION_WARNINGS = {
  pending: 'Astrale access is still being completed. Run `astrale auth login` again in a moment.',
  rejected:
    'Astrale Admin did not accept this login, so no prepared access was completed. Check that this is the invited WorkOS account.',
  denied: 'Astrale Admin refused the access prepared for this account. Ask an administrator.',
  unavailable:
    'Astrale Admin could not be reached to complete prepared access. Run `astrale auth login` again later.',
} satisfies Record<Exclude<AccountActivation, 'ready'>, string>

const ready = z.strictObject({ status: z.literal('ready') })
const ATTEMPTS = 3
const MAXIMUM_RETRY_DELAY_MS = 5_000

/**
 * A human login through the built-in WorkOS IdP completes Admin's prepared access; other logins
 * hold none there. The login itself never fails because of it.
 */
export async function activateLoggedInAccount(login: {
  readonly identityName: string
  readonly idpName: string
  readonly clientCredentials?: boolean
}): Promise<AccountActivation | undefined> {
  if (login.idpName !== BUILTIN_WORKOS_IDP_NAME || login.clientCredentials) return undefined
  return activateAccount(login.identityName).catch((): AccountActivation => 'unavailable')
}

/** Resume what an administrator prepared for this WorkOS account on Admin, such as a Fleet invitation. */
export async function activateAccount(identityName: string): Promise<AccountActivation> {
  const admin = await resolveAdminTarget({}, await readConfig())
  const kernel = new URL(admin.kernelIssuer)
  const endpoint = new URL('/v1/account-activation', admin.domainIssuer)
  if (
    kernel.protocol !== 'https:' ||
    kernel.href !== `${kernel.origin}/api` ||
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password
  )
    return 'unavailable'
  try {
    return await requestAccountActivation({
      endpoint: endpoint.href,
      instanceOrigin: kernel.origin,
      credential: async () => {
        const session = await ensureFreshSession(identityName, {
          audience: kernel.href,
          minimumRemainingSeconds: 150,
        })
        const token = accessTokenForAudience(session, kernel.href)
        if (!token) throw new Error('No primary credential for the Admin audience is available.')
        return token
      },
    })
  } catch (cause) {
    // An account outside Admin's organization holds nothing there for a login to complete.
    if (classifyRefreshFailure(cause) === 'org-rejected') return 'ready'
    throw cause
  }
}

/** One bounded resume; only a registration still in progress is retried, after Admin's delay. */
export async function requestAccountActivation(
  input: {
    readonly endpoint: string
    readonly instanceOrigin: string
    readonly credential: () => Promise<string>
  },
  dependencies: { fetch: Fetch; sleep: (ms: number) => Promise<void> } = {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
): Promise<AccountActivation> {
  const token = await input.credential()
  // Token rotation has its own locked lifecycle; start the request budget afterward.
  const signal = AbortSignal.timeout(60_000)
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await dependencies.fetch(input.endpoint, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ instanceOrigin: input.instanceOrigin }),
      })
    } catch {
      return 'unavailable'
    }
    if (response.status === 200)
      return ready.safeParse(await response.json().catch(() => undefined)).success
        ? 'ready'
        : 'unavailable'
    const code = await response
      .json()
      .then((body: unknown) => (body as { code?: unknown } | null)?.code)
      .catch(() => undefined)
    if (response.status === 401) return 'rejected'
    if (response.status === 403) return 'denied'
    if (response.status !== 503 || code !== 'ACCOUNT_ACTIVATION_PENDING') return 'unavailable'
    if (attempt === ATTEMPTS) return 'pending'
    const delay = Number(response.headers.get('retry-after'))
    await dependencies.sleep(
      Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1_000, MAXIMUM_RETRY_DELAY_MS) : 1_000,
    )
    if (signal.aborted) return 'pending'
  }
}
