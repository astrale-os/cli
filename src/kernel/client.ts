import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import { ClientSession, delegationMintVia } from '@astrale-os/kernel-client/session'

import type { AdminTargetCommandOpts } from '../lib/admin-target'
import type { KernelCommandOpts } from './types'

import { AstraleError } from '../errors'
import {
  callOwnedInstances,
  findOwnedInstance,
  type InstanceInfo,
  type OwnedInstanceInfo,
} from '../lib/admin-instance'
import { readConfig } from '../lib/config'
import { resolveInstanceTarget, type ResolvedInstanceTarget } from '../lib/instance-target'
import { resolveCredential } from './auth'
import { fetchWithCaFile } from './ca-fetch'

const DEFAULT_TIMEOUT_MS = 30_000

export type ClientContext = {
  /** High-level call surface — bound to `credential` via ClientSession.identity. */
  client: ClientSession<FnMap>
  credential: string
  url: string
  config: Awaited<ReturnType<typeof readConfig>>
}

export type ResolvedKernelTarget = {
  url: string
  audience: string
  slug?: string
  defaultIdentity?: string
  caFile?: string
}

/** Resolve the kernel a command targets (`--url` / `-i` / active instance). */
export async function resolveKernelTarget(
  opts: KernelCommandOpts,
  config: Awaited<ReturnType<typeof readConfig>>,
): Promise<ResolvedKernelTarget> {
  // Ad-hoc `--url` — unknown kernel. Stamp the URL itself as audience,
  // no slug for per-instance signing.
  if (opts.url && !opts.instance) {
    const resolved = await resolveInstanceTarget({ source: 'url', url: opts.url }, { config })
    return resolvedToKernelTarget(resolved)
  }
  const resolved = await resolveInstanceTarget(
    opts.instance ? { source: 'name', name: opts.instance } : { source: 'active' },
    {
      config,
      admin: {},
      managed: (slug) => lookupImplicitOwnedInstance(slug, opts),
    },
  )
  return resolvedToKernelTarget(resolved, opts.url)
}

/**
 * Connect to a kernel instance, run `fn`, then disconnect.
 * The new client is lazy: construction does no I/O. We only need to
 * release sockets on the way out.
 */
export async function withKernelClient<T>(
  opts: KernelCommandOpts,
  fn: (ctx: ClientContext) => Promise<T>,
): Promise<T> {
  const config = await readConfig()
  const target = await resolveKernelTarget(opts, config)
  return withResolvedKernelClient(opts, config, target, fn)
}

export async function listOwnedInstances(
  opts: KernelCommandOpts & AdminTargetCommandOpts,
): Promise<OwnedInstanceInfo[]> {
  return await withAdminKernelClient(opts, async (ctx) => callOwnedInstances(ctx.client))
}

export async function lookupOwnedInstance(
  slug: string,
  opts: KernelCommandOpts & AdminTargetCommandOpts,
): Promise<OwnedInstanceInfo> {
  const instance = findOwnedInstance(await listOwnedInstances(opts), slug)
  if (instance) return instance
  throw new AstraleError('INSTANCE_NOT_FOUND', `No owned instance matches "${slug}".`)
}

export type ImplicitOwnedInstanceLookupDependencies = {
  lookupOwned: (
    slug: string,
    opts: KernelCommandOpts & AdminTargetCommandOpts,
  ) => Promise<OwnedInstanceInfo>
}

/**
 * Resolve an implicit managed target through the caller's owner inventory.
 *
 * Target `--as` / `--creds` belong to the eventual child-kernel call. They
 * must not authenticate the admin discovery request: leaving them out lets
 * `withAdminKernelClient` use the admin bookmark's default WorkOS identity.
 */
export async function lookupImplicitOwnedInstance(
  slug: string,
  targetOpts: KernelCommandOpts,
  deps: ImplicitOwnedInstanceLookupDependencies = {
    lookupOwned: lookupOwnedInstance,
  },
): Promise<InstanceInfo> {
  return await deps.lookupOwned(slug, {
    timeout: targetOpts.timeout,
    debug: targetOpts.debug,
  })
}

function resolvedToKernelTarget(
  target: ResolvedInstanceTarget,
  urlOverride?: string,
): ResolvedKernelTarget {
  return {
    url: urlOverride ?? target.url,
    audience: target.issuer,
    slug: target.name,
    defaultIdentity: target.defaultIdentity,
    caFile: target.caFile,
  }
}

export async function withAdminKernelClient<T>(
  opts: KernelCommandOpts & AdminTargetCommandOpts,
  fn: (ctx: ClientContext) => Promise<T>,
): Promise<T> {
  const config = await readConfig()
  const target = await resolveInstanceTarget({ source: 'admin' }, { config, admin: opts })
  return withResolvedKernelClient(
    opts,
    config,
    {
      url: target.url,
      audience: target.issuer,
      slug: target.name,
      defaultIdentity: target.defaultIdentity,
      caFile: target.caFile,
    },
    fn,
  )
}

async function withResolvedKernelClient<T>(
  opts: KernelCommandOpts,
  config: Awaited<ReturnType<typeof readConfig>>,
  target: ResolvedKernelTarget,
  fn: (ctx: ClientContext) => Promise<T>,
): Promise<T> {
  const credential = await resolveCredential(
    { ...opts, defaultIdentity: target.defaultIdentity },
    config,
    target.audience,
    target.slug,
  )

  // CLI is short-lived and one-shot per command. Skip the WS upgrade
  // (saves up to 5s on hangs) and disable HTTP retries (saves ~7s of
  // exponential backoff on ECONNREFUSED / 5xx). The user can re-run.
  const requestTimeout = resolveTimeoutMs(opts.timeout)
  const fetchImpl = target.caFile ? fetchWithCaFile(target.caFile) : undefined
  const client: ClientSession<FnMap> = new ClientSession<FnMap>({
    default: target.url,
    identity: credential,
    delegation: {
      // Resolve lazily: the session must exist before the cache mints.
      mint: delegationMintVia(() => client, credential),
      ttl: 3600,
    },
    pool: {
      clientFactory: (u) =>
        new KernelClient<FnMap>({
          url: u,
          requestTimeout,
          defaultTransport: 'http',
          retry: { maxAttempts: 1 },
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        }),
    },
  })
  await client.ready()

  try {
    return await fn({ client, credential, url: target.url, config })
  } catch (error) {
    // Attach url so formatKernelError can display it in connection errors
    if (error instanceof Error) (error as Error & { url?: string }).url = target.url
    throw error
  } finally {
    client.disconnect()
  }
}

function resolveTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS
  if (!/^\d+$/.test(raw)) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --timeout value "${raw}" — expected a positive integer (milliseconds)`,
    )
  }
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --timeout value "${raw}" — must be a positive integer`,
    )
  }
  return n
}
