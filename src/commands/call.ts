import { K } from '@astrale-os/kernel-core'

import type { CommandDefinition } from '../command'
import type { CallCommandOpts, ClientContext, SelfExpansionMeta } from '../kernel'

import { buildSelfContext, resolveOrThrow, runKernelCommand, withSelfHint } from '../kernel'
import { presentBinary, type BinaryLike } from '../lib/binary'
import { log } from '../lib/log'
import { output, present } from '../lib/output'
import { containsSelfRef, expandSelfReferences } from '../lib/self'

type CallOpts = CallCommandOpts & { describe?: boolean; dryRun?: boolean; output?: string }

/** A call resolves to either a JSON value or a binary response. */
type CallResult = { kind: 'binary'; response: BinaryLike } | { kind: 'value'; value: unknown }

export async function callCommand(
  path: string,
  rawParams: string[],
  opts: CallOpts,
): Promise<void> {
  // ── Expand `@self` in path + raw param strings ──────────
  // Local resolution: no kernel round-trip. Throws a typed SelfRefusalError
  // (e.g. no registration, instance-signed) which we
  // surface as a fatal CLI error. Runs BEFORE `--describe` so users get the
  // typed refusal instead of a generic NotFoundError from the kernel.
  let expandedPath = path
  let expandedRaw = rawParams
  let selfMeta: SelfExpansionMeta | undefined
  const inputsHaveSelf = containsSelfRef(path) || rawParams.some(containsSelfRef)
  if (inputsHaveSelf) {
    try {
      const selfCtx = await buildSelfContext(opts)
      const selfId = resolveOrThrow(selfCtx)
      expandedPath = expandSelfReferences(path, selfId)
      expandedRaw = rawParams.map((p) => expandSelfReferences(p, selfId))
      // Stamp metadata whenever ANY input mutated — the stale-registration
      // hint in `formatKernelError` is just as useful when `@self` lived in
      // a param (`node=@self`) as when it was in the path head.
      const rawMutated = expandedRaw.some((p, i) => p !== rawParams[i])
      if (expandedPath !== path || rawMutated) {
        selfMeta = {
          original: path,
          expanded: expandedPath,
          selfId,
          identity: selfCtx.identity?.name,
          slug: selfCtx.instanceSlug,
        }
      }
    } catch (e) {
      log.error(e instanceof Error ? e.message : 'Invalid @self expansion')
      process.exit(1)
    }
  }

  // ── Describe mode: show schema without executing ────────
  // Runs AFTER expansion so `astrale call @self::m --describe` works.
  if (opts.describe) {
    return describeOperation(expandedPath, opts)
  }

  // ── Parse params ────────────────────────────────────────
  let params: Record<string, unknown>
  try {
    params = await parseParams(expandedRaw, opts.data)
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
  await runKernelCommand<CallResult>({
    opts,
    label: expandedPath,
    fn: async (ctx): Promise<CallResult> => {
      // Remote-bound functions live on an external worker. The kernel resolves
      // the call to a redirect carrying the worker's URL + `iss`; the session
      // follows it, minting a worker-scoped delegation for that `iss` (the
      // delegation cache wired in `client.ts`). No client-side binding lookup.
      //
      // The one thing the reactive path can't discover after dispatch is a
      // binary output mode (a JSON decode would corrupt the bytes), so detect
      // it up front and route to the binary transport — which also auto-follows.
      if (await isBinaryOutput(ctx, expandedPath)) {
        const response = await withSelfHint(() => ctx.client.binary(expandedPath, params), selfMeta)
        return { kind: 'binary', response }
      }
      const value = await withSelfHint(() => ctx.client.call(expandedPath, params), selfMeta)
      return { kind: 'value', value }
    },
    format: async (result, fmtOpts) => {
      if (result.kind === 'binary') {
        await presentBinary(result.response, fmtOpts, { outFile: opts.output })
        return
      }
      present(result.value, fmtOpts)
    },
  })
}

/**
 * Best-effort pre-flight: does the target Function declare a binary output?
 * A binary method must use the binary transport (the value path would JSON-
 * decode and corrupt the bytes), and the client can't discover that after
 * dispatch. For a static path the path IS the Function node — read `output`
 * off it via `::get`. For an instance-method path (`<node>::method`) the
 * Function node isn't addressable that way: resolve the instance's class
 * first, then probe the class's method node (`<classPath>:method`). An
 * interface-hosted instance method still escapes the probe (its Function node
 * hangs off the interface, not the class) — that and any other failure returns
 * false and falls through to the value path, letting the kernel surface the
 * real error. `::get` is a kernel syscall (same origin) so it neither
 * redirects nor triggers delegation.
 */
async function isBinaryOutput(ctx: ClientContext, path: string): Promise<boolean> {
  try {
    const target = path.includes('::') ? await instanceMethodNodePath(ctx, path) : path
    if (!target) return false
    const node = (await ctx.client.call(`${target}::get`, {})) as {
      props?: Record<string, unknown>
    } | null
    return node?.props?.[K.$.i('Function').output.key] === 'binary'
  } catch {
    return false
  }
}

/** `<node>::method` → the method's Function-node MethodPath, via the node's class. */
async function instanceMethodNodePath(
  ctx: ClientContext,
  path: string,
): Promise<string | undefined> {
  const sep = path.lastIndexOf('::')
  const source = path.slice(0, sep)
  const method = path.slice(sep + 2)
  if (!source || !method) return undefined
  const node = (await ctx.client.call(`${source}::get`, {})) as { class?: string } | null
  // node.class is a ClassPath (`/:domain:class.Name`); appending `:<method>`
  // forms the MethodPath of the class-owned Function node.
  return node?.class ? `${node.class}:${method}` : undefined
}

async function describeOperation(path: string, opts: CallOpts): Promise<void> {
  await runKernelCommand<Record<string, unknown>>({
    opts,
    label: `Schema for ${path}`,
    fn: (ctx) => ctx.client.call(`${path}::get`, {}) as Promise<Record<string, unknown>>,
    format: (node, fmtOpts) => {
      const props = (node.properties ?? node) as Record<string, unknown>
      const schema: Record<string, unknown> = {}
      if (props.inputSchema) schema.input = tryParseJson(props.inputSchema)
      if (props.outputSchema) schema.output = tryParseJson(props.outputSchema)
      output(Object.keys(schema).length > 0 ? schema : node, fmtOpts)
    },
  })
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
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
  (e.g. via 'astrale describe @self -q', or shell-substituted from the
  registration record in ~/.astrale/identities.json).

Examples:
  $ astrale call /:host.astrale.ai:class.KernelInstance:list
  $ astrale call /:blog.acme.com:class.Author:list limit=10
  $ astrale call '@self::deactivate'
  $ astrale call /:dist.astrale.ai:class.Domain:install --creds "$TOKEN" \\
      -d "$(cat spec.json)"
`,
  arguments: [
    {
      name: 'path',
      description:
        'Operation path (e.g., /:host.astrale.ai:class.KernelInstance:list or /node::method)',
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
