import { K } from '@astrale-os/kernel-core'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'

export async function queryCommand(cypher: string, opts: KernelCommandOpts): Promise<void> {
  await runKernelCommand({
    opts,
    label: 'Query',
    fn: (ctx) => ctx.client.call(K.$.f('query').path.domain.raw, { cypher }),
  })
}

export default {
  name: 'query',
  description: 'Run a read-only Cypher query against the kernel graph',
  afterHelpText: `
Behavior:
  Read-only. The kernel rejects write keywords (CREATE, DELETE, SET,
  MERGE, REMOVE, DETACH); enforcement is kernel-side.

Examples:
  $ astrale query 'MATCH (n) RETURN count(n) AS total'
  $ astrale query 'MATCH (n:Domain) RETURN n.slug, n.id'
`,
  arguments: [{ name: 'cypher', description: 'Cypher query string' }],
  action: async (cypher, opts) => {
    await queryCommand(cypher as string, opts as KernelCommandOpts)
  },
} satisfies CommandDefinition
