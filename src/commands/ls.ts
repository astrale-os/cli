import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts, ClientContext, SelfExpansionMeta } from '../kernel'
import type { ListProjection } from '../lib/output'

import {
  expandSelfInPath,
  extractItems,
  formatKernelError,
  runKernelCommand,
  withKernelClient,
  withSelfHint,
} from '../kernel'
import { spinner } from '../lib/log'
import { isMachine, output, presentList } from '../lib/output'

type LsOpts = KernelCommandOpts & {
  long?: boolean
  quiet?: boolean
  recursive?: boolean
  count?: boolean
  filter?: string
}

/** A child node as returned by `::listChildren`. */
type Item = {
  id?: string
  class?: string
  path?: string
  props?: Record<string, unknown>
  __labels?: string[]
}

// ── Display projection ──────────────────────────────────────

/** `/dist.astrale.ai` → `dist.astrale.ai`; `/` stays `/`. */
export function basename(path?: string): string {
  if (!path || path === '/') return path ?? ''
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `/:kernel.astrale.ai:class.Domain` → `Domain`; falls back to the most specific label. */
export function classNameOf(item: Item): string {
  const tail = item.class?.split(/[/:.]/).pop()
  return tail || item.__labels?.[item.__labels.length - 1] || '?'
}

/** The addressable path of a child (for `-q` / tree descent). */
function itemPath(item: Item): string {
  return item.path ?? (item.id ? `@${item.id}` : '')
}

function lsProjection(items: Item[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.cyan },
      { key: 'kind', header: 'KIND', color: chalk.dim },
      { key: 'id', header: 'ID', color: chalk.dim },
    ],
    rows: items.map((i) => ({ name: basename(i.path), kind: classNameOf(i), id: i.id ?? '' })),
    paths: items.map(itemPath),
  }
}

function applyFilter(items: Item[], filter: string | undefined): Item[] {
  if (!filter) return items
  const f = filter.toLowerCase()
  return items.filter((i) => {
    const kindMatch = classNameOf(i).toLowerCase() === f
    const labelMatch = i.__labels?.some((l) => l.toLowerCase() === f) ?? false
    return kindMatch || labelMatch
  })
}

// ── Command ─────────────────────────────────────────────────

export async function lsCommand(path: string, opts: LsOpts): Promise<void> {
  let expandedPath: string
  let meta
  try {
    ;({ path: expandedPath, meta } = await expandSelfInPath(path, opts))
  } catch (e) {
    process.stderr.write((e instanceof Error ? e.message : 'Invalid @self expansion') + '\n')
    process.exit(1)
  }

  if (opts.recursive) {
    return recursiveLs(expandedPath, opts, meta)
  }

  await runKernelCommand({
    opts,
    label: `Children of ${expandedPath}`,
    fn: (ctx) => withSelfHint(() => ctx.client.call(`${expandedPath}::listChildren`, {}), meta),
    format: (result, fmtOpts) => {
      const items = applyFilter(extractItems<Item>(result), opts.filter)
      presentList(
        items,
        { ...fmtOpts, quiet: opts.quiet, count: opts.count, long: opts.long },
        lsProjection,
      )
    },
  })
}

// ── Recursive tree ──────────────────────────────────────────

const MAX_DEPTH = 5
const MAX_NODES = 200

type TreeNode = Item & { children?: TreeNode[] }

async function recursiveLs(
  path: string,
  opts: LsOpts,
  meta: SelfExpansionMeta | undefined,
): Promise<void> {
  const machine = isMachine(opts)
  const spin = !machine ? spinner(`Listing ${path} recursively...`) : null

  try {
    await withKernelClient(opts, async (ctx) => {
      const counter = { count: 0 }
      const tree = await withSelfHint(() => buildTree(ctx, path, 0, counter), meta)
      spin?.succeed(`Tree of ${path}`)
      if (!machine) console.log('')

      if (machine || opts.format) {
        output(tree, opts)
      } else if (opts.quiet) {
        printTreeQuiet(tree)
      } else {
        printTree(tree, '')
      }
    })
  } catch (error) {
    if (!machine && spin) spin.fail('Failed')
    await formatKernelError(error, machine, undefined, opts.debug, { credential: opts.creds })
    process.exit(1)
  }
}

async function buildTree(
  ctx: ClientContext,
  path: string,
  depth: number,
  counter: { count: number },
): Promise<TreeNode[]> {
  if (depth >= MAX_DEPTH || counter.count >= MAX_NODES) return []
  try {
    const result = await ctx.client.call(`${path}::listChildren`, {})
    const items = extractItems<Item>(result)

    const nodes: TreeNode[] = []
    for (const item of items) {
      if (counter.count >= MAX_NODES) break
      counter.count++
      const node: TreeNode = { ...item }
      // Descend by the child's absolute path (the kernel returns `path`, not `slug`).
      if (item.path && item.path !== '/') {
        node.children = await buildTree(ctx, item.path, depth + 1, counter)
      }
      nodes.push(node)
    }
    return nodes
  } catch {
    return []
  }
}

function printTree(nodes: TreeNode[], prefix: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const isLast = i === nodes.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '

    const name = basename(node.path) || node.id || '?'
    console.log(`${prefix}${connector}${chalk.cyan(name)}  ${chalk.dim(classNameOf(node))}`)

    if (node.children && node.children.length > 0) {
      printTree(node.children, prefix + childPrefix)
    }
  }
}

function printTreeQuiet(nodes: TreeNode[]): void {
  for (const node of nodes) {
    process.stdout.write(itemPath(node) + '\n')
    if (node.children) printTreeQuiet(node.children)
  }
}

export default {
  name: 'ls',
  description: 'List children of a node',
  afterHelpText: `
Behavior:
  Default output is a NAME/KIND/ID table on a TTY, JSON when piped. --filter
  matches a node KIND or label: Folder, Method, Domain. At a domain's tree
  position the children are Folder nodes (class.X), not Class — so --filter
  Class returns nothing; use --filter Folder, or descend into class.<X> and
  --filter Method. -R tree view is TTY-only (raw/JSON emits the nested tree).
  -q prints one absolute path per line (pipeable). Note: ls /<domain> may
  report NOT_FOUND even when it exists — use describe, or ls one of its children.

Examples:
  $ astrale ls /
  $ astrale ls /kernel.astrale.ai --filter Folder
  $ astrale ls / -q | xargs -I{} astrale describe {}
`,
  arguments: [
    { name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)', required: false },
  ],
  options: [
    { flags: '-l, --long', description: 'Full node dump (default: compact)' },
    { flags: '-q, --quiet', description: 'One path per line (unix-pipeable)' },
    { flags: '-R, --recursive', description: 'List recursively (tree view)' },
    { flags: '--count', description: 'Print only the number of children' },
    {
      flags: '--filter <kind>',
      description: 'Filter children by kind or label (e.g., Folder, Method, Domain)',
    },
  ],
  action: async (path, opts) => {
    await lsCommand((path as string | undefined) ?? '/', opts as Parameters<typeof lsCommand>[1])
  },
} satisfies CommandDefinition
