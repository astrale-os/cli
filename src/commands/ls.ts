import type { KernelCommandOpts } from '../kernel'

import { withKernelClient, formatKernelError } from '../kernel'
import { spinner } from '../lib/log'
import { output } from '../lib/output'

export async function lsCommand(path: string, opts: KernelCommandOpts): Promise<void> {
  const isRaw = opts.raw || opts.json || !(process.stdout.isTTY ?? false)
  const spin = !isRaw ? spinner(`Listing ${path}...`) : null
  const method = `${path}:listChildren`

  try {
    const result = await withKernelClient(opts, (ctx) =>
      ctx.client.call(method, {}, ctx.credential),
    )

    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? [])
    spin?.succeed(`Children of ${path} (${Array.isArray(items) ? items.length : '?'})`)
    if (!isRaw) console.log('')
    output(result, opts)
    process.exit(0)
  } catch (error) {
    if (!isRaw && spin) spin.fail('Failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}
