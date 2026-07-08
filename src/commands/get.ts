import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'

import { bindGraph, expandSelfInPath, runKernelCommand, withSelfHint } from '../kernel'
import { log } from '../lib/log'
import { output } from '../lib/output'

type GetOpts = KernelCommandOpts & {
  long?: boolean
}

const INTERNAL_KEYS = new Set(['__labels', 'classId'])

export async function getCommand(pathArg: string, opts: GetOpts): Promise<void> {
  if (!pathArg) {
    log.error('Usage: astrale get <path>')
    process.exit(1)
    return
  }

  let path: string
  let meta
  try {
    ;({ path, meta } = await expandSelfInPath(pathArg, opts))
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid @self expansion')
    process.exit(1)
    return
  }

  await runKernelCommand({
    opts,
    label: 'Node ' + path,
    fn: async (ctx) => {
      const node = await withSelfHint(() => bindGraph(ctx).get(path), meta)
      if (node === null) {
        log.error('node "' + path + '" not found or not visible')
        process.exit(1)
      }
      return node
    },
    format: (node, fmtOpts) => {
      output(opts.long ? node : cleanNode(node), fmtOpts)
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
  description: 'Get one node by path or id',
  afterHelpText: [
    '',
    'Behavior:',
    '  Point read through the kernel-client GraphApi.get shorthand. Accepts exactly',
    '  one node path (tree path /domain/class.Name, or an id @nodeId). @self is',
    '  expanded before dispatch. Missing and masked nodes share one opaque error:',
    '  node "<path>" not found or not visible.',
    '',
    '  Output is the historical flat wire node projection { id, class, path, props }.',
    '  Add -l to keep the internal fields (__labels, classId). Richer reads -',
    '  multiple roots, child expansion, edge expansion, cursors, or full GraphData -',
    '  live on astrale query.',
    '',
    'Examples:',
    '  $ astrale get /kernel.astrale.ai/class.Root',
    '  $ astrale get @abc123 -l',
    '  $ astrale get @self --json',
    '',
  ].join('\n'),
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [{ flags: '-l, --long', description: 'Include internal fields (__labels, classId)' }],
  action: async (path, opts) => {
    await getCommand(path as string, opts as GetOpts)
  },
} satisfies CommandDefinition
