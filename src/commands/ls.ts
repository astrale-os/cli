import { rawOf } from '@astrale-os/kernel-client/graph'
import chalk from 'chalk'

import type { GraphNode, KernelCommandOpts, SelfExpansionMeta } from '../kernel'
import type { ListProjection } from '../lib/output'
import type { CommandDefinition } from '../program/index'

import {
  bindGraph,
  childrenCursor,
  expandSelfInPath,
  formatKernelError,
  runKernelCommand,
  splitRoot,
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

/** A child node row — the shared `function.get` node shape. */
type Item = GraphNode

// ── Display projection ──────────────────────────────────────

/** `/example.astrale.ai` → `example.astrale.ai`; `/` stays `/`. */
export function basename(path?: string): string {
  if (!path || path === '/') return path ?? ''
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `/:kernel.astrale.ai:class.Domain` → `Domain`; falls back to the most specific label. */
export function classNameOf(item: { class?: string; __labels?: string[] }): string {
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
    // Flat listing = ONE function.get depth:1; the root is dropped, the rest are
    // the direct children (replaces the removed `::listChildren` syscall).
    fn: async (ctx) => {
      const result = await withSelfHint(
        () => bindGraph(ctx).query((q) => q.from(expandedPath).children()),
        meta,
      )
      return {
        children: splitRoot(result.wire.nodes, expandedPath).children,
        next: childrenCursor(result.wire),
      }
    },
    format: ({ children, next }, fmtOpts) => {
      const items = applyFilter(children, opts.filter)
      presentList(
        items,
        { ...fmtOpts, quiet: opts.quiet, count: opts.count, long: opts.long },
        lsProjection,
      )
      if (next && !isMachine(fmtOpts) && !opts.quiet && !opts.count) {
        process.stdout.write(
          chalk.dim(
            '  more children truncated - page with `query ' +
              expandedPath +
              ' --depth 1 --children \'{"cursor":"' +
              next +
              '"}\'`\n',
          ),
        )
      }
    },
  })
}

// ── Recursive tree ──────────────────────────────────────────

const MAX_DEPTH = 5

type TreeNode = Item & { children: TreeNode[] }

async function recursiveLs(
  path: string,
  opts: LsOpts,
  meta: SelfExpansionMeta | undefined,
): Promise<void> {
  const machine = isMachine(opts)
  const spin = !machine ? spinner(`Listing ${path} recursively...`) : null

  try {
    await withKernelClient(opts, async (ctx) => {
      // The recursive walk is now ONE function.get to the depth cap; the tree is
      // reassembled client-side from the flat node page (was an N+1 buildTree).
      const result = await withSelfHint(
        () => bindGraph(ctx).query((q) => q.from(path).descend(MAX_DEPTH)),
        meta,
      )
      const tree = buildTree(result.wire.nodes, path)
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

/** Parent absolute path of an absolute node path (`/a/b` → `/a`; `/a` → `/`). */
function parentPathOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

/** Reassemble the flat `function.get` node page into a tree rooted at `rootPath`. */
function buildTree(nodes: readonly GraphNode[], rootPath: string): TreeNode[] {
  const rootRaw = rawOf(rootPath)
  const byPath = new Map<string, TreeNode>()
  for (const n of nodes) {
    const raw = rawOf(n.path)
    if (raw === rootRaw) continue
    byPath.set(raw, { ...n, children: [] })
  }

  const roots: TreeNode[] = []
  for (const [raw, node] of byPath) {
    const parent = parentPathOf(raw)
    const parentNode = parent === rootRaw ? undefined : byPath.get(parent)
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }
  return roots
}

function printTree(nodes: TreeNode[], prefix: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const isLast = i === nodes.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '

    const name = basename(node.path) || node.id || '?'
    console.log(`${prefix}${connector}${chalk.cyan(name)}  ${chalk.dim(classNameOf(node))}`)

    if (node.children.length > 0) {
      printTree(node.children, prefix + childPrefix)
    }
  }
}

function printTreeQuiet(nodes: TreeNode[]): void {
  for (const node of nodes) {
    process.stdout.write(itemPath(node) + '\n')
    if (node.children.length > 0) printTreeQuiet(node.children)
  }
}

export default {
  name: 'ls',
  description: 'List children of a node',
  afterHelpText: `
Behavior:
  Default output is a NAME/KIND/ID table on a TTY, JSON when piped. One
  function.get depth:1 fetches the direct children; -R fetches the whole
  subtree (to depth ${MAX_DEPTH}) in a SINGLE call and renders it as a tree.
  --filter matches a child KIND or label (post-filter): Folder, Function,
  Domain. At a domain's tree position the children are Folder nodes
  (class.X), not Class — so --filter Class returns nothing; use --filter
  Folder, or descend into class.<X>. -q prints one absolute path per line
  (pipeable).

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
      description: 'Filter children by kind or label (e.g., Folder, Function, Domain)',
    },
  ],
  action: async (path, opts) => {
    await lsCommand((path as string | undefined) ?? '/', opts as LsOpts)
  },
} satisfies CommandDefinition
