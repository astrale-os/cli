import { Path } from '@astrale-os/sdk/graph/path'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { createPathCall, expandSelfInCall, runKernelCommand, withSelfHint } from '../connection'
import { nodeProperty } from '../graph/index'
import { presentBinary } from '../lib/binary'
import { log } from '../lib/log'
import { output, present } from '../lib/output'
import { describeCallableFromSchema, missingCallableDescription } from './call-describe'

type CallOpts = KernelCommandOpts & {
  data?: string
  describe?: boolean
  dryRun?: boolean
  output?: string
}

type CallResult = Awaited<ReturnType<ConnectionContext['session']['dispatch']>>
type MaterializedCallResult =
  | Exclude<CallResult, { readonly kind: 'stream' }>
  | { readonly kind: 'stream'; readonly values: readonly unknown[] }

export async function callCommand(
  path: string,
  rawParams: string[],
  opts: CallOpts,
): Promise<void> {
  // Expand @self before describe/execute through authenticated Identity.whoami.
  let expanded: Awaited<ReturnType<typeof expandSelfInCall>>
  try {
    expanded = await expandSelfInCall(path, rawParams, opts)
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Invalid @self expansion')
    process.exit(1)
  }
  const expandedPath = expanded.path

  // ── Describe mode: show schema without executing ────────
  // Runs AFTER expansion so `astrale call @self::m --describe` works.
  if (opts.describe) {
    return describeOperation(expandedPath, opts)
  }

  // ── Parse params ────────────────────────────────────────
  let params: Record<string, unknown>
  try {
    params = await parseParams([...expanded.parameters], opts.data)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid params')
    process.exit(1)
  }

  // ── Dry-run: show what would be sent ─────────────────────
  if (opts.dryRun) {
    output({ method: expandedPath, params }, opts)
    return
  }

  // ── Execute ────────────────────────────────────────────
  await runKernelCommand<MaterializedCallResult>({
    opts,
    label: expandedPath,
    fn: (ctx) =>
      withSelfHint(
        async () =>
          materializeCallResult(await ctx.session.dispatch(createPathCall(expandedPath, params))),
        expanded.meta,
      ),
    format: async (result, fmtOpts) => {
      switch (result.kind) {
        case 'value':
          present(result.value, fmtOpts)
          return
        case 'binary':
          await presentBinary(result.value, fmtOpts, { outFile: opts.output })
          return
        case 'stream':
          output(result.values, fmtOpts)
          return
        case 'redirect':
          throw new Error('Client Session returned an unresolved redirect.')
      }
    },
  })
}

/** Drain a session-backed stream before the command-scoped Client Session closes. */
export async function materializeCallResult(result: CallResult): Promise<MaterializedCallResult> {
  if (result.kind !== 'stream') return result
  const values: unknown[] = []
  for await (const value of result.stream) values.push(value)
  return Object.freeze({ kind: 'stream', values: Object.freeze(values) })
}

async function describeOperation(path: string, opts: CallOpts): Promise<void> {
  await runKernelCommand({
    opts,
    label: `Schema for ${path}`,
    fn: async ({ graph }) => {
      const parsed = Path.parse(path)
      if (parsed.ast.anchor.kind !== 'domain') {
        throw missingCallableDescription(path)
      }
      const domain = await graph.getOrThrow(Path.parse(`/:${parsed.ast.anchor.origin}`))
      const described = describeCallableFromSchema(parsed, nodeProperty(domain, 'schema'))
      if (described === undefined) throw missingCallableDescription(path)
      return described
    },
    format: (schema, fmtOpts) => output(schema, fmtOpts),
  })
}

// ── Param parsing ───────────────────────────────────────────

export async function parseParams(
  rawParams: string[],
  dataFlag?: string,
): Promise<Record<string, unknown>> {
  if (dataFlag) {
    if (rawParams.length > 0) {
      log.warn('--data provided, ignoring key=value params')
    }
    try {
      return JSON.parse(dataFlag)
    } catch {
      throw new Error(`Invalid JSON in --data: ${dataFlag}`)
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

  if (rawParams.length > 0) {
    return parseKeyValue(rawParams)
  }

  return {}
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || null
}

// Top-level param keys are identifier-shaped: letters, digits, underscore,
// hyphen. No `:` (would catch httpie's `key:=value` syntax — not supported,
// use `--data '{...}'` instead) and no `.` (qualified prop keys appear
// inside nested objects, never as top-level CLI params).
const PARAM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function parseKeyValue(pairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`Invalid param "${pair}" — expected key=value format`)
    }
    const key = pair.slice(0, eqIdx)
    const raw = pair.slice(eqIdx + 1)
    if (!PARAM_KEY_RE.test(key)) {
      const hint = key.endsWith(':')
        ? ` (looks like httpie's "key:=value" syntax — Astrale CLI doesn't support it; use --data '{"${key.slice(0, -1)}":<value>}' for nested values)`
        : ` (keys must be identifier-shaped: letters, digits, underscore, hyphen)`
      throw new Error(`Invalid param key "${key}" in "${pair}"${hint}`)
    }
    result[key] = coerceValue(raw)
  }
  return result
}

export function coerceValue(raw: string): unknown {
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw)
    } catch {
      /* fall through */
    }
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

export default {
  name: 'call',
  description: 'Call a kernel operation',
  afterHelpText: `
Behavior:
  Param priority (highest wins): --data > stdin > key=value > {}. If
  both --data and key=value are given, key=value is ignored (warned).
  Stdin is read only when piped (ignored on a TTY). --describe and
  --dry-run short-circuit (no execution). Remote-bound functions
  auto-mint a worker-scoped credential; --creds overrides it.

Self-reference:
  @self expands to your nodeId on the active instance (path head or
  bare param value, e.g. node=@self). --data and stdin payloads are
  sent verbatim — pre-resolve manually to a literal @<nodeId> there
  (e.g. via 'astrale get @self --json'). Resolution authenticates to
  the selected Kernel and never trusts a local registration or JWT sub.

  --describe reads the callable's input/output from the installed Domain
  schema. Method Paths are not Function nodes.

Examples:
  $ astrale call /:host.astrale.ai:class.Manager:createInstance --describe
  $ astrale call /:blog.acme.com:class.Author:list limit=10
  $ astrale call '@self::deactivate'
  $ astrale call /:kernel.astrale.ai:function.journal --data '{"limit":5}' --json
`,
  arguments: [
    {
      name: 'path',
      description:
        'Operation path (e.g., /:host.astrale.ai:class.Manager:createInstance or /node::method)',
    },
    { name: 'params...', description: 'Params as key=value pairs', required: false },
  ],
  options: [
    { flags: '-d, --data <json>', description: 'Params as JSON string' },
    { flags: '-o, --output <file>', description: 'Write binary/raw output to a file' },
    { flags: '--describe', description: 'Show operation schema without executing' },
    { flags: '--dry-run', description: 'Show what would be sent without executing' },
  ],
  action: async (path, params, opts) => {
    await callCommand(path as string, params as string[], opts)
  },
} satisfies CommandDefinition
