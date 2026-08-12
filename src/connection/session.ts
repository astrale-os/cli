import type { AuthApi } from '@astrale-os/kernel-client/auth'
import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type {
  HostCredential,
  HostSession as HostSessionValue,
  HostSessionOptions,
} from '@astrale-os/kernel-client/host'

import { Client, pathCall } from '@astrale-os/kernel-client'
import { createAuth } from '@astrale-os/kernel-client/auth'
import { createGraph } from '@astrale-os/kernel-client/graph'
import { HostSession } from '@astrale-os/kernel-client/host'

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
import { createCliCredential, validateCredentialSelection } from './credential'
import { resolveAdminConnectionTarget, resolveConnectionTarget } from './target'

const DEFAULT_TIMEOUT_MS = 30_000
const MAXIMUM_ROUTE_AGE_MS = 5 * 60_000

export interface ConnectionContext {
  readonly host: HostSessionValue
  readonly graph: GraphApi
  readonly auth: AuthApi
  readonly target: ConnectionTarget
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
) => OwnedConnection

/** Resolve one ordinary target, run a command action, then close terminally. */
export async function withHostSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const config = await readConfig()
  const target = await resolveConnectionTarget(options, config, {
    managed: (slug) => lookupManagedInstance(slug, options),
  })
  return runResolvedHostSession(target, timeoutMs, options, config, action, openConnection)
}

/** Resolve the configured Admin Domain target under the same terminal lifecycle. */
export async function withAdminHostSession<Value>(
  options: AdminConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const config = await readConfig()
  const target = await resolveAdminConnectionTarget(options, config)
  return runResolvedHostSession(target, timeoutMs, options, config, action, openConnection)
}

/** Owner-private seam used to prove validation order and cleanup without network I/O. */
export async function withResolvedHostSession<Value>(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
  action: (context: ConnectionContext) => Promise<Value>,
  open: ConnectionFactory = openConnection,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  return runResolvedHostSession(target, timeoutMs, options, config, action, open)
}

async function runResolvedHostSession<Value>(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
  config: AstraleConfig,
  action: (context: ConnectionContext) => Promise<Value>,
  open: ConnectionFactory,
): Promise<Value> {
  const connection = open(target, timeoutMs, options, config)
  try {
    return await action(connection.context)
  } catch (error) {
    if (error instanceof Error) (error as Error & { url?: string }).url = target.url
    throw error
  } finally {
    connection.close()
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
): OwnedConnection {
  const fetch = target.caFile === undefined ? globalThis.fetch : fetchWithCaFile(target.caFile)
  const sourceClient = new Client({ url: target.url, fetch, timeoutMs })
  const credential = createCliCredential(target, options, config, sourceClient)
  const host = new HostSession(createHostSessionOptions(target, fetch, credential, timeoutMs))
  const graph = createGraph((call, request) => host.call(call, request))
  const auth = createAuth((path, input, request) => host.call(pathCall(path, input), request))
  return {
    context: Object.freeze({ host, graph, auth, target }),
    close() {
      try {
        host.close()
      } finally {
        sourceClient.close()
      }
    },
  }
}

/** Owner-private construction seam proving that transport and source identity stay distinct. */
export function createHostSessionOptions(
  target: ConnectionTarget,
  fetch: NonNullable<HostSessionOptions['fetch']>,
  credential: HostCredential | undefined,
  timeoutMs: number,
): HostSessionOptions {
  return {
    url: target.url,
    sourceIssuer: target.issuer,
    fetch,
    ...(credential === undefined ? {} : { credential }),
    policy: {
      maximumRouteAgeMs: MAXIMUM_ROUTE_AGE_MS,
      ...(new URL(target.url).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
    },
    protocol: 'envelope',
    envelopeTransport: 'http',
    timeoutMs,
  }
}

export async function lookupManagedInstance(
  slug: string,
  options: ConnectionOptions,
  openAdmin: typeof withAdminHostSession = withAdminHostSession,
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
