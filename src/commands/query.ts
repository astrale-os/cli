import chalk from 'chalk'

import type { KernelCommandOpts } from '../kernel'

import { withKernelClient, formatKernelError } from '../kernel'
import { formatElapsed } from '../lib/format'
import { spinner } from '../lib/log'
import { output } from '../lib/output'

const QUERY_METHOD = '/kernel.astrale.ai/Root/query'

export async function queryCommand(cypher: string, opts: KernelCommandOpts): Promise<void> {
  const isRaw = opts.raw || opts.json || !(process.stdout.isTTY ?? false)
  const spin = !isRaw ? spinner('Running query...') : null
  const startTime = performance.now()

  try {
    const result = await withKernelClient(opts, (ctx) =>
      ctx.client.call(QUERY_METHOD, { cypher }, ctx.credential),
    )
    const elapsed = performance.now() - startTime

    spin?.succeed(`Query completed in ${chalk.dim(formatElapsed(elapsed))}`)
    if (!isRaw) console.log('')
    output(result, opts)
    process.exit(0)
  } catch (error) {
    if (!isRaw && spin) spin.fail('Query failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}
