import chalk from 'chalk'
import { createReadStream, watch } from 'node:fs'
import { access } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { JOURNAL_PATH } from '../lib/paths'
import { log } from '../lib/log'

type JournalEntry = {
  seq: number
  event: {
    id: string
    topic: string
    payload: unknown
    metadata: {
      traceId: string
      timestamp: number
      principal: string
      root: string
      causation?: string
    }
  }
}

type LogsOptions = {
  tail?: boolean
  n?: string
  topic?: string
  since?: string
  principal?: string
  trace?: string
  timing?: boolean
  raw?: boolean
  json?: boolean
}

type DisplayOpts = { timing?: boolean }

export async function logsCommand(opts: LogsOptions): Promise<void> {
  const isRaw = opts.raw || opts.json || !(process.stdout.isTTY ?? false)
  const limit = parseInt(opts.n ?? '20', 10)
  const display: DisplayOpts = { timing: opts.timing }

  try {
    await access(JOURNAL_PATH)
  } catch {
    log.error(`No journal found at ${JOURNAL_PATH}`)
    log.dim('  Is the kernel running? Events are recorded when the manager is active.')
    process.exit(1)
  }

  const sinceMs = opts.since ? parseSince(opts.since) : undefined
  const filter: Filter = {
    topic: opts.topic,
    since: sinceMs,
    principal: opts.principal,
    trace: opts.trace,
  }

  if (opts.tail) {
    await tailStreamMode(isRaw, display, filter)
  } else {
    await tailMode(limit, isRaw, display, filter)
  }
}

// ── Tail mode (read last N entries) ─────────────────────────

type Filter = { topic?: string; since?: number; principal?: string; trace?: string }

async function tailMode(
  limit: number,
  isRaw: boolean,
  display: DisplayOpts,
  filter: Filter,
): Promise<void> {
  const entries: JournalEntry[] = []

  for await (const entry of scanFile()) {
    if (!matchesFilter(entry, filter)) continue
    entries.push(entry)
    if (entries.length > limit) entries.shift()
  }

  if (entries.length === 0) {
    if (!isRaw) log.dim('  No matching events.')
    return
  }

  for (const entry of entries) {
    printEntry(entry, isRaw, display)
  }
}

// ── Tail stream mode (live stream) ──────────────────────────

async function tailStreamMode(isRaw: boolean, display: DisplayOpts, filter: Filter): Promise<void> {
  const recent: JournalEntry[] = []
  for await (const entry of scanFile()) {
    if (!matchesFilter(entry, filter)) continue
    recent.push(entry)
    if (recent.length > 10) recent.shift()
  }
  for (const entry of recent) {
    printEntry(entry, isRaw, display)
  }

  let lastSeq = recent.length > 0 ? recent[recent.length - 1].seq : 0

  return new Promise((_resolve, _reject) => {
    const watcher = watch(JOURNAL_PATH, async () => {
      for await (const entry of scanFile()) {
        if (entry.seq <= lastSeq) continue
        lastSeq = entry.seq
        if (!matchesFilter(entry, filter)) continue
        printEntry(entry, isRaw, display)
      }
    })
    process.on('SIGINT', () => {
      watcher.close()
      process.exit(0)
    })
  })
}

// ── File scanner ────────────────────────────────────────────

