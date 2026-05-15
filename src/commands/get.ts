import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'
import { output } from '../lib/output'

type GetOpts = KernelCommandOpts & { long?: boolean }

const INTERNAL_KEYS = new Set(['__labels', 'classId'])

export async function getCommand(path: string, opts: GetOpts): Promise<void> {
  await runKernelCommand({
    opts,
    label: `Node ${path}`,
    fn: (ctx) => ctx.client.call(`${path}::get`, {}),
    format: (result, fmtOpts) => {
      output(opts.long ? result : cleanNode(result), fmtOpts)
    },
  })
}

function cleanNode(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (INTERNAL_KEYS.has(k)) continue
    result[k] = v
  }
  return result
}

export default {
  name: 'get',
  description: 'Get a node by path or ID',
  afterHelpText: `
Behavior:
  Accepts a tree path (/domain/class.Name) or an id (@nodeId). -l adds
  the internal fields (__labels, classId) hidden in the summary view.

Examples:
  $ astrale get /kernel.astrale.ai/class.Root
  $ astrale get @abc123 -l
`,
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [
    { flags: '-l, --long', description: 'Include all internal fields (__labels, classId)' },
  ],
  action: async (path, opts) => {
    await getCommand(path as string, opts as Parameters<typeof getCommand>[1])
  },
} satisfies CommandDefinition
