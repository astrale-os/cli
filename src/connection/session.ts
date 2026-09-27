import type { AuthApi } from '@astrale-os/sdk/auth'
import type { GraphApi } from '@astrale-os/sdk/client'
import type {
  ClientSessionOptions,
  SessionAuth,
  SessionRouteStore,
} from '@astrale-os/sdk/client/session'

import { createGraph } from '@astrale-os/sdk/client'
import { ClientSession } from '@astrale-os/sdk/client/session'

import type { AstraleConfig } from '../lib/config'
import type { AdminConnectionOptions, ConnectionOptions, ConnectionTarget } from './target'

import {
  AdminInstanceNotFoundError,
  connectAdminInstances,
  findOwnedInstance,
  type InstanceInfo,
} from '../admin/instance'
import { AstraleError } from '../errors'
import { fetchWithCaFile } from '../lib/ca-fetch'
import { readConfig } from '../lib/config'
import { log } from '../lib/log'
import { isMachine } from '../lib/output'
import { DOMAIN_ISSUER_CACHE, type DomainIssuerCache } from '../state/domain-issuers'
import { SESSION_ROUTE_STORE } from '../state/session-routes'
import { bindCredentialIdentity } from './auth'
import { callableOrigin, resolveCallableTarget, withCallableIssuer } from './callable-target'
import {
  createCliCredential,
  type CredentialIntent,
  validateCredentialSelection,
} from './credential'
import { resolveAdminConnectionTarget, resolveConnectionTarget } from './target'

const DEFAULT_TIMEOUT_MS = 30_000
const MAXIMUM_ROUTE_AGE_MS = 5 * 60_000

function warnMissingExplicitTarget(options: ConnectionOptions, target: ConnectionTarget): void {
  if (options.instance !== undefined || options.url !== undefined) return
  if (!isMachine(options)) return
  log.warn(`No -i/--url; using ${target.slug ?? target.url}`)
}

export interface ConnectionContext {
  readonly session: ClientSession
  readonly graph: GraphApi
  readonly auth: AuthApi
  /** Resolve the selected identity before any Domain credential exchange. */
  readonly self: () => Promise<{ readonly id: string }>
  readonly target: ConnectionTarget
  /** Local identity label selected for this session; absent for raw credentials or anonymous use. */
  readonly identity?: string
}

interface OwnedConnection {
  readonly context: ConnectionContext
  close(): void
}

export type ConnectionFactory = (
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
  config: AstraleConfig,
  credential?: CredentialIntent,
) => OwnedConnection

/** Resolve one ordinary target, run a command action, then close terminally. */
export async function withClientSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
  credential: CredentialIntent = {},
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const config = await readConfig()
  const target = await resolveConnectionTarget(options, config, {
    managed: (slug) => lookupManagedInstance(slug, options),
  })
  options = await bindCredentialIdentity(options, target)
  warnMissingExplicitTarget(options, target)
  return runResolvedClientSession(
    target,
    timeoutMs,
    options,
    config,
    action,
    openConnection,
    credential,
    DOMAIN_ISSUER_CACHE,
  )
}

/** Resolve the configured Admin Domain target under the same terminal lifecycle. */
export async function withAdminClientSession<Value>(
  options: AdminConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const config = await readConfig()
  const target = await resolveAdminConnectionTarget(options, config)
  options = await bindCredentialIdentity(options, target)
  return runResolvedClientSession(target, timeoutMs, options, config, action, openConnection)
}

/** Owner-private seam used to prove validation order and cleanup without network I/O. */
export async function withResolvedClientSession<Value>(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
  action: (context: ConnectionContext) => Promise<Value>,
  open: ConnectionFactory = openConnection,
  credential: CredentialIntent = {},
  issuers?: DomainIssuerCache,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  return runResolvedClientSession(
    target,
    timeoutMs,
    options,
    config,
    action,
    open,
    credential,
    issuers,
  )
}

