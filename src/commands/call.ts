import { Path } from '@astrale-os/sdk/graph/path'
import { CommanderError } from 'commander'
import { readFile } from 'node:fs/promises'

import type { AdminTargetSelection, ConnectionContext, KernelCommandOpts } from '../connection'
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
  /** `true` (`--admin` alone) selects the configured Admin kernel; a string names its bookmark. */
  admin?: string | true
  adminUrl?: string
  domainIssuer?: string
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
  const admin = adminCallTarget(opts)
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
    ...(admin === undefined ? {} : { admin }),
    credential: opts.dryRun
      ? { principal: 'caller' }
      : { principal: 'callable', path: Path.parse(path) },
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

/**
 * The Admin kernel this call runs on, selected like `domain` commands select it, or undefined for
 * the instance -i/--url/active select. A contradictory selection is a usage error (exit 2),
 * refused before stdin, a --data file or any Kernel is read.
 */
export function adminCallTarget(opts: CallOpts): AdminTargetSelection | undefined {
  if (opts.domainIssuer !== undefined && opts.adminUrl === undefined) {
    throw usageError(
      '--domain-issuer requires --admin-url',
      'It names the Admin Domain issuer of an explicit Admin kernel URL.',
    )
  }
  if (opts.admin === undefined && opts.adminUrl === undefined) return undefined
  if (opts.admin !== undefined && opts.adminUrl !== undefined) {
    throw usageError(
      '--admin cannot be used with --admin-url',
      'Select the Admin kernel by bookmark (--admin [<bookmark>]) or by URL (--admin-url <url>).',
    )
  }
  const selectors = [
    opts.instance === undefined ? null : '-i/--instance',
    opts.url === undefined ? null : '--url',
  ].filter((selector): selector is string => selector !== null)
  if (selectors.length > 0) {
    const flag = opts.admin === undefined ? '--admin-url' : '--admin'
    const selected = selectors.join(' and ')
    throw usageError(
      `${selected} cannot be used with ${flag}`,
      `${selected} ${selectors.length > 1 ? 'select' : 'selects'} an instance; ${flag} selects the Admin kernel.`,
    )
  }
  if (typeof opts.admin === 'string' && looksLikeParam(opts.admin)) {
    throw usageError(
      `--admin took the param "${opts.admin}" as its bookmark`,
      'Put key=value params before --admin, or write --admin= for the configured Admin kernel.',
    )
  }
  return Object.freeze({
    ...(typeof opts.admin === 'string' ? { admin: opts.admin } : {}),
    ...(opts.adminUrl === undefined ? {} : { adminUrl: opts.adminUrl }),
    ...(opts.domainIssuer === undefined ? {} : { domainIssuer: opts.domainIssuer }),
  })
}

/** `--admin [bookmark]` takes an optional value, so a key=value param written after it lands there. */
function looksLikeParam(value: string): boolean {
  const eqIdx = value.indexOf('=')
  return eqIdx > 0 && PARAM_KEY_RE.test(value.slice(0, eqIdx))
}

function usageError(message: string, hint: string): CommanderError {
  return new CommanderError(2, 'commander.conflictingOption', `error: ${message}\n${hint}`)
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
    return parseData(dataFlag)
  }

  if (rawParams.length > 0) {
    return parseKeyValue(rawParams)
  }

  if (process.stdin.isTTY) return {}
  const stdin = (await readStdin()).trim()
  if (stdin) {
    try {
      return JSON.parse(stdin)
    } catch {
      throw new TypeError('Invalid JSON from stdin')
    }
  }

  return {}
}

/**
 * `--data` holds inline JSON, `-` (read stdin) or `@<file>`. The last two keep a value out of argv
 * and shell history, so their contents are parsed like inline JSON but never echoed in an error.
 */
async function parseData(data: string): Promise<Record<string, unknown>> {
  if (data === '-') {
    if (process.stdin.isTTY) {
      throw new TypeError('--data - reads JSON from piped stdin, but stdin is a terminal')
    }
    return parseJson(await readStdin(), 'Invalid JSON from stdin (--data -)')
  }
  if (!data.startsWith('@')) return parseJson(data, `Invalid JSON in --data: ${data}`)
  const file = data.slice(1)
  if (file === '') throw new TypeError('--data @<file> requires a file path')
  let text: string
  try {
    text = await readFile(file, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new TypeError(`Cannot read --data file ${file}${code === undefined ? '' : ` (${code})`}`)
  }
  return parseJson(text, `Invalid JSON in --data file ${file}`)
}

function parseJson(text: string, failure: string): Record<string, unknown> {
  try {
    return JSON.parse(text)
  } catch {
    throw new TypeError(failure)
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
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
  --data takes inline JSON, - (read piped stdin) or @<file>; pass secrets
  as -d - or -d @<file> so their values never sit in argv or shell history.
  Otherwise stdin is read only when piped and no --data/key=value is
  present (ignored on a TTY). --dry-run admits the Path and prints the call
  input offline without resolving an instance; @self still requires
  authenticated expansion. Remote-bound functions auto-mint a
  worker-scoped credential from the callable Domain's installed Publication,
  preserving your authority. Kernel calls retain your principal; --creds
  overrides automatic exchange.

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

Admin kernel:
  --admin [<bookmark>] or --admin-url <url> runs the call on the Admin
  kernel, selected exactly like \`domain\` commands select it: the configured
  Admin target, an Admin bookmark, or a URL with its Admin Domain issuer
  (--domain-issuer). -i and --url select an instance and are refused with
  them (usage error, exit 2), as are --admin with --admin-url and
  --domain-issuer without --admin-url. The call itself is unchanged: it
  exchanges at its callable's declaring Domain as the Admin kernel's
  installation names it; the Admin Domain issuer only completes the Admin
  target. Put key=value params before --admin, or write --admin=<bookmark>.

Examples:
  $ astrale introspect /:kernel.astrale.ai:class.Identity:whois
  $ astrale call /:blog.acme.com:class.Author:list limit=10
  $ astrale call '/:admin.astrale.ai:core.fleet::admin.astrale.ai:class.Fleet.method.listInstances' --admin
  $ astrale call /:kernel.astrale.ai:function.journal --data '{"limit":5}' --json
  $ astrale call /:blog.acme.com:class.Author:create -d @author.json
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
    { flags: '-d, --data <json>', description: 'Params as JSON: inline, - (stdin), or @<file>' },
    { flags: '-o, --output <file>', description: 'Write binary/raw output to a file' },
    { flags: '--dry-run', description: 'Show what would be sent without executing' },
    {
      flags: '--admin [bookmark]',
      description: 'Call on the Admin kernel: the configured one, or this Admin bookmark',
    },
    { flags: '--admin-url <url>', description: 'Call on the Admin kernel at this URL' },
    {
      flags: '--domain-issuer <url>',
      description:
        'Admin Domain issuer of the --admin-url kernel; completes the Admin target as for domain commands',
    },
  ],
  action: async (path, params, opts) => {
    await callCommand(path as string, params as string[], opts)
  },
} satisfies CommandDefinition
