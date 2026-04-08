import type { KernelCommandOpts } from '../kernel'

import { withKernelClient, formatKernelError } from '../kernel'
import { spinner } from '../lib/log'
import { isRawOutput, output } from '../lib/output'

export async function getCommand(path: string, opts: KernelCommandOpts): Promise<void> {
  const isRaw = isRawOutput(opts)
  const spin = !isRaw ? spinner(`Getting ${path}...`) : null
  const method = `${path}:get`

  try {
    const result = await withKernelClient(opts, (ctx) =>
      ctx.client.call(method, {}, ctx.credential),
    )

    spin?.succeed(`Node ${path}`)
    if (!isRaw) console.log('')
    output(result, opts)
    process.exit(0)
  } catch (error) {
    if (!isRaw && spin) spin.fail('Failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}
