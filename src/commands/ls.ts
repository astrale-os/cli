import type { Node } from '@astrale-os/kernel-core/graph/node'
import type { QueryDirection } from '@astrale-os/kernel-core/graph/query'

import { ClassPath } from '@astrale-os/kernel-core/graph/class'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../connection'
import type { ListProjection } from '../lib/output'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { nodeProperty, prepareQuery } from '../graph/index'
import { log } from '../lib/log'
import { isMachine, presentList } from '../lib/output'

type LsOpts = KernelCommandOpts & {
  edge?: string
  direction?: QueryDirection
  limit?: string
  cursor?: string
  long?: boolean
  quiet?: boolean
  count?: boolean
}

export async function lsCommand(source: string, opts: LsOpts): Promise<void> {
  if (opts.edge === undefined) {
    log.error('ls requires --edge <class>; Kernel V2 has no universal child relation')
    process.exit(1)
  }

  let path: string
  let meta
  let prepared
  try {
    ;({ path, meta } = await expandSelfInPath(source, opts))
    prepared = prepareQuery({
      sources: [path],
      edge: opts.edge,
      direction: opts.direction,
      limit: opts.limit,
      cursor: opts.cursor,
    })
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Invalid edge neighborhood')
    process.exit(1)
  }

  await runKernelCommand({
    opts,
    label: `Neighbors of ${path}`,
    fn: ({ graph }) =>
      withSelfHint(
        () => graph.query(prepared.ast, prepared.cursor ? { cursor: prepared.cursor } : {}),
        meta,
      ),
    format: (result, format) => {
      presentList(
        [...result.graph.nodes],
        { ...format, long: opts.long, quiet: opts.quiet, count: opts.count },
        listProjection,
      )
      if (result.cursor && !isMachine(format) && !opts.quiet && !opts.count) {
        process.stderr.write(`  cursor: ${result.cursor}\n`)
      }
    },
  })
}

export function listProjection(nodes: Node[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.cyan },
      { key: 'class', header: 'CLASS', color: chalk.dim },
      { key: 'id', header: 'ID', color: chalk.dim },
    ],
    rows: nodes.map((node) => ({
      name: displayName(node),
      class: ClassPath.name(node.class),
      id: node.id,
    })),
    paths: nodes.map((node) => `@${node.id}`),
  }
}

export function displayName(node: Node): string {
  const value =
    nodeProperty(node, 'name') ?? nodeProperty(node, 'title') ?? nodeProperty(node, 'slug')
  return typeof value === 'string' && value.length > 0 ? value : `@${node.id}`
}

export default {
  name: 'ls',
  description: 'List one finite exact edge neighborhood',
  afterHelpText: `
Behavior:
  Lists Nodes reached from one source through one exact Edge Class. Kernel V2
  has no universal parent/child relation, so --edge is required and recursive
  tree walking is intentionally absent. Direction defaults to outgoing and the
  finite default limit is 100. -q emits one @id per line.

Examples:
  $ astrale ls @note --edge /:notes.example.dev:class.references
  $ astrale ls @note --edge /:notes.example.dev:class.references --direction incoming --limit 25
`,
  arguments: [{ name: 'source', description: 'Canonical source Path or @id' }],
  options: [
    { flags: '--edge <class>', description: 'Exact Edge Class to traverse' },
    {
      flags: '--direction <direction>',
      description: 'Traversal direction (default: outgoing)',
      choices: ['outgoing', 'incoming', 'incident'],
    },
    { flags: '--limit <n>', description: 'Finite selected Node limit (default: 100)' },
    { flags: '--cursor <token>', description: 'Resume one live query scope' },
    { flags: '-l, --long', description: 'Print complete canonical Nodes' },
    { flags: '-q, --quiet', description: 'Print one @id per line' },
    { flags: '--count', description: 'Print only the number of returned Nodes' },
  ],
  action: async (source, opts) => {
    await lsCommand(source as string, opts as LsOpts)
  },
} satisfies CommandDefinition
