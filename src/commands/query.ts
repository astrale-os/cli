import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'

const QUERY_METHOD = '/kernel.astrale.ai/class.Root/query'

export async function queryCommand(cypher: string, opts: KernelCommandOpts): Promise<void> {
  await runKernelCommand({
    opts,
    label: 'Query',
    fn: (ctx) => ctx.client.call(QUERY_METHOD, { cypher }, ctx.credential),
  })
}
