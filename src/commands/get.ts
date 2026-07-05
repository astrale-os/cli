import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { GetInput, GetResultWire, KernelCommandOpts, SelfExpansionMeta } from '../kernel'

import { bindGraph, expandSelfInPath, runKernelCommand, withSelfHint } from '../kernel'
import { log } from '../lib/log'
import { isMachine, output } from '../lib/output'

type GetOpts = KernelCommandOpts & {
  long?: boolean
  depth?: string
  children?: string
  edges?: string
  graph?: boolean
}

const INTERNAL_KEYS = new Set(['__labels', 'classId'])

export async function getCommand(paths: string[], opts: GetOpts): Promise<void> {
  let roots: string[]
  let meta: SelfExpansionMeta | undefined
  let input: GetInput
  try {
    ;({ roots, meta } = await expandRoots(paths, opts))
    input = buildGetInput(roots, opts)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid arguments')
    process.exit(1)
    return
  }

  // The default single-root, depth-0, edgeless read keeps the historical flat
  // node projection (`{ id, class, path, props }`) that Studio + user scripts
  // parse. Anything richer — multiple roots, a subtree, edge selectors, or an
  // explicit --graph — emits the full GraphData + cursors.
  const graphShape =
    opts.graph || roots.length > 1 || (input.depth ?? 0) > 0 || input.edges !== undefined

  await runKernelCommand<GetResultWire>({
    opts,
    label: `Node ${roots.join(' ')}`,
    fn: async (ctx) => (await withSelfHint(() => bindGraph(ctx).get(input), meta)).wire,
    format: (result, fmtOpts) => {
      if (graphShape) {
        output(result, fmtOpts)
        if (result.next && !isMachine(fmtOpts)) printCursorFooter(result.next)
        return
      }
      const node = result.nodes[0]
      output(opts.long ? node : cleanNode(node), fmtOpts)
    },
  })
}

async function expandRoots(
  paths: string[],
  opts: GetOpts,
): Promise<{ roots: string[]; meta: SelfExpansionMeta | undefined }> {
  const roots: string[] = []
  let meta: SelfExpansionMeta | undefined
  for (const p of paths) {
    const expanded = await expandSelfInPath(p, opts)
    roots.push(expanded.path)
    if (!meta && expanded.meta) meta = expanded.meta
  }
  return { roots, meta }
}

function buildGetInput(roots: string[], opts: GetOpts): GetInput {
  const input: GetInput = { roots }
  if (opts.depth !== undefined) input.depth = parseRange('--depth', opts.depth, 0, 5)
  if (opts.children !== undefined) {
    input.children = parseSelector('--children', opts.children) as GetInput['children']
  }
  if (opts.edges !== undefined) {
    input.edges = parseSelector('--edges', opts.edges) as GetInput['edges']
  }
  return input
}

function parseRange(flag: string, raw: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} needs an integer in [${min}, ${max}], got "${raw}"`)
  }
  return n
}

/**
 * Parse a JSON selector flag (`--children`, `--edges`) to an object. Both are
 * passed as raw JSON and validated server-side by the kernel's getInputSchema;
 * here we only guard that it parses to an object (`--edges` also allows an array).
 */
function parseSelector(flag: string, raw: string): object {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${flag} must be JSON: ${raw}`)
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      `${flag} must be a JSON selector object${flag === '--edges' ? ' or array' : ''}`,
    )
  }
  return parsed
}

/** Mirror `logs`' cursor UX: a dim, pipeable hint of the next page's cursors. */
function printCursorFooter(next: NonNullable<GetResultWire['next']>): void {
  const entries = Object.entries(next)
  if (entries.length === 1) {
    const cursors = entries[0]?.[1]
    if (cursors?.children) {
      process.stdout.write(chalk.dim(`  more: --children '{"cursor":"${cursors.children}"}'\n`))
    }
    for (const [alias, cursor] of Object.entries(cursors?.edges ?? {})) {
      process.stdout.write(
        chalk.dim(`  more edges[${alias}]: --edges '{"as":"${alias}","cursor":"${cursor}"}'\n`),
      )
    }
    return
  }
  process.stdout.write(
    chalk.dim('  more results — per-root cursors in .next (page each root by --cursor)\n'),
  )
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
  description: 'Get one or more nodes (subtrees, edges) via function.get',
  afterHelpText: `
Behavior:
  Reads through the kernel's function.get door. Accepts one or more root
  paths (tree path /domain/class.Name, or an id @nodeId). Unreadable or
  missing roots are silently OMITTED (soft-root visibility) — a read never
  403s; it returns fewer nodes. Only when NO root resolves does it error.

  Default output (single root, --depth 0, no --edges) is the flat node
  projection { id, class, path, props } — Studio + scripts parse this. Add
  -l to keep the internal fields (__labels, classId). Any richer request —
  multiple roots, --depth > 0, --edges, or --graph — emits the full
  GraphData { nodes, edges, aliases } plus per-root pagination cursors in
  .next; on a TTY a dim cursor footer is printed when more pages exist.

  --children and --edges are symmetric JSON selectors. --children takes
  { classes?, limit?, cursor?, order? } and shapes the depth-1 children page
  (needs --depth ≥ 1 to bite); --edges takes an edge selector, or a JSON array
  of them, e.g.
  --children '{"classes":["/:kernel.astrale.ai:class.Folder"],"limit":50}'
  --edges '{"direction":"out","classes":["/:kernel.astrale.ai:class.has_perm"]}'.

Examples:
  $ astrale get /kernel.astrale.ai/class.Root
  $ astrale get @abc123 -l
  $ astrale get / --depth 1
  $ astrale get /a /b --graph
  $ astrale get /kernel.astrale.ai --depth 2 --children '{"classes":["/:kernel.astrale.ai:class.Folder"]}'
  $ astrale get @abc123 --edges '{"direction":"both"}'
`,
  arguments: [
    { name: 'paths...', description: 'One or more node paths (/domain/Class) or IDs (@nodeId)' },
  ],
  options: [
    { flags: '-l, --long', description: 'Include internal fields (__labels, classId)' },
    { flags: '--depth <n>', description: 'Subtree depth to fetch (0-5, default 0)' },
    {
      flags: '--children <json>',
      description: 'Children selector { classes?, limit?, cursor?, order? } (needs --depth ≥ 1)',
    },
    {
      flags: '--edges <json>',
      description: 'Edge selector (or JSON array of selectors) to include',
    },
    { flags: '--graph', description: 'Force the full GraphData shape even for a single root' },
  ],
  action: async (paths, opts) => {
    await getCommand(paths as string[], opts as GetOpts)
  },
} satisfies CommandDefinition