async function runResolvedClientSession<Value>(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
  config: AstraleConfig,
  action: (context: ConnectionContext) => Promise<Value>,
  open: ConnectionFactory,
  credential: CredentialIntent = {},
  issuers?: DomainIssuerCache,
): Promise<Value> {
  let remembered: string | undefined
  if (credential.principal === 'callable') {
    const origin = callableOrigin(credential.path)
    if (
      options.creds !== undefined ||
      options.anonymous === true ||
      origin === undefined ||
      origin === 'kernel.astrale.ai'
    ) {
      credential = { principal: 'caller' }
    } else {
      const known = await rememberedIssuer(issuers, target.kernelIssuer, origin)
      if (known !== undefined) {
        target = withCallableIssuer(target, known ?? undefined)
        remembered = origin
      } else {
        const discovery = open(target, timeoutMs, options, config, { principal: 'caller' })
        try {
          target = await resolveCallableTarget(target, origin, discovery.context.session.schema)
        } finally {
          discovery.close()
        }
        await issuers
          ?.set(target.kernelIssuer, origin, target.domainIssuer ?? null)
          .catch(() => undefined)
      }
      credential =
        target.domainIssuer === undefined ? { principal: 'caller' } : { principal: 'domain' }
    }
  }
  const connection = open(target, timeoutMs, options, config, credential)
  try {
    return await action(connection.context)
  } catch (error) {
    // A remembered issuer is re-read after any failure, so a reinstalled Domain heals in one step.
    if (remembered !== undefined) {
      await issuers?.delete(target.kernelIssuer, remembered).catch(() => undefined)
    }
    if (error instanceof Error) (error as Error & { url?: string }).url = target.url
    throw error
  } finally {
    connection.close()
  }
}

/** A cache that cannot be read is a miss: installation state must never fail a command. */
async function rememberedIssuer(
  issuers: DomainIssuerCache | undefined,
  kernelIssuer: string,
  origin: string,
): Promise<string | null | undefined> {
  try {
    return await issuers?.get(kernelIssuer, origin)
  } catch {
    return undefined
  }
}

export function resolveTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS
  if (!/^\d+$/.test(raw)) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --timeout value "${raw}" — expected a positive integer (milliseconds)`,
    )
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --timeout value "${raw}" — must be a positive integer`,
    )
  }
  return value
}

function openConnection(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
  config: AstraleConfig,
  credential: CredentialIntent = {},
): OwnedConnection {
  const fetch = target.caFile === undefined ? globalThis.fetch : fetchWithCaFile(target.caFile)
  const auth = createCliCredential(target, options, config, fetch, timeoutMs, credential)
  const session = new ClientSession(createClientSessionOptions(target, fetch, auth, timeoutMs))
  const graph = createGraph((call, request) => session.call(call, request))
  return {
    context: Object.freeze({
      session,
      graph,
      auth: session.auth,
      self: () =>
        withResolvedClientSession(
          target,
          options,
          config,
          (caller) => caller.auth.whoami(),
          openConnection,
          { principal: 'caller' },
        ),
      target,
      ...(options.as === undefined ? {} : { identity: options.as }),
    }),
    close() {
      session.close()
    },
  }
}

/** Owner-private construction seam proving that transport and source identity stay distinct. */
export function createClientSessionOptions(
  target: ConnectionTarget,
  fetch: NonNullable<ClientSessionOptions['fetch']>,
  auth: SessionAuth | undefined,
  timeoutMs: number,
  routeStore: SessionRouteStore = SESSION_ROUTE_STORE,
): ClientSessionOptions {
  return {
    kernel: target.kernelIssuer,
    fetch,
    ...(auth === undefined ? {} : { auth }),
    routeStore,
    policy: {
      maximumRouteAgeMs: MAXIMUM_ROUTE_AGE_MS,
      ...(new URL(target.url).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
    },
    envelopeTransport: 'http',
    timeoutMs,
  }
}

export async function lookupManagedInstance(
  slug: string,
  options: ConnectionOptions,
  openAdmin: typeof withAdminClientSession = withAdminClientSession,
  connect: typeof connectAdminInstances = connectAdminInstances,
): Promise<InstanceInfo> {
  return openAdmin(
    Object.freeze(options.timeout === undefined ? {} : { timeout: options.timeout }),
    async (context) => {
      const found = findOwnedInstance(await (await connect(context)).list(), slug)
      if (found === undefined) throw new AdminInstanceNotFoundError(slug)
      return found
    },
  )
}
