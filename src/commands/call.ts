import type { CallCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'
import { log } from '../lib/log'
import { output } from '../lib/output'

type CallOpts = CallCommandOpts & { describe?: boolean; dryRun?: boolean }

export async function callCommand(
  path: string,
  rawParams: string[],
  opts: CallOpts,
): Promise<void> {
  // ── Describe mode: show schema without executing ────────
  if (opts.describe) {
    return describeOperation(path, opts)
  }

  // ── Parse params ────────────────────────────────────────
  let params: Record<string, unknown>
  try {
    params = await parseParams(rawParams, opts.data)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid params')
    process.exit(1)
  }

  // ── Dry-run: show what would be sent ─────────────────────
  if (opts.dryRun) {
    output({ method: path, params }, opts)
    return
  }

  // ── Execute ────────────────────────────────────────────
  await runKernelCommand({
    opts,
    label: path,
    fn: (ctx) => ctx.client.call(path, params, ctx.credential),
  })
}

async function describeOperation(path: string, opts: CallOpts): Promise<void> {
  await runKernelCommand<Record<string, unknown>>({
    opts,
    label: `Schema for ${path}`,
    fn: (ctx) =>
      ctx.client.call(`${path}::get`, {}, ctx.credential) as Promise<Record<string, unknown>>,
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

export function parseKeyValue(pairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`Invalid param "${pair}" — expected key=value format`)
    }
    const key = pair.slice(0, eqIdx)
    const raw = pair.slice(eqIdx + 1)
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
