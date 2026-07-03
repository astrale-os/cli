import { ClassPath } from '@astrale-os/kernel-core/domain'
import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { GraphNode, KernelCommandOpts } from '../kernel'

import {
  bindGraph,
  expandSelfInPath,
  nodeProp,
  runKernelCommand,
  splitRoot,
  unqualifyKey,
  withSelfHint,
} from '../kernel'
import { log } from '../lib/log'
import { output } from '../lib/output'

type DescribeResult = { node: GraphNode | undefined; children: GraphNode[] }

// Commander turns `--no-schema` into `schema: false`.
type DescribeOpts = KernelCommandOpts & { schema?: boolean }

export async function describeCommand(path: string, opts: DescribeOpts): Promise<void> {
  let expandedPath: string
  let meta
  try {
    ;({ path: expandedPath, meta } = await expandSelfInPath(path, opts))
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid @self expansion')
    process.exit(1)
  }
  await runKernelCommand<DescribeResult>({
    opts,
    label: expandedPath,
    // One function.get depth:1 = the node AND its children (was ::get +
    // ::listChildren). Function-class children are the node's operations.
    fn: async (ctx) => {
      const result = await withSelfHint(
        () => bindGraph(ctx).get({ roots: [expandedPath], depth: 1 }),
        meta,
      )
      const { root, children } = splitRoot(result.wire.nodes, expandedPath)
      return { node: root, children }
    },
    format: (result, fmtOpts, isRaw) => {
      const shown = opts.schema === false ? stripSchema(result) : result
      if (isRaw) {
        output(shown, fmtOpts)
        return
      }
      printDescribe(shown, expandedPath)
    },
  })
}

function stripSchema(result: DescribeResult): DescribeResult {
  if (!result.node) return result
  const entries = Object.entries(result.node.props).filter(([k]) => unqualifyKey(k) !== 'schema')
  return { ...result, node: { ...result.node, props: Object.fromEntries(entries) } }
}

// ── Pretty-print ────────────────────────────────────────────

function printDescribe({ node, children }: DescribeResult, path: string): void {
  const kind = classNameOf(node) ?? 'Node'
  const name = basename(path) || path
  console.log(`  ${chalk.bold.cyan(name)} ${chalk.dim(`(${kind})`)}`)

  const description = nodeProp(node, 'description')
  if (description) console.log(`  ${chalk.dim(String(description))}`)
  console.log('')

  const operations = children.filter(isFunction)
  const otherChildren = children.filter((c) => !isFunction(c))

  if (operations.length > 0) {
    console.log(`  ${chalk.bold('Operations:')}`)
    const names = operations.map((o) => basename(o.path))
    const slugW = Math.max(4, ...names.map((n) => n.length))
    operations.forEach((op, i) => {
      const opName = names[i].padEnd(slugW)
      const schema = formatInputSchema(op)
      console.log(`    ${chalk.green(opName)}  ${chalk.dim(schema)}`)
    })
    console.log('')
  }

  if (otherChildren.length > 0) {
    console.log(`  ${chalk.bold('Children:')}`)
    for (const child of otherChildren) {
      const childKind = classNameOf(child) ?? '?'
      console.log(`    ${chalk.cyan(basename(child.path) || '?')}  ${chalk.dim(childKind)}`)
    }
    console.log('')
  }

  if (children.length === 0) {
    printProperties(node)
  }
}

/** `/a/b/c` → `c`; `/` → `/`. */
function basename(path?: string): string {
  if (!path || path === '/') return path ?? ''
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Short class name from the contract field `class` (a serialized ClassPath). */
function classNameOf(item: GraphNode | undefined): string | undefined {
  return item?.class ? (ClassPath.tryParse(item.class)?.className ?? undefined) : undefined
}

function isFunction(item: GraphNode): boolean {
  return classNameOf(item) === 'Function'
}

function printProperties(node: GraphNode | undefined): void {
  if (!node) return
  const entries = Object.entries(node.props)
    .map(([k, v]) => [unqualifyKey(k), v] as const)
    .filter(([k]) => k !== '__labels' && k !== 'id')
  if (entries.length === 0) return

  console.log(`  ${chalk.bold('Properties:')}`)
  for (const [k, v] of entries) {
    const val = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '...' : String(v)
    console.log(`    ${chalk.cyan(k)}: ${chalk.dim(val)}`)
  }
}

function formatInputSchema(node: GraphNode): string {
  const raw = nodeProp(node, 'inputSchema')
  if (!raw) return '{}'

  try {
    const schema = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (typeof schema !== 'object' || schema === null) return '{}'

    const props = (schema as { properties?: Record<string, { type?: string }> }).properties
    if (!props || Object.keys(props).length === 0) return '{}'

    const required = new Set((schema as { required?: string[] }).required ?? [])

    const fields = Object.entries(props).map(([name, def]) => {
      const type = def?.type ?? '?'
      return required.has(name) ? `${name}: ${type}` : `${name}?: ${type}`
    })

    return `{ ${fields.join(', ')} }`
  } catch {
    return '{...}'
  }
}

export default {
  name: 'describe',
  description: 'Describe a node: its kind, operations, children, and schemas',
  afterHelpText: `
Behavior:
  One function.get depth:1 — the node plus its children (Function-class
  children are shown as Operations). Raw dump: full properties + children.
  For Domain nodes the properties include a multi-kB serialized 'schema' —
  use --no-schema, and pipe to jq rather than reading by eye.

Examples:
  $ astrale describe /kernel.astrale.ai
  $ astrale describe /host.astrale.ai --no-schema | jq .
`,
  arguments: [{ name: 'path', description: 'Node path (/domain/Class) or ID (@nodeId)' }],
  options: [
    {
      flags: '--no-schema',
      description:
        'Omit the serialized `schema` property (useful for Domain nodes, where it is multi-kB)',
    },
  ],
  action: async (path, opts) => {
    await describeCommand(path as string, opts as DescribeOpts)
  },
} satisfies CommandDefinition
