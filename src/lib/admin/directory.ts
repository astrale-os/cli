import { z } from 'zod'

import type { AstraleConfig } from '../config'
import type { AdminTargetCommandOpts } from './target'

import { AstraleError } from '../../errors'
import { getDefault, getIdentity } from '../../identity/registry'
import { readConfig } from '../config'
import { accessTokenForAudience, classifyRefreshFailure } from '../idp/provider'
import { ensureFreshSession, IdpSessionCopiedError } from '../idp/session'
import { resolveAdminTarget } from './target'

/**
 * "My instances": the instances of the organizations the signed-in user belongs to, as the Admin
 * Worker reads them from the identity provider (WorkOS). It needs no Admin account and no Admin
 * Kernel, so anyone signed in can list their instances and name one by its slug. State, Node ids,
 * Fleets and ownership stay in the Admin inventory (`instance list --admin-only`, `--fleet`).
 */
export interface DirectoryInstance {
  readonly organizationId: string
  /** The organization's name in the identity provider. */
  readonly name: string
  /** The instance's public origin, e.g. https://pace.eu.astrale.ai. */
  readonly url: string
  readonly slug: string
  readonly region?: string
}

export interface InstanceDirectory {
  readonly instances: readonly DirectoryInstance[]
  /** True when the user belongs to more organizations than one read returns. */
  readonly truncated: boolean
}

export interface DirectoryReadOptions extends AdminTargetCommandOpts {
  /** Local identity whose sign-in is used; the default identity when absent. */
  readonly as?: string
  readonly timeout?: string
}

export interface DirectoryDependencies {
  readonly config?: AstraleConfig
  /** The Admin Domain issuer whose origin serves the directory; the resolved Admin target's by default. */
  readonly domainIssuer?: () => Promise<string>
  readonly fetch?: typeof fetch
  /** A current access token of the identity, of any organization. */
  readonly token?: (identity: string | undefined) => Promise<string>
}

/** Served by the Admin Worker at the Admin Domain issuer's origin. */
export const DIRECTORY_PATH = '/directory/instances'

const DEFAULT_TIMEOUT_MS = 30_000
const TOKEN_MINIMUM_SECONDS = 60

const ListingSchema = z.object({
  instances: z.array(
    z.object({
      organizationId: z.string().regex(/^org_[A-Za-z0-9_]+$/u),
      name: z.string(),
      url: z.string().refine(isHttpsOrigin, 'expected an https origin'),
      slug: z.string().min(1).max(63),
      region: z.string().min(1).optional(),
    }),
  ),
  truncated: z.boolean(),
})

/**
 * Read the signed-in user's instances. Failures are `AstraleError`s with a code callers can tell
 * apart: `DIRECTORY_IDENTITY_UNSUPPORTED` (a key identity, no sign-in), `DIRECTORY_SIGN_IN_REQUIRED`
 * and `DIRECTORY_IDENTITY_REJECTED` (sign in again), `DIRECTORY_RATE_LIMITED`, and
 * `DIRECTORY_UNAVAILABLE` (Admin Worker or network). The token is sent to the Admin Worker only and
 * never printed or stored.
 */
export async function readInstanceDirectory(
  options: DirectoryReadOptions = {},
  dependencies: DirectoryDependencies = {},
): Promise<InstanceDirectory> {
  const domainIssuer =
    dependencies.domainIssuer ??
    (async () =>
      (await resolveAdminTarget(options, dependencies.config ?? (await readConfig()))).domainIssuer)
  const endpoint = directoryEndpoint(await domainIssuer())
  const token = await (dependencies.token ?? directoryToken)(options.as)
  const fetchImpl = dependencies.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs(options.timeout)),
    })
  } catch (cause) {
    throw unavailable(`The instance directory at ${endpoint.origin} could not be reached.`, cause)
  }
  if (response.status === 401) {
    throw new AstraleError(
      'DIRECTORY_IDENTITY_REJECTED',
      'Astrale did not accept your sign-in for the instance directory.',
      'Run `astrale auth login` again. An account that belongs to no organization has no instances to list.',
    )
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'))
    const wait = Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : 60
    throw new AstraleError(
      'DIRECTORY_RATE_LIMITED',
      'Too many instance directory reads for this account.',
      `Retry in ${wait} seconds. Bookmarks and instance URLs still work meanwhile.`,
    )
  }
  if (!response.ok) {
    throw unavailable(`The instance directory answered HTTP ${response.status}.`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw unavailable('The instance directory answered with invalid JSON.', cause)
  }
  const parsed = ListingSchema.safeParse(body)
  if (!parsed.success) throw unavailable('The instance directory answered an unexpected listing.')
  return Object.freeze({
    instances: Object.freeze(
      parsed.data.instances.map((entry) =>
        Object.freeze({
          organizationId: entry.organizationId,
          name: entry.name,
          url: entry.url,
          slug: entry.slug,
          ...(entry.region === undefined ? {} : { region: entry.region }),
        }),
      ),
    ),
    truncated: parsed.data.truncated,
  })
}

