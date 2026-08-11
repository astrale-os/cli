import type { PatchInput } from '@astrale-os/kernel-client/graph'

import { patchDataSchema } from '@astrale-os/kernel-core'
import chalk from 'chalk'
import { readFile } from 'node:fs/promises'

import type { KernelCommandOpts } from '../kernel'
import type { MutationResultWire } from '../kernel'
import type { CommandDefinition } from '../program/index'

import { bindGraph, runKernelCommand } from '../kernel'
import { log } from '../lib/log'
import { output } from '../lib/output'
import { renderTable } from '../lib/table'

type MutateOpts = KernelCommandOpts & { data?: string; file?: string; dry?: boolean }

export async function mutateCommand(opts: MutateOpts): Promise<void> {
  let raw: unknown
  try {
    raw = await readPatch(opts)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid patch')
    process.exit(1)
    return
  }

  // --dry: validate the patch locally against the kernel's own schema and print
  // the normalized form (every arm defaulted to []). No kernel round-trip.
  if (opts.dry) {
    const parsed = patchDataSchema.safeParse(raw)
    if (!parsed.success) {
      log.error('Patch failed local validation:')
      for (const issue of parsed.error.issues) {
        log.dim(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      }
      process.exit(1)
    }
    output(parsed.data, opts)
    return
  }

  await runKernelCommand<MutationResultWire>({
    opts,
    label: 'Mutate',
    fn: (ctx) => bindGraph(ctx).mutate(raw as PatchInput),
    format: (result, fmtOpts, isRaw) => {
      if (isRaw) {
        output(result, fmtOpts)
        return
      }
      printResult(result)
    },
  })
}

/** Patch source ladder (highest wins): --data > --file > stdin. */
async function readPatch(opts: MutateOpts): Promise<unknown> {
  if (opts.data) {
    try {
      return JSON.parse(opts.data)
    } catch {
      throw new Error(`Invalid JSON in --data: ${opts.data}`)
    }
  }
  if (opts.file) {
    let text: string
    try {
      text = await readFile(opts.file, 'utf-8')
    } catch (e) {
      throw new Error(`Cannot read --file ${opts.file}: ${e instanceof Error ? e.message : e}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Invalid JSON in ${opts.file}`)
    }
  }
  const stdin = await readStdin()
  if (stdin) {
    try {
      return JSON.parse(stdin)
    } catch {
      throw new Error('Invalid JSON from stdin')
    }
  }
  throw new Error(
    'No patch provided — pass --data <json>, --file <path>, or pipe a PatchData JSON on stdin',
  )
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || null
}

function printResult(result: MutationResultWire): void {
  const nodeRows = Object.entries(result.createdNodes ?? {})
  const edgeRows = Object.entries(result.createdEdges ?? {})

  if (nodeRows.length === 0 && edgeRows.length === 0) {
    console.log(chalk.dim('  applied — no nodes or edges minted (updates/deletes only)'))
    return
  }

  if (nodeRows.length > 0) {
    console.log(`  ${chalk.bold('Created nodes:')}`)
    console.log(
      renderTable(
        nodeRows.map(([at, id]) => ({ at, id })),
        {
          columns: [
            { key: 'at', header: 'AT', color: chalk.cyan },
            { key: 'id', header: 'ID', color: chalk.dim },
          ],
          showHeader: true,
        },
      ),
    )
    console.log('')
  }

  if (edgeRows.length > 0) {
    console.log(`  ${chalk.bold('Created edges:')}`)
    console.log(
      renderTable(
        edgeRows.map(([tuple, id]) => ({ tuple, id })),
        {
          columns: [
            { key: 'tuple', header: 'CLASS|SOURCE|SLUG|TARGET', color: chalk.cyan },
            { key: 'id', header: 'ID', color: chalk.dim },
          ],
          showHeader: true,
        },
      ),
    )
    console.log('')
  }
}

export default {
  name: 'mutate',
  description: 'Apply a batch graph write (create/update/delete nodes & edges) via function.mutate',
  afterHelpText: `
Behavior:
  Sends a PatchData patch through the kernel's function.mutate door — a
  single all-or-nothing write. Patch source (highest wins): --data > --file
  > stdin. Prints the minted id maps (createdNodes: at→id, createdEdges:
  class|source|slug|target → id); --json emits the raw MutationResult.

  Authorization is per-arm: a create needs USE on the class and EDIT on the
  parent, an update/delete needs EDIT on the target. A denied arm fails the
  whole patch. --dry validates the patch locally (kernel patchDataSchema) and
  prints the normalized form without touching the kernel.

PatchData shape:
  {
    "nodes": {
      "create": [{ "class": "/:d:class.X", "at": "/d/x", "props": {} }],
      "update": [{ "class": "/:d:class.X", "path": "/d/x", "props": {} }],
      "delete": [{ "class": "/:d:class.X", "path": "/d/x" }]
    },
    "edges": {
      "create": [{ "class": "/:d:class.e", "source": "/a", "target": "/b", "props": {} }],
      "delete": [{ "class": "/:d:class.e", "source": "/a", "target": "/b" }]
    }
  }

Examples:
  $ astrale mutate --data '{"nodes":{"create":[{"class":"/:blog.acme.com:class.Author","at":"/blog.acme.com/authors/ada","props":{}}]}}'
  $ astrale mutate --file patch.json
  $ echo '{"nodes":{"delete":[{"class":"/:d:class.X","path":"/d/x"}]}}' | astrale mutate
  $ astrale mutate --file patch.json --dry
`,
  options: [
    { flags: '-d, --data <json>', description: 'PatchData as a JSON string' },
    { flags: '-f, --file <path>', description: 'Read PatchData JSON from a file' },
    {
      flags: '--dry',
      description: 'Validate locally (no kernel call) and print the normalized patch',
    },
  ],
  action: async (opts) => {
    await mutateCommand(opts as MutateOpts)
  },
} satisfies CommandDefinition
