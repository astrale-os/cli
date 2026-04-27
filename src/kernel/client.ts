import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'

import type { KernelCommandOpts } from './types'

import { AstraleError } from '../errors'
import { readConfig } from '../lib/config'
import { getActive, resolveInstance } from '../lib/instance'
import { resolveCredential } from './auth'

const DEFAULT_TIMEOUT_MS = 30_000

export type ClientContext = {
  /** High-level call surface — bound to `credential` via ClientSession.identity. */
  client: ClientSession<FnMap>
  credential: string
  url: string
  config: Awaited<ReturnType<typeof readConfig>>
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
    slug = identifier
  }
  const credential = await resolveCredential(opts, config, audience, slug)

  // CLI is short-lived and one-shot per command. Skip the WS upgrade
  // (saves up to 5s on hangs) and disable HTTP retries (saves ~7s of
  // exponential backoff on ECONNREFUSED / 5xx). The user can re-run.
  const requestTimeout = resolveTimeoutMs(opts.timeout)
  const client = new ClientSession<FnMap>({
    default: url,
    identity: credential,
    pool: {
      clientFactory: (u) =>
        new KernelClient<FnMap>({
          url: u,
          requestTimeout,
          defaultTransport: 'http',
          retry: { maxAttempts: 1 },
        }),
    },
  })
  await client.ready()

  try {
    const result = await fn({ client, credential, url, config })
    client.disconnect()
    return result
  } catch (error) {
    client.disconnect()
    // Attach url so formatKernelError can display it in connection errors
    if (error instanceof Error) (error as Error & { url?: string }).url = url
    throw error
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
