import chalk from 'chalk'
import { KernelWSClient } from '@astrale-os/kernel-client-ws'
import { readConfig } from '../lib/config'
import { signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'
import { log, spinner } from '../lib/log'
import { getDefault, getIdentity } from '../lib/identity'
import { highlightJson, formatElapsed } from '../lib/format'

type CallOptions = {
  data?: string
  raw?: boolean
  json?: boolean
  kernel?: string
  timeout?: string
  as?: string
}

export async function callCommand(
  method: string,
  rawParams: string[],
  opts: CallOptions,
): Promise<void> {
  const isTTY = process.stdout.isTTY ?? false
  const isRaw = opts.raw || opts.json || !isTTY

  // ── Parse params ────────────────────────────────────────
  let params: Record<string, unknown>
  try {
    params = await parseParams(rawParams, opts.data)
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'Invalid params')
    process.exit(1)
  }

  // ── Load config + auth ──────────────────────────────────
  const config = await readConfig()
  const wsUrl = opts.kernel ?? `ws://localhost:${config.managerPort}/ws`

  let credential: string
  try {
    const identity = opts.as
      ? await getIdentity(opts.as)
      : await getDefault()
    credential = await signAs(identity.subject, KEYS_DIR, { issuer: config.issuer })
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'No auth keys found. Run `astrale init` first.')
    process.exit(1)
  }

  // ── Connect, call, disconnect ───────────────────────────
  const client = new KernelWSClient({
    wsUrl,
    autoConnect: false,
    reconnect: false,
    maxRetries: 0,
    requestTimeout: parseInt(opts.timeout ?? '30000', 10),
  })

  const spin = !isRaw ? spinner(`Calling ${method}...`) : null
  const startTime = performance.now()

  try {
    await client.connect()
    const result = await client.call(method, params, credential)
    const elapsed = performance.now() - startTime

    await client.close()

    if (isRaw) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      spin?.succeed(`${method} ${chalk.dim(`completed in ${formatElapsed(elapsed)}`)}`)
      console.log('')
      console.log(highlightJson(JSON.stringify(result, null, 2)))
    }
    process.exit(0)
  } catch (error) {
    await client.close().catch(() => {})

    if (!isRaw && spin) spin.fail('Call failed')

    formatError(error, isRaw, wsUrl)
    process.exit(1)
  }
}

// ── Param parsing ───────────────────────────────────────────

async function parseParams(
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

function parseKeyValue(pairs: string[]): Record<string, unknown> {
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

function coerceValue(raw: string): unknown {
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw)
  return raw
}

// ── Error formatting ────────────────────────────────────────

function formatError(error: unknown, isRaw: boolean, wsUrl: string): void {
  if (!(error instanceof Error)) {
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: 'UNKNOWN', message: String(error) }) + '\n')
    } else {
      log.error(String(error))
    }
    return
  }

  const name = error.name

  if (name === 'ConnectionError') {
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: 'CONNECTION_ERROR', message: error.message }) + '\n')
    } else {
      log.error(`Could not connect to ${chalk.bold(wsUrl)}`)
      log.dim('  Is the kernel running? Try: astrale status')
    }
    return
  }

  if (name === 'TimeoutError') {
    const timeoutMs = (error as { timeoutMs?: number }).timeoutMs
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: 'TIMEOUT', message: error.message }) + '\n')
    } else {
      log.error(`Request timed out after ${timeoutMs ?? '?'}ms`)
      log.dim('  Try increasing with --timeout')
    }
    return
  }

  if (name === 'ValidationError') {
    const errors = (error as { errors?: Array<{ path: string[]; code: string; message: string }> }).errors ?? []
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: 'VALIDATION_ERROR', message: error.message, details: errors }) + '\n')
    } else {
      log.error('Validation Error')
      for (const e of errors) {
        console.log(chalk.red(`  ${e.path.join('.')}: ${e.message} (${chalk.dim(e.code)})`))
      }
    }
    return
  }

  if (name === 'InvariantViolationError') {
    const errors = (error as { errors?: Array<{ code: string; message: string; context?: unknown }> }).errors ?? []
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: 'INVARIANT_VIOLATION', message: error.message, details: errors }) + '\n')
    } else {
      log.error('Invariant Violation')
      for (const e of errors) {
        console.log(chalk.red(`  ${e.code}: ${e.message}`))
        if (e.context) {
          console.log(chalk.dim(`    ${JSON.stringify(e.context)}`))
        }
      }
    }
    return
  }

  if (name === 'KernelError') {
    const code = (error as { code?: string }).code ?? 'UNKNOWN'
    if (isRaw) {
      process.stderr.write(JSON.stringify({ error: code, message: error.message }) + '\n')
    } else {
      log.error(`${chalk.bold(code)}: ${error.message}`)
    }
    return
  }

  // Fallback
  if (isRaw) {
    process.stderr.write(JSON.stringify({ error: 'UNKNOWN', message: error.message }) + '\n')
  } else {
    log.error(error.message)
  }
}
