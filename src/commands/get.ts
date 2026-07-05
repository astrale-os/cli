import { getInputSchema } from '@astrale-os/kernel-core'
import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { GetResultWire, KernelCommandOpts, QueryASTInput, SelfExpansionMeta } from '../kernel'

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
  let query: BuiltQuery
  try {
    ;({ roots, meta } = await expandRoots(paths, opts))
    query = buildQuery(roots, opts)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid arguments')
    process.exit(1)
    return
  }

  // The default single-root, depth-0, edgeless read keeps the historical flat
  // node projection (`{ id, class, path, props }`) that Studio + user scripts
  // parse. Anything richer — multiple roots, a subtree, edge selectors, or an
  // explicit --graph — emits the full GraphData + cursors.
  const graphShape = opts.graph || roots.length > 1 || query.depth > 0 || query.hasEdges

  await runKernelCommand<GetResultWire>({
    opts,
    label: `Node ${roots.join(' ')}`,
    fn: async (ctx) => (await withSelfHint(() => bindGraph(ctx).query(query.ast), meta)).wire,
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

type QueryDir = 'in' | 'out' | 'both'
type QueryOrder = { by: string; dir: 'asc' | 'desc' }
type ChildrenSelector = { classes?: string[]; limit?: number; cursor?: string; order?: QueryOrder }
type EdgeSelector = {
  as?: string
  classes?: string[]
  direction?: QueryDir
  limit?: number
  cursor?: string
  order?: QueryOrder
}
type BuiltQuery = { ast: QueryASTInput; depth: number; hasEdges: boolean }

function buildQuery(roots: string[], opts: GetOpts): BuiltQuery {
  const depth = opts.depth !== undefined ? parseRange('--depth', opts.depth, 0, 5) : 0
  const children =
    opts.children !== undefined
      ? parseSelector<ChildrenSelector>('--children', opts.children, getInputSchema.shape.children)
      : undefined
  const edges =
    opts.edges !== undefined
      ? parseSelector<EdgeSelector | EdgeSelector[]>(
          '--edges',
          opts.edges,
          getInputSchema.shape.edges,
        )
      : undefined

  const steps: NonNullable<QueryASTInput['steps']> = []
  if (depth > 0) steps.push({ expand: childExpand(depth, children) })
  edgeSelectors(edges).forEach((selector, index) => {
    steps.push({ expand: edgeExpand(selector, index) })
  })

  return {
    ast: { version: 1, from: roots, ...(steps.length > 0 ? { steps } : {}) },
    depth,
    hasEdges: edges !== undefined,
  }
}

function childExpand(depth: number, children: ChildrenSelector | undefined) {
  return {
    edge: 'has_parent',
    dir: 'in' as const,
    depth,
    ...(children?.classes !== undefined ? { filter: { class: children.classes } } : {}),
    ...pageFields(children),
    ...(children?.order !== undefined ? { order: children.order } : {}),
  }
}

function edgeExpand(selector: EdgeSelector, index: number) {
  return {
    ...(selector.classes !== undefined ? { edge: selector.classes } : {}),
    dir: selector.direction ?? 'both',
    as: selector.as ?? 'e' + index,
    ...pageFields(selector),
    ...(selector.order !== undefined ? { order: selector.order } : {}),
  }
}

function pageFields(selector: { limit?: number; cursor?: string } | undefined) {
  if (selector?.limit === undefined && selector?.cursor === undefined) return {}
  return {
    page: {
      ...(selector.limit !== undefined ? { limit: selector.limit } : {}),
      ...(selector.cursor !== undefined ? { cursor: selector.cursor } : {}),
    },
  }
}

function edgeSelectors(edges: EdgeSelector | EdgeSelector[] | undefined): EdgeSelector[] {
  if (edges === undefined) return []
  return Array.isArray(edges) ? edges : [edges]
}

function parseRange(flag: string, raw: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} needs an integer in [${min}, ${max}], got "${raw}"`)
  }
  return n
}

type SelectorIssue = { readonly path: readonly PropertyKey[]; readonly message: string }
/** Minimal `safeParse` view of a `getInputSchema` field — avoids unifying kernel-core's zod (v4) with the CLI's (v3). */
type SelectorSchema = {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: { issues: readonly SelectorIssue[] } }
}

/**
 * Parse then strict-validate a `--children`/`--edges` JSON flag against
 * function.get's own selector schema — the query lowering would otherwise
 * silently normalize scalars/bare-refs and drop the unknown keys the old wire
 * rejected. Returns the raw parsed value (strings preserved) for the lowering.
 */
function parseSelector<T>(flag: string, raw: string, schema: SelectorSchema): T {
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
  const check = schema.safeParse(parsed)
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`${flag} invalid selector: ${detail}`)
  }
  return parsed as T
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
