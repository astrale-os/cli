import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'

import type { KernelCommandOpts } from './types'

import { AstraleError } from '../errors'
import { resolveAdminTarget, type AdminTargetCommandOpts } from '../lib/admin-target'
import { readConfig } from '../lib/config'
import { getActive, resolveInstance } from '../lib/instance'
import { resolveCredential } from './auth'
import { fetchWithCaFile } from './ca-fetch'
import { mintRemoteCredential } from './remote-routing'

const DEFAULT_TIMEOUT_MS = 30_000

export type ClientContext = {
  /** High-level call surface — bound to `credential` via ClientSession.identity. */
  client: ClientSession<FnMap>
  credential: string
  url: string
  config: Awaited<ReturnType<typeof readConfig>>
}

type ResolvedKernelTarget = {
  url: string
  audience: string
  slug?: string
  defaultIdentity?: string
  caFile?: string
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
  // Ad-hoc `--url` — unknown kernel. Stamp the URL itself as audience,
  // no slug for per-instance signing.
  let url: string
  let audience: string
  let slug: string | undefined
  if (opts.url && !opts.instance) {
    url = opts.url
    audience = opts.url
    slug = undefined
  } else {
    const identifier = opts.instance ?? (await getActive(config)).name
    const resolved = await resolveInstance(identifier, config)
    url = opts.url ?? resolved.url
    audience = resolved.issuer ?? resolved.url
    slug = resolved.name
    return withResolvedKernelClient(
      opts,
      config,
      { url, audience, slug, defaultIdentity: resolved.defaultIdentity, caFile: resolved.caFile },
      fn,
    )
  }
  return withResolvedKernelClient(opts, config, { url, audience, slug }, fn)
}

export async function withAdminKernelClient<T>(
  opts: KernelCommandOpts & AdminTargetCommandOpts,
  fn: (ctx: ClientContext) => Promise<T>,
): Promise<T> {
  const config = await readConfig()
  const target = await resolveAdminTarget(opts, config)
  return withResolvedKernelClient(
    opts,
    config,
    {
      url: target.url,
      audience: target.issuer,
      slug: target.registrationSlug,
      defaultIdentity: target.defaultIdentity,
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
  // The delegation mint references `client` lazily — it only fires on a cache
  // miss during an actual remote call, long after this binding is initialised,
  // so the self-reference inside the closure is safe.
  const client: ClientSession<FnMap> = new ClientSession<FnMap>({
    default: target.url,
    identity: credential,
    // Remote-bound functions redirect to a worker that verifies `aud` against
    // its own identity. The session follows the redirect and mints a worker-
    // scoped delegation here, for the audience the kernel carries on the
    // redirect (`redirection.iss`, surfaced by the default iss-aware policy).
    delegation: {
      mint: async (audience) => ({
        credential: await mintRemoteCredential(client, audience, credential),
        ttl: 3600,
      }),
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
