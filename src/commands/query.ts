import { getInputSchema, K } from '@astrale-os/kernel-core'
import chalk from 'chalk'

import type { GetResultWire, KernelCommandOpts, QueryASTInput, SelfExpansionMeta } from '../kernel'
import type { CommandDefinition } from '../program/index'

import { bindGraph, expandSelfInPath, runKernelCommand, withSelfHint } from '../kernel'
import { log } from '../lib/log'
import { isMachine, output } from '../lib/output'

type QueryOpts = KernelCommandOpts & {
  depth?: string
  children?: string
  edges?: string
  ast?: string
  cypher?: string
}

type QueryMode =
  | { kind: 'cypher'; cypher: string }
  | { kind: 'ast'; ast: QueryASTInput }
  | { kind: 'roots'; roots: string[]; meta: SelfExpansionMeta | undefined; query: BuiltQuery }

export async function queryCommand(paths: string[], opts: QueryOpts): Promise<void> {
  let mode: QueryMode
  try {
    mode = await parseMode(paths, opts)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid arguments')
    process.exit(1)
    return
  }

  if (mode.kind === 'cypher') {
    await runKernelCommand({
      opts,
      label: 'Query',
      fn: (ctx) => ctx.client.call(K.$.f('query').path.domain.raw, { cypher: mode.cypher }),
      format: (result, fmtOpts) => output(result, fmtOpts),
    })
    return
  }

  await runKernelCommand<GetResultWire>({
    opts,
    label: mode.kind === 'roots' ? 'Query ' + mode.roots.join(' ') : 'Query',
    fn: async (ctx) => {
      const read = () => bindGraph(ctx).query(mode.kind === 'roots' ? mode.query.ast : mode.ast)
      const result = mode.kind === 'roots' ? await withSelfHint(read, mode.meta) : await read()
      return result.wire
    },
    format: (result, fmtOpts) => {
      output(result, fmtOpts)
      if (result.next && !isMachine(fmtOpts)) printCursorFooter(result.next)
    },
  })
}

async function parseMode(paths: string[], opts: QueryOpts): Promise<QueryMode> {
  const rootsInput = paths ?? []
  const hasRoots = rootsInput.length > 0
  const hasAst = opts.ast !== undefined
  const hasCypher = opts.cypher !== undefined
  const hasSelectors =
    opts.depth !== undefined || opts.children !== undefined || opts.edges !== undefined

  if (hasCypher) {
    if (hasAst || hasRoots || hasSelectors) {
      throw new Error('--cypher cannot be used with roots, --ast, --depth, --children, or --edges')
    }
    return { kind: 'cypher', cypher: opts.cypher as string }
  }

  if (hasAst) {
    if (hasRoots || hasSelectors) {
      throw new Error('--ast cannot be used with positional roots or --depth/--children/--edges')
    }
    return { kind: 'ast', ast: parseAst(opts.ast as string) }
  }

  if (!hasRoots) {
    throw new Error(
      'Usage: astrale query <paths...> [--depth <n>] [--children <json>] [--edges <json>] | --ast <json> | --cypher <query>',
    )
  }

  const { roots, meta } = await expandRoots(rootsInput, opts)
  return { kind: 'roots', roots, meta, query: buildQuery(roots, opts) }
}

function parseAst(raw: string): QueryASTInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('--ast must be JSON: ' + raw)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--ast must be a JSON object')
  }
  return parsed as QueryASTInput
}

async function expandRoots(
  paths: string[],
  opts: QueryOpts,
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

function buildQuery(roots: string[], opts: QueryOpts): BuiltQuery {
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
    throw new Error(flag + ' needs an integer in [' + min + ', ' + max + '], got "' + raw + '"')
  }
  return n
}

type SelectorIssue = { readonly path: readonly PropertyKey[]; readonly message: string }
type SelectorSchema = {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: { issues: readonly SelectorIssue[] } }
}

function parseSelector<T>(flag: string, raw: string, schema: SelectorSchema): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(flag + ' must be JSON: ' + raw)
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      flag + ' must be a JSON selector object' + (flag === '--edges' ? ' or array' : ''),
    )
  }
  const check = schema.safeParse(parsed)
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => (i.path.join('.') || '(root)') + ': ' + i.message)
      .join('; ')
    throw new Error(flag + ' invalid selector: ' + detail)
  }
  return parsed as T
}

function printCursorFooter(next: NonNullable<GetResultWire['next']>): void {
  const entries = Object.entries(next)
  if (entries.length === 1) {
    const cursors = entries[0]?.[1]
    if (cursors?.children) {
      process.stdout.write(
        chalk.dim('  more: --children \'{"cursor":"' + cursors.children + '"}\'\n'),
      )
    }
    for (const [alias, cursor] of Object.entries(cursors?.edges ?? {})) {
      process.stdout.write(
        chalk.dim(
          '  more edges[' +
            alias +
            ']: --edges \'{"as":"' +
            alias +
            '","cursor":"' +
            cursor +
            '"}\'\n',
        ),
      )
    }
    return
  }
  process.stdout.write(
    chalk.dim('  more results - per-root cursors in .next (page each root by --cursor)\n'),
  )
}

export default {
  name: 'query',
  description: 'Run a structured graph read',
  afterHelpText: [
    '',
    'Behavior:',
    '  Structured read door for the query AST. Positional roots build a v1 AST',
    '  with optional child and edge expansion, then lower through function.get',
    '  today. A true query syscall may back this command later.',
    '',
    '  Output is always the full GraphData envelope { nodes, edges, aliases }',
    '  with .roots and .next when returned. On a TTY, cursor footers are printed',
    '  when .next has more pages.',
    '',
    '  --children takes { classes?, limit?, cursor?, order? } and shapes the',
    '  depth-1 children page (needs --depth >= 1 to bite). --edges takes an edge',
    '  selector, or a JSON array of selectors.',
    '',
    '  --ast (experimental) accepts a raw QueryASTInput JSON object. The AST shape',
    '  is not a stable contract yet — prefer the flags above. @self is not expanded',
    '  inside --ast JSON.',
    '',
    '  --cypher is a read-only escape hatch. The kernel rejects write keywords',
    '  such as CREATE, DELETE, SET, MERGE, REMOVE, and DETACH.',
    '',
    'Examples:',
    '  $ astrale query / --depth 1',
    '  $ astrale query /a /b --edges \'{"direction":"both"}\'',
    '  $ astrale query /kernel.astrale.ai --depth 2 --children \'{"classes":["/:kernel.astrale.ai:class.Folder"]}\'',
    "  $ astrale query --cypher 'MATCH (n) RETURN count(n) AS total'",
    '',
  ].join('\n'),
  arguments: [
    {
      name: 'paths...',
      description: 'One or more root paths (/domain/Class) or IDs (@nodeId)',
      required: false,
    },
  ],
  options: [
    { flags: '--depth <n>', description: 'Subtree depth to fetch (0-5, default 0)' },
    {
      flags: '--children <json>',
      description: 'Children selector { classes?, limit?, cursor?, order? } (needs --depth >= 1)',
    },
    {
      flags: '--edges <json>',
      description: 'Edge selector (or JSON array of selectors) to include',
    },
    {
      flags: '--ast <json>',
      description: 'Raw QueryASTInput JSON object (experimental, unstable shape)',
    },
    { flags: '--cypher <query>', description: 'Read-only Cypher escape hatch' },
  ],
  action: async (paths, opts) => {
    await queryCommand(Array.isArray(paths) ? paths : [], opts as QueryOpts)
  },
} satisfies CommandDefinition
