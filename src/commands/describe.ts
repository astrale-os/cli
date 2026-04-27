import chalk from 'chalk'

import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand, extractItems } from '../kernel'
import { output } from '../lib/output'

type NodeItem = {
  id?: string
  slug?: string
  class?: string
  __labels?: string[]
  properties?: Record<string, unknown>
}

type DescribeResult = { node: NodeItem; children: NodeItem[] }

// Commander turns `--no-schema` into `schema: false`.
type DescribeOpts = KernelCommandOpts & { schema?: boolean }

export async function describeCommand(path: string, opts: DescribeOpts): Promise<void> {
  await runKernelCommand<DescribeResult>({
    opts,
    label: path,
    fn: async (ctx) => {
      const node = (await ctx.client.call(`${path}::get`, {})) as NodeItem

      let children: NodeItem[] = []
      try {
        const result = await ctx.client.call(`${path}::listChildren`, {})
        children = extractItems<NodeItem>(result)
      } catch {
        // Node may have no children (leaf node)
      }

      return { node, children }
    },
    format: (result, fmtOpts, isRaw) => {
      const shown = opts.schema === false ? stripSchemaProp(result) : result
      if (isRaw) {
        output(shown, fmtOpts)
        return
      }
      printDescribe(shown, path)
    },
  })
}

function stripSchemaProp(result: DescribeResult): DescribeResult {
  const props = result.node.properties
  if (!props || !('schema' in props)) return result
  const { schema: _omitted, ...rest } = props
  return { ...result, node: { ...result.node, properties: rest } }
}

// ── Pretty-print ────────────────────────────────────────────

function printDescribe({ node, children }: DescribeResult, path: string): void {
  const labels = node.__labels ?? []
  const kind = labels[labels.length - 1] ?? 'Node'
  const slug = node.properties?.slug ?? node.slug ?? path.split('/').pop()
  console.log(`  ${chalk.bold.cyan(String(slug))} ${chalk.dim(`(${kind})`)}`)

  if (node.properties?.description) {
    console.log(`  ${chalk.dim(String(node.properties.description))}`)
  }
  console.log('')

  const operations = children.filter(isSyscall)
  const otherChildren = children.filter((c) => !isSyscall(c))

  if (operations.length > 0) {
    console.log(`  ${chalk.bold('Operations:')}`)
    const slugW = Math.max(4, ...operations.map((o) => (o.slug ?? '').length))
    for (const op of operations) {
      const opSlug = (op.slug ?? '?').padEnd(slugW)
      const schema = formatInputSchema(op.properties)
      console.log(`    ${chalk.green(opSlug)}  ${chalk.dim(schema)}`)
    }
    console.log('')
  }

  if (otherChildren.length > 0) {
    console.log(`  ${chalk.bold('Children:')}`)
    for (const child of otherChildren) {
      const childKind =
        child.__labels?.[child.__labels.length - 1] ?? child.class?.split('/').pop() ?? '?'
      console.log(`    ${chalk.cyan(child.slug ?? '?')}  ${chalk.dim(childKind)}`)
    }
    console.log('')
  }

  if (children.length === 0) {
    printProperties(node)
  }
}

function isSyscall(item: NodeItem): boolean {
  return !!(item.__labels?.includes('Syscall') || item.class?.includes('Syscall'))
}

function printProperties(node: NodeItem): void {
  const props = node.properties ?? (node as Record<string, unknown>)
  const entries = Object.entries(props).filter(([k]) => k !== '__labels' && k !== 'id')
  if (entries.length === 0) return

  console.log(`  ${chalk.bold('Properties:')}`)
  for (const [k, v] of entries) {
    const val = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '...' : String(v)
    console.log(`    ${chalk.cyan(k)}: ${chalk.dim(val)}`)
  }
}

function formatInputSchema(properties?: Record<string, unknown>): string {
  if (!properties) return '{}'
  const raw = properties.inputSchema
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
