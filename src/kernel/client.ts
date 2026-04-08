import { KernelClient, type FnMap } from '@astrale-os/kernel-client'

import type { KernelCommandOpts } from './types'

import { readConfig } from '../lib/config'
import { resolveKernelUrl } from '../lib/instance'
import { resolveCredential } from './auth'

export type ClientContext = {
  client: KernelClient<FnMap>
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
  const url = await resolveKernelUrl(opts, config)
  const credential = await resolveCredential(opts, config)

  const client = new KernelClient<FnMap>({
    url,
    requestTimeout: parseInt(opts.timeout ?? '30000', 10),
  })

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
