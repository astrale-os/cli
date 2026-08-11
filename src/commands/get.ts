import { Path } from '@astrale-os/kernel-core/path'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { log } from '../lib/log'
import { output } from '../lib/output'

type GetOpts = KernelCommandOpts

/** Read one exact canonical Node. The caller's Path is not fabricated into the Node value. */
export async function getCommand(target: string, opts: GetOpts): Promise<void> {
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
    label: `Node ${path}`,
    fn: ({ graph }) => withSelfHint(() => graph.getOrThrow(Path.parse(path)), meta),
    format: (node, format) => output(node, format),
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
  Use astrale query for graph-shaped reads.

Examples:
  $ astrale get /:notes.example.dev:class.Note
  $ astrale get @abc123 --json
  $ astrale get @self
`,
  arguments: [{ name: 'target', description: 'Canonical Node Path or @id' }],
  action: async (target, opts) => {
    await getCommand(target as string, opts as GetOpts)
  },
} satisfies CommandDefinition
