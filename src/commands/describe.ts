import type { Node } from '@astrale-os/kernel-core/graph/node'

import { ClassPath } from '@astrale-os/kernel-core/graph/class'
import { Path } from '@astrale-os/kernel-core/path'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { unqualifyProperty } from '../graph/index'
import { log } from '../lib/log'
import { output } from '../lib/output'

type DescribeOpts = KernelCommandOpts & { schema?: boolean }
type DescribedNode = Omit<Node, 'props'> & { readonly props: Readonly<Record<string, unknown>> }

/** Describe only facts present on the canonical Node; no hierarchy is inferred from its Path. */
export async function describeCommand(target: string, opts: DescribeOpts): Promise<void> {
  let path: string
  let meta
  try {
    ;({ path, meta } = await expandSelfInPath(target, opts))
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Invalid target')
    process.exit(1)
  }

  await runKernelCommand({
    opts,
    label: `Describe ${path}`,
    fn: ({ graph }) => withSelfHint(() => graph.getOrThrow(Path.parse(path)), meta),
    format: (node, format, machine) => {
      const shown = opts.schema === false ? withoutSchema(node) : node
      if (machine || format.format !== undefined) output(shown, format)
      else printDescription(path, shown)
    },
  })
}

function withoutSchema(node: Node): DescribedNode {
  return {
    ...node,
    props: Object.fromEntries(
      Object.entries(node.props).filter(([key]) => unqualifyProperty(key) !== 'schema'),
    ),
  }
}

function printDescription(target: string, node: DescribedNode): void {
  console.log(`  ${chalk.bold.cyan(target)}`)
  console.log(`  ${chalk.dim('id')}     ${node.id}`)
  console.log(
    `  ${chalk.dim('class')}  ${ClassPath.name(node.class)} ${chalk.dim(`(${node.class})`)}`,
  )

  const properties = Object.entries(node.props)
  if (properties.length === 0) return
  console.log(`\n  ${chalk.bold('Properties:')}`)
  for (const [key, value] of properties) {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value)
    console.log(`    ${chalk.cyan(unqualifyProperty(key))}: ${chalk.dim(rendered)}`)
  }
}

export default {
  name: 'describe',
  description: 'Describe the canonical facts of one node',
  afterHelpText: `
Behavior:
  Reads one canonical Node and presents its ID, Class, and properties.
  It does not infer operations or children from path layout. --no-schema
  omits schema-valued properties from Domain-sized results.

Examples:
  $ astrale describe /:kernel.astrale.ai:class.Domain
  $ astrale describe @self --no-schema
`,
  arguments: [{ name: 'target', description: 'Canonical Node Path or @id' }],
  options: [
    { flags: '--no-schema', description: 'Omit properties whose qualified leaf is schema' },
  ],
  action: async (target, opts) => {
    await describeCommand(target as string, opts as DescribeOpts)
  },
} satisfies CommandDefinition
