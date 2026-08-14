import type { MutationResult } from '@astrale-os/sdk/mutation'

import chalk from 'chalk'
import { readFile } from 'node:fs/promises'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { prepareMutation } from '../graph/index'
import { log } from '../lib/log'
import { output } from '../lib/output'
import { renderTable } from '../lib/table'

type MutateOpts = KernelCommandOpts & {
  data?: string
  file?: string
  dry?: boolean
}

export async function mutateCommand(opts: MutateOpts): Promise<void> {
  let mutation
  try {
    mutation = prepareMutation(await readDocument(opts))
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Invalid Mutation V2 document')
    process.exit(1)
  }

  if (opts.dry) {
    output(mutation, opts)
    return
  }

  await runKernelCommand<MutationResult>({
    opts,
    label: 'Mutate',
    fn: ({ graph }) => graph.mutate(mutation),
    format: (result, format, machine) => {
      if (machine || format.format !== undefined) output(result, format)
      else printResult(result)
    },
  })
}

async function readDocument(opts: MutateOpts): Promise<unknown> {
  const authored = [opts.data !== undefined, opts.file !== undefined].filter(Boolean).length
  if (authored > 1) throw new TypeError('--data and --file are mutually exclusive')
  if (opts.data !== undefined) return parseJson(opts.data, '--data')
  if (opts.file !== undefined) {
    let raw: string
    try {
      raw = await readFile(opts.file, 'utf8')
    } catch (error) {
      throw new Error(
        `Cannot read --file ${opts.file}: ${error instanceof Error ? error.message : error}`,
      )
    }
    return parseJson(raw, opts.file)
  }
  if (process.stdin.isTTY) {
    throw new TypeError('No mutation provided; use --data, --file, or stdin')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw.length === 0) throw new TypeError('No mutation provided on stdin')
  return parseJson(raw, 'stdin')
}

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new TypeError(`${source} must contain valid JSON`)
  }
}

function printResult(result: MutationResult): void {
  const rows = Object.entries(result.createdNodes).map(([binding, id]) => ({ binding, id }))
  if (rows.length === 0) {
    console.log(chalk.dim('  applied — no Nodes created'))
    return
  }
  console.log(`  ${chalk.bold('Created nodes:')}`)
  console.log(
    renderTable(rows, {
      columns: [
        { key: 'binding', header: 'BINDING', color: chalk.cyan },
        { key: 'id', header: 'ID', color: chalk.dim },
      ],
      showHeader: true,
    }),
  )
}

export default {
  name: 'mutate',
  description: 'Apply one atomic Mutation V2 graph transition',
  afterHelpText: `
Behavior:
  Accepts a canonical astrale.graph.mutation/v2 document or its exact
  { preconditions, operations } authoring input. Source is --data, --file,
  or stdin. --dry admits and prints the canonical document without opening a
  Kernel connection. The result contains the real createdNodes binding map.

  Legacy PatchData nodes/edges arms and createdEdges IDs are not part of
  Mutation V2 and are rejected rather than approximated.

Examples:
  $ astrale mutate --file mutation.v2.json
  $ astrale mutate --data '{"preconditions":[],"operations":[]}' --dry
`,
  options: [
    { flags: '-d, --data <json>', description: 'Mutation V2 JSON document' },
    { flags: '-f, --file <path>', description: 'Read a Mutation V2 document from a file' },
    { flags: '--dry', description: 'Admit and print canonical Mutation V2 without dispatch' },
  ],
  action: async (opts) => {
    await mutateCommand(opts as MutateOpts)
  },
} satisfies CommandDefinition