/** The instance a slug names in the directory; two instances with one slug are refused. */
export function findDirectoryInstance(
  directory: InstanceDirectory,
  slug: string,
): DirectoryInstance | undefined {
  const matches = directory.instances.filter((instance) => instance.slug === slug)
  if (matches.length > 1) {
    throw new AstraleError(
      'INSTANCE_AMBIGUOUS',
      `Several of your instances are named ${JSON.stringify(slug)}.`,
      `Pass the instance URL instead: ${matches.map((instance) => instance.url).join(', ')}.`,
    )
  }
  return matches[0]
}

/** Whether a directory failure means the identity has no sign-in the directory accepts at all. */
export function isDirectoryIdentityUnsupported(error: unknown): boolean {
  return error instanceof AstraleError && error.code === 'DIRECTORY_IDENTITY_UNSUPPORTED'
}

function directoryEndpoint(domainIssuer: string): URL {
  const origin = new URL(domainIssuer)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) {
    throw new AstraleError(
      'DIRECTORY_UNAVAILABLE',
      `The Admin Domain issuer ${domainIssuer} is not an https origin.`,
      'Check the configured Admin target (`--domain-issuer`, or `admin` in the CLI config).',
    )
  }
  return new URL(DIRECTORY_PATH, origin.origin)
}

/**
 * A current access token of the identity's sign-in, whatever organization it was issued for: the
 * directory takes the user from it. A refresh, when needed, keeps the session's organization.
 */
async function directoryToken(name: string | undefined): Promise<string> {
  const identity = name === undefined ? await getDefault() : { ...(await getIdentity(name)), name }
  if (identity.source !== 'idp') {
    throw new AstraleError(
      'DIRECTORY_IDENTITY_UNSUPPORTED',
      `Identity "${identity.name}" is a local key, not an Astrale sign-in, so it has no instance directory.`,
      'Run `astrale auth login`, or name the instance by its URL or a bookmark.',
    )
  }
  let session
  try {
    session = await ensureFreshSession(identity.name, {
      minimumRemainingSeconds: TOKEN_MINIMUM_SECONDS,
    })
  } catch (cause) {
    if (cause instanceof IdpSessionCopiedError) throw cause
    if (classifyRefreshFailure(cause) === 'transient') {
      throw unavailable(
        'The identity provider could not be reached to refresh your sign-in.',
        cause,
      )
    }
    throw new AstraleError(
      'DIRECTORY_SIGN_IN_REQUIRED',
      `The sign-in of "${identity.name}" has ended or is missing.`,
      `Run: astrale auth login --name ${identity.name}`,
      { cause },
    )
  }
  const token = accessTokenForAudience(session, undefined, TOKEN_MINIMUM_SECONDS * 1_000)
  if (token === undefined) {
    throw new AstraleError(
      'DIRECTORY_SIGN_IN_REQUIRED',
      `The sign-in of "${identity.name}" holds no current access token.`,
      `Run: astrale auth login --name ${identity.name}`,
    )
  }
  return token
}

function unavailable(message: string, cause?: unknown): AstraleError {
  return new AstraleError(
    'DIRECTORY_UNAVAILABLE',
    message,
    'Bookmarks and instance URLs still work: `astrale instance list --bookmarked`, or `--url <instance-url>`.',
    cause === undefined ? undefined : { cause },
  )
}

function timeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}
