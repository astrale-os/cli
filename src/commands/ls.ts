import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts, ClientContext } from '../kernel'

import { runKernelCommand, extractItems, withKernelClient, formatKernelError } from '../kernel'
import { spinner } from '../lib/log'
import { isRawOutput, output } from '../lib/output'

type LsOpts = KernelCommandOpts & {
  long?: boolean
  quiet?: boolean
  recursive?: boolean
  count?: boolean
  filter?: string
}

type Item = {
  id?: string
  slug?: string
  class?: string
  __labels?: string[]
}

export async function lsCommand(path: string, opts: LsOpts): Promise<void> {
  if (opts.recursive) {
    return recursiveLs(path, opts)
  }

  await runKernelCommand({
    opts,
    label: `Children of ${path}`,
    fn: (ctx) => ctx.client.call(`${path}::listChildren`, {}),
    format: (result, fmtOpts, isRaw) => {
      let items = extractItems<Item>(result)

      if (opts.filter) {
        const f = opts.filter.toLowerCase()
        items = items.filter((i) => {
          // Match the kind name — last dotted segment of i.class (e.g. `/kernel.astrale.ai/class.Folder` → `Folder`).
          const classTail = i.class?.split('/').pop() ?? ''
          const kindName = classTail.split('.').pop()?.toLowerCase() ?? ''
          const labelMatch = i.__labels?.some((l) => l.toLowerCase() === f) ?? false
          return kindName === f || labelMatch
        })
      }

      if (opts.count) {
        process.stdout.write(String(items.length) + '\n')
      } else if (opts.quiet) {
        for (const item of items) {
          process.stdout.write(itemPath(path, item) + '\n')
        }
      } else if (opts.long || fmtOpts.format) {
        output(result, fmtOpts)
      } else if (isRaw) {
        output(items.map(stripInternalFields), fmtOpts)
      } else {
        printCompact(items)
      }
    },
  })
}

// ── Recursive tree ──────────────────────────────────────────

const MAX_DEPTH = 5
const MAX_NODES = 200

async function recursiveLs(path: string, opts: LsOpts): Promise<void> {
  const isRaw = isRawOutput(opts)
  const spin = !isRaw ? spinner(`Listing ${path} recursively...`) : null

  try {
    await withKernelClient(opts, async (ctx) => {
      const counter = { count: 0 }
      const tree = await buildTree(ctx, path, 0, counter)
      spin?.succeed(`Tree of ${path}`)
      if (!isRaw) console.log('')

      if (isRaw || opts.long || opts.format) {
        output(tree, opts)
      } else if (opts.quiet) {
        printTreeQuiet(tree, path)
      } else {
        printTree(tree, '')
      }
    })
  } catch (error) {
    if (!isRaw && spin) spin.fail('Failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}

type TreeNode = Item & { children?: TreeNode[] }

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
      const childPath = item.slug ? `${path === '/' ? '' : path}/${item.slug}` : null
      const node: TreeNode = { ...item }
      if (childPath) {
        node.children = await buildTree(ctx, childPath, depth + 1, counter)
      }
      nodes.push(node)
    }
    return nodes
  } catch {
    return []
  }
}

// ── Formatting ──────────────────────────────────────────────

function itemPath(parent: string, item: Item): string {
  return item.slug ? `${parent === '/' ? '' : parent}/${item.slug}` : (item.id ?? '')
}

function printTree(nodes: TreeNode[], prefix: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const isLast = i === nodes.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '

    const cls = chalk.dim(shortClass(node))
    console.log(`${prefix}${connector}${chalk.cyan(node.slug ?? node.id ?? '?')}  ${cls}`)

    if (node.children && node.children.length > 0) {
      printTree(node.children, prefix + childPrefix)
    }
  }
}

function printTreeQuiet(nodes: TreeNode[], parentPath: string): void {
  for (const node of nodes) {
    process.stdout.write(itemPath(parentPath, node) + '\n')
    if (node.children) {
      printTreeQuiet(node.children, itemPath(parentPath, node))
    }
  }
}

function printCompact(items: Item[]): void {
  if (items.length === 0) {
    console.log(chalk.dim('  (empty)'))
    return
  }
  const slugW = Math.max(4, ...items.map((i) => (i.slug ?? '').length))
  for (const item of items) {
    const slug = (item.slug ?? '').padEnd(slugW)
    const cls = chalk.dim(shortClass(item))
    const id = chalk.dim(item.id ?? '')
    console.log(`  ${chalk.cyan(slug)}  ${cls}  ${id}`)
  }
}

function shortClass(item: Item): string {
  if (item.class) {
    const last = item.class.split('/').pop()
    if (last) return last
  }
  return item.__labels?.[item.__labels.length - 1] ?? '?'
}

const INTERNAL_FIELDS = new Set(['__labels', 'classId', 'code', 'url', 'protocol'])

function stripInternalFields(item: Item): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    if (INTERNAL_FIELDS.has(k)) continue
    if (k === 'properties' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(v)) {
        if (pk === 'code' || pk === 'inputSchema' || pk === 'outputSchema') continue
        props[pk] = pv
      }
      result[k] = props
    } else {
      result[k] = v
    }
  }
  return result
}

export default {
  name: 'ls',
  description: 'List children of a node',
  afterHelpText: `
Behavior:
  --filter matches a node KIND or label: Folder, Method, Domain. At a
  domain's tree position the children are Folder nodes (class.X), not
  Class — so --filter Class returns nothing; use --filter Folder, or
  descend into class.<X> and --filter Method. -R tree view is TTY-only
  (raw/JSON emits a flat list of direct children). -q prints bare ids
  (no @ prefix). Note: ls /<domain> may report NOT_FOUND even when it
  exists — use describe, or ls one of its children.

Examples:
  $ astrale ls /
  $ astrale ls /kernel.astrale.ai --filter Folder
  $ astrale ls / -q | sed 's/^/@/' | xargs -I{} astrale describe {}
`,
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
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
    await lsCommand(path as string, opts as Parameters<typeof lsCommand>[1])
  },
} satisfies CommandDefinition