async function* scanFile(): AsyncIterable<JournalEntry> {
  try {
    const stream = createReadStream(JOURNAL_PATH, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        yield JSON.parse(line) as JournalEntry
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* file doesn't exist */
  }
}

// ── Filtering ───────────────────────────────────────────────

function matchesFilter(entry: JournalEntry, filter: Filter): boolean {
  if (filter.since && entry.event.metadata.timestamp < filter.since) return false
  if (filter.principal && !entry.event.metadata.principal?.includes(filter.principal)) return false
  if (filter.trace && entry.event.metadata.traceId !== filter.trace) return false
  if (filter.topic && !matchGlob(filter.topic, entry.event.topic)) return false
  return true
}

function matchGlob(pattern: string, topic: string): boolean {
  if (pattern === '**') return true
  const patParts = pattern.split(':')
  const topParts = topic.split(':')

  let pi = 0
  let ti = 0
  while (pi < patParts.length && ti < topParts.length) {
    if (patParts[pi] === '**') return true
    if (patParts[pi] === '*' || patParts[pi] === topParts[ti]) {
      pi++
      ti++
    } else {
      return false
    }
  }
  return pi === patParts.length && ti === topParts.length
}

// ── Output formatting ───────────────────────────────────────

function printEntry(entry: JournalEntry, isRaw: boolean, display: DisplayOpts): void {
  if (isRaw) {
    process.stdout.write(JSON.stringify(entry) + '\n')
    return
  }

  const { event } = entry
  const ts = formatTimestamp(event.metadata.timestamp)
  const topic = colorTopic(event.topic)
  const principal = event.metadata.principal
    ? chalk.dim(shortPrincipal(event.metadata.principal))
    : ''
  const detail = formatDetail(event.topic, event.payload, display)

  console.log(`${chalk.dim(ts)}  ${topic}  ${principal}  ${detail}`)
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

function colorTopic(topic: string): string {
  if (topic.startsWith('sys:')) return chalk.blue(topic)
  if (topic.endsWith(':failed')) return chalk.red(topic)
  if (topic.endsWith(':started')) return chalk.yellow(topic)
  if (topic.endsWith(':completed')) return chalk.green(topic)
  if (topic.startsWith('graph:')) return chalk.magenta(topic)
  return topic
}

function shortPrincipal(principal: string): string {
  const parts = principal.split(':')
  return parts[parts.length - 1]
}

function formatDetail(topic: string, payload: unknown, display: DisplayOpts): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>

  if (topic.endsWith(':completed') && p.result !== undefined) {
    const duration = typeof p.durationMs === 'number' ? chalk.cyan(`${p.durationMs}ms`) : ''

    if (display.timing && p.timing && typeof p.timing === 'object') {
      const steps = formatTiming(p.timing as Record<string, number>)
      return `${duration}  ${steps}`
    }

    const result = JSON.stringify(p.result)
    const truncated = result.length > 80 ? result.slice(0, 80) + '...' : result
    return `${duration}  ${chalk.dim(truncated)}`
  }
  if (topic.endsWith(':failed') && p.error) {
    const err = p.error as { code?: string; message?: string }
    const duration = typeof p.durationMs === 'number' ? chalk.cyan(`${p.durationMs}ms`) : ''

    if (display.timing && p.timing && typeof p.timing === 'object') {
      const steps = formatTiming(p.timing as Record<string, number>)
      return `${duration}  ${steps}  ${chalk.red(err.message ?? err.code ?? 'error')}`
    }

    return `${duration}  ${chalk.red(err.message ?? err.code ?? 'Unknown error')}`
  }
  if (topic.endsWith(':started') && p.params !== undefined) {
    const params = JSON.stringify(p.params)
    return chalk.dim(params.length > 60 ? params.slice(0, 60) + '...' : params)
  }
  return ''
}

const TIMING_KEYS = ['authenticate', 'authorize', 'resolve', 'invariants', 'execute'] as const

function formatTiming(timing: Record<string, number>): string {
  return TIMING_KEYS.filter((k) => timing[k] !== undefined)
    .map((name) => {
      const ms = timing[name]
      const label = `${name}:${ms}`
      return ms > 0 ? chalk.cyan(label) : chalk.dim(label)
    })
    .join(' ')
}

// ── Time parsing ────────────────────────────────────────────

function parseSince(since: string): number {
  const match = since.match(/^(\d+)(s|m|h|d)$/)
  if (match) {
    const [, num, unit] = match
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
    return Date.now() - parseInt(num) * multipliers[unit]
  }
  const ts = Date.parse(since)
  if (!isNaN(ts)) return ts
  return 0
}
