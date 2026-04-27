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
