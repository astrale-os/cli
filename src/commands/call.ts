import chalk from 'chalk'

import type { CallCommandOpts } from '../kernel'

import { withKernelClient, formatKernelError } from '../kernel'
import { formatElapsed } from '../lib/format'
import { log, spinner } from '../lib/log'
import { isRawOutput, output } from '../lib/output'

export async function callCommand(
  path: string,
  rawParams: string[],
  opts: CallCommandOpts,
): Promise<void> {
  const isRaw = isRawOutput(opts)

  // ── Parse params ────────────────────────────────────────
  let params: Record<string, unknown>
  try {
    params = await parseParams(rawParams, opts.data)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid params')
    process.exit(1)
  }

  // ── Connect, call, disconnect ───────────────────────────
  const spin = !isRaw ? spinner(`Calling ${path}...`) : null
  const startTime = performance.now()

  try {
    const result = await withKernelClient(opts, (ctx) =>
      ctx.client.call(path, params, ctx.credential),
    )
    const elapsed = performance.now() - startTime

    spin?.succeed(`${path} ${chalk.dim(`completed in ${formatElapsed(elapsed)}`)}`)
    if (!isRaw) console.log('')
    output(result, opts)
    process.exit(0)
  } catch (error) {
    if (!isRaw && spin) spin.fail('Call failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
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
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw)
  return raw
}
