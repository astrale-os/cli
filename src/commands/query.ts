import type { QueryDirection } from '@astrale-os/sdk/query'

import { readFile } from 'node:fs/promises'

import type { KernelCommandOpts, SelfExpansionMeta } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { AstraleError } from '../errors'
import { prepareQuery, type QueryCommandInput } from '../graph/index'
import { failInput } from '../lib/log'
import { isMachine, output } from '../lib/output'

type QueryOpts = KernelCommandOpts & {
  ast?: string
  file?: string
  definition?: string
  edge?: string
  direction?: QueryDirection
  limit?: string
  cursor?: string
}

export async function queryCommand(sources: string[], opts: QueryOpts): Promise<void> {
  let input: QueryCommandInput
  try {
    const ast = await readAst(opts)
    input = {
      sources,
      ...(ast === undefined ? {} : { ast }),
      definition: opts.definition,
      edge: opts.edge,
      direction: opts.direction,
      limit: opts.limit,
      cursor: opts.cursor,
    }
  } catch (error) {
    failInput(error, opts)
  }

  let prepared
  try {
    prepared = prepareQuery(input)
  } catch (error) {
    failInput(error, opts)
  }

  await runKernelCommand({
    opts,
    label: 'Query',
    fn: async (context) => {
      const expanded = await Promise.all(sources.map((source) => expandSelfInPath(source, context)))
      const meta: SelfExpansionMeta | undefined = expanded.find(
        (entry) => entry.meta !== undefined,
      )?.meta
      const resolved =
        meta === undefined
          ? prepared
          : prepareQuery({ ...input, sources: expanded.map(({ path }) => path) })
      return withSelfHint(() => context.graph.query(resolved.ast, { page: resolved.page }), meta)
    },
    format: (response, format) => {
      output(response.result, format)
      if (response.page.next && !isMachine(format)) {
        process.stderr.write(`  cursor: ${response.page.next}\n`)
      }
    },
  })
}

async function readAst(opts: QueryOpts): Promise<unknown | undefined> {
  if (opts.ast !== undefined && opts.file !== undefined) {
    throw new TypeError('--ast and --file are mutually exclusive')
  }
  if (opts.ast !== undefined) return parseJson(opts.ast, '--ast')
  if (opts.file === undefined) return undefined
  let raw: string
  try {
    raw = await readFile(opts.file, 'utf8')
  } catch (error) {
    throw new AstraleError('FILE_READ_FAILED', `Cannot read --file ${opts.file}.`, undefined, {
      cause: error,
    })
  }
  return parseJson(raw, opts.file)
}

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new TypeError(`${source} must contain valid JSON`)
  }
}

export default {
  name: 'query',
  description: 'Run one canonical Query V6 graph read',
  afterHelpText: `
Behavior:
  Positional Paths and --definition author a finite Query V6 read. --edge adds
  one exact Edge-Class expansion; --direction defaults to outgoing. --ast and
  --file accept a complete canonical astrale.graph.query/v6 document, including
  Property ordering and Node or Edge reference/value projections. --cursor resumes
  one caller-bound query scope.

  Legacy depth/children selector JSON and raw Cypher are not portable Kernel
  V2 query contracts and are not accepted.

Examples:
  $ astrale query /:notes.example.dev:class.Note --limit 50
  $ astrale query --definition /:notes.example.dev:class.Note --limit 50
  $ astrale query @note --edge /:notes.example.dev:class.references --direction outgoing --limit 25
  $ astrale query --file query.v6.json --cursor "$CURSOR"
`,
  arguments: [{ name: 'sources...', description: 'Canonical source Paths', required: false }],
  options: [
    { flags: '--ast <json>', description: 'Canonical Query V6 JSON document' },
    { flags: '-f, --file <path>', description: 'Read a canonical Query V6 document from a file' },
    {
      flags: '--definition <path>',
      description: 'Select Nodes satisfying one exact Class',
    },
    { flags: '--edge <class>', description: 'Expand one exact Edge Class' },
    {
      flags: '--direction <direction>',
      description: 'Edge direction (requires --edge)',
      choices: ['outgoing', 'incoming', 'incident'],
    },
    { flags: '--limit <n>', description: 'Finite selected binding limit (default: 100)' },
    { flags: '--cursor <token>', description: 'Resume one live query scope' },
  ],
  action: async (sources, opts) => {
    await queryCommand((sources as string[] | undefined) ?? [], opts as QueryOpts)
  },
} satisfies CommandDefinition
