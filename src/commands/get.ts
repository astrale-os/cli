import { Path } from '@astrale-os/sdk/graph/path'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { AstraleError } from '../errors'
import { failInput, fatal } from '../lib/log'
import { denoise, output } from '../lib/output'

type GetOpts = KernelCommandOpts & { schema?: boolean }

/** Read one exact canonical Node. The caller's Path is not fabricated into the Node value. */
export async function getCommand(target: string, opts: GetOpts): Promise<void> {
  let parsed
  try {
    parsed = Path.parse(target)
  } catch (error) {
    failInput(error, opts)
  }

  const last = parsed.ast.steps.at(-1)
  if (last?.kind === 'method') {
    const error = new AstraleError(
      'NOT_A_NODE',
      `${target} is a callable Path, not a Node.`,
      `Use \`astrale call ${target}\` or \`astrale introspect ${target}\`.`,
    )
    fatal(error, opts)
  }

  await runKernelCommand({
    opts,
    label: `Node ${target}`,
    fn: async (context) => {
      const { path, meta } = await expandSelfInPath(target, context)
      const resolved = meta === undefined ? parsed : Path.parse(path)
      return withSelfHint(() => context.graph.getOrThrow(resolved), meta)
    },
    format: (node, format) => output(opts.schema === true ? node : denoise(node), format),
  })
}

export default {
  name: 'get',
  description: 'Get one canonical node by Path or ID',
  afterHelpText: `
Behavior:
  Resolves one exact Kernel V2 Path and prints the canonical Node
  { id, class, props }. Missing and authorization-masked nodes remain
  intentionally indistinguishable. @self is expanded before dispatch.

  A Node does not contain a synthetic path, labels, or backend class ID.
  Method Paths are not Nodes — use call / introspect. Schema-valued
  properties are omitted unless --schema is passed. Use query for
  graph-shaped reads.

Examples:
  $ astrale get /:notes.example.dev:class.Note
  $ astrale get @abc123 --json
  $ astrale get @self
  $ astrale get /:host.astrale.ai --schema
`,
  arguments: [{ name: 'target', description: 'Canonical Node Path or @id' }],
  options: [{ flags: '--schema', description: 'Include schema-valued properties' }],
  action: async (target, opts) => {
    await getCommand(target as string, opts as GetOpts)
  },
} satisfies CommandDefinition
