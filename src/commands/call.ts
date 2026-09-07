import { Path } from '@astrale-os/sdk/graph/path'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { createPathCall, expandSelfInCall, runKernelCommand, withSelfHint } from '../connection'
import { presentBinary, readBinaryBody } from '../lib/binary'
import { failInput, log } from '../lib/log'
import { output, present } from '../lib/output'
import { containsSelfRef } from '../lib/self'

type CallOpts = KernelCommandOpts & {
  data?: string
  dryRun?: boolean
  output?: string
}

type CallDependencies = {
  readonly runKernelCommand: typeof runKernelCommand
  readonly output: typeof output
}

const dependencies: CallDependencies = { runKernelCommand, output }

type CallResult = Awaited<ReturnType<ConnectionContext['session']['dispatch']>>
type BinaryCallResult = Extract<CallResult, { readonly kind: 'binary' }>
type BinaryCallInput = Omit<BinaryCallResult, 'value'> & {
  readonly value: Omit<BinaryCallResult['value'], 'body' | 'status'> & {
    readonly body: Uint8Array | AsyncIterable<Uint8Array>
    readonly status?: number
  }
}
type CallResultInput = Exclude<CallResult, { readonly kind: 'binary' }> | BinaryCallInput
type MaterializedBinaryCallResult = Omit<BinaryCallResult, 'value'> & {
  readonly value: Omit<BinaryCallInput['value'], 'body'> & { readonly body: Uint8Array }
}
type MaterializedCallResult =
  | Exclude<CallResult, { readonly kind: 'binary' | 'stream' }>
  | MaterializedBinaryCallResult
  | { readonly kind: 'stream'; readonly values: readonly unknown[] }

export async function callCommand(
  path: string,
  rawParams: string[],
  opts: CallOpts,
  adapters: CallDependencies = dependencies,
): Promise<void> {
  let params: Record<string, unknown>
  try {
    Path.parse(path)
    params = await parseParams(rawParams, opts.data)
  } catch (error) {
    failInput(error, opts)
  }

  const expandParameterSelf = opts.data === undefined && rawParams.length > 0
  const expansionParams = expandParameterSelf ? params : {}

  if (opts.dryRun && !requiresSelfExpansion(path, expansionParams)) {
    adapters.output(createPathCall(path, params), opts)
    return
  }

  await adapters.runKernelCommand<
    MaterializedCallResult | { readonly kind: 'dry'; readonly call: unknown }
  >({
    opts,
    label: path,
    fn: async (ctx) => {
      const expanded = await expandSelfInCall(path, expansionParams, ctx)
      const request = createPathCall(
        expanded.path,
        expandParameterSelf ? expanded.parameters : params,
      )
      if (opts.dryRun) return { kind: 'dry', call: request }
      return withSelfHint(
        async () => materializeCallResult(await ctx.session.dispatch(request)),
        expanded.meta,
      )
    },
    format: async (result, fmtOpts) => {
      switch (result.kind) {
        case 'dry':
          adapters.output(result.call, fmtOpts)
          return
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

function requiresSelfExpansion(path: string, params: Readonly<Record<string, unknown>>): boolean {
  return (
    containsSelfRef(path) ||
    Object.values(params).some((value) => typeof value === 'string' && containsSelfRef(value))
  )
}

/** Drain a session-backed stream before the command-scoped Client Session closes. */
export async function materializeCallResult(
  result: CallResultInput,
): Promise<MaterializedCallResult> {
  if (result.kind === 'binary') {
    const body = await readBinaryBody(result.value.body)
    return Object.freeze({
      ...result,
      value: Object.freeze({ ...result.value, body }),
    })
  }
  if (result.kind !== 'stream') return result
  const values: unknown[] = []
  for await (const value of result.stream) values.push(value)
  return Object.freeze({ kind: 'stream', values: Object.freeze(values) })
}

// ── Param parsing ───────────────────────────────────────────

export async function parseParams(
  rawParams: string[],
  dataFlag?: string,
): Promise<Record<string, unknown>> {
  if (dataFlag !== undefined) {
    if (rawParams.length > 0) {
      log.warn('--data provided, ignoring key=value params')
    }
    try {
      return JSON.parse(dataFlag)
    } catch {
      throw new TypeError(`Invalid JSON in --data: ${dataFlag}`)
    }
  }

  if (rawParams.length > 0) {
    return parseKeyValue(rawParams)
  }

  const stdin = await readStdin()
  if (stdin) {
    try {
      return JSON.parse(stdin)
    } catch {
      throw new TypeError('Invalid JSON from stdin')
    }
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
      throw new TypeError(`Invalid param "${pair}" — expected key=value format`)
    }
    const key = pair.slice(0, eqIdx)
    const raw = pair.slice(eqIdx + 1)
    if (!PARAM_KEY_RE.test(key)) {
      const hint = key.endsWith(':')
        ? ` (looks like httpie's "key:=value" syntax — Astrale CLI doesn't support it; use --data '{"${key.slice(0, -1)}":<value>}' for nested values)`
        : ` (keys must be identifier-shaped: letters, digits, underscore, hyphen)`
      throw new TypeError(`Invalid param key "${key}" in "${pair}"${hint}`)
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
  Param priority (highest wins): --data > key=value > stdin > {}. If
  both --data and key=value are given, key=value is ignored (warned).
  Stdin is read only when piped and no --data/key=value is present
  (ignored on a TTY). --dry-run admits the Path and prints the call
  input offline without resolving an instance; @self still requires
  authenticated expansion. Remote-bound functions auto-mint a
  worker-scoped credential; --creds overrides it.

  Streaming binary bodies are consumed while the Client session remains live,
  then presented through the same --output, --raw, and --json paths as buffered
  binary. JSON retains the application HTTP status and text/base64 body.

Self-reference:
  @self expands to your nodeId on the active instance (path head or
  bare param value, e.g. node=@self). --data and stdin payloads are
  sent verbatim — pre-resolve manually to a literal @<nodeId> there
  (e.g. via 'astrale get @self --json'). Resolution authenticates to
  the selected Kernel and never trusts a local registration or JWT sub.

  Callable input/output lives on astrale introspect <path>.

Examples:
  $ astrale introspect /:kernel.astrale.ai:class.Identity:whois
  $ astrale call /:blog.acme.com:class.Author:list limit=10
  $ astrale call '/:admin.astrale.ai:core.fleet::admin.astrale.ai:class.Fleet.method.listInstances'
  $ astrale call /:kernel.astrale.ai:function.journal --data '{"limit":5}' --json
`,
  arguments: [
    {
      name: 'path',
      description:
        'Operation path (e.g., /:kernel.astrale.ai:class.Identity:whois or @node::domain.example:class.Resource.method.rename)',
    },
    { name: 'params...', description: 'Params as key=value pairs', required: false },
  ],
  options: [
    { flags: '-d, --data <json>', description: 'Params as JSON string' },
    { flags: '-o, --output <file>', description: 'Write binary/raw output to a file' },
    { flags: '--dry-run', description: 'Show what would be sent without executing' },
  ],
  action: async (path, params, opts) => {
    await callCommand(path as string, params as string[], opts)
  },
} satisfies CommandDefinition
