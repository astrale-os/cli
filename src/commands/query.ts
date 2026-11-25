import type { QueryDirection } from '@astrale-os/sdk/query'

import type { KernelCommandOpts, SelfExpansionMeta } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { prepareQuery, prepareQueryDocument, type QueryCommandInput } from '../graph/index'
import { readInputFile } from '../lib/input-file'
import { failInput } from '../lib/terminal/log'
import { isMachine, output } from '../lib/terminal/output'

type QueryOpts = KernelCommandOpts & {
  search?: string
  ast?: string
  file?: string
  class?: string
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
      class: opts.class,
      search: opts.search,
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
    const request = prepareQueryDocument(input)
    if (request !== undefined) {
      return runKernelCommand({
        opts,
        label: 'Query',
        credential: { principal: 'caller' },
        fn: (context) => context.graph.query(request.document, { paging: request.paging }),
        format: (result, format) => output(result, format),
      })
    }
    prepared = prepareQuery(input)
  } catch (error) {
    failInput(error, opts)
  }

  await runKernelCommand({
    opts,
    label: 'Query',
    // A graph command acts as the user on every target, the Admin's included: no Domain bounds it.
    credential: { principal: 'caller' },
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
      output(
        response.page.next === undefined
          ? response.result
          : { ...response.result, page: { next: response.page.next } },
        format,
      )
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
  return parseJson(await readInputFile(opts.file, `--file ${opts.file}`), opts.file)
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
  description: 'Read the graph or search Named Nodes by words',
  afterHelpText: `
Behavior:
  Positional Paths and --class author a finite Query V6 read. --edge adds
  one exact Edge-Class expansion; --direction defaults to outgoing. --ast and
  --file accept a complete canonical astrale.graph.query/v6 document, including
  Property ordering and Node or Edge reference/value projections. A v7 document
  uses "query": "astrale.query/7". --search searches Named.name by relevance.
  A v7 list with complete=false has list.cursor even when empty. Pass it back
  with --cursor, or refine the search. --cursor resumes
  one caller-bound query scope. Machine output adds page.next only when another
  page exists; pass that opaque value back through --cursor.

  Legacy depth/children selector JSON and raw Cypher are not portable Kernel
  V2 query contracts and are not accepted.

Examples:
  $ astrale query --search "elo mar" --limit 20
  $ astrale query /:notes.example.dev:class.Note --limit 50
  $ astrale query --class /:notes.example.dev:class.Note --limit 50
  $ astrale query @note --edge /:notes.example.dev:class.references --direction outgoing --limit 25
  $ astrale query --file query.v6.json --cursor "$CURSOR"
`,
  arguments: [{ name: 'sources...', description: 'Canonical source Paths', required: false }],
  options: [
    {
      flags: '--search <text>',
      description: 'Search Named.name by word prefixes, ordered by relevance',
    },
    { flags: '--ast <json>', description: 'Canonical Query v7 or V6 JSON document' },
    {
      flags: '-f, --file <path>',
      description: 'Read a canonical Query v7 or V6 document from a file',
    },
    {
      flags: '--class <path>',
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
