import type { JournalEntry, JournalFilter } from '@astrale-os/kernel-core'

/**
 * `astrale logs` — tail the kernel event journal (function.journal) for the target
 * instance. Defaults to the kernel journal syscall
 * `/kernel.astrale.ai/functions/journal`; `--service <name>` switches to the
 * per-instance `services` domain log buffer (the historical behavior).
 *
 * Target the instance with `-i <instance>` (inherited from withKernelOptions).
 */
import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { ClientContext, KernelCommandOpts } from '../kernel'
import type { Column, ListProjection } from '../lib/output'

import { runKernelCommand, withKernelClient } from '../kernel'
import { fatal, withSpinner } from '../lib/log'
import { isMachine, output, presentList } from '../lib/output'

const JOURNAL_FN_PATH = '/kernel.astrale.ai/functions/journal'
const DEFAULT_SERVICES_ORIGIN = 'services.astrale.ai'
const DEFAULT_LIMIT = 200
const FOLLOW_INTERVAL_MS = 2000
// The journal-read syscall journals its own ops; hide them by default so polling
// doesn't self-pollute the view. `--all` shows them.
const SELF_READ_PREFIX = 'op:function.journal:'

// The published @astrale-os/kernel-core@0.5.0 JournalFilter has no `cursor` yet
// (added on the kernel branch). Type against the augmented shape so the
// incremental cursor compiles against the consumer dependency.
type EventsParams = JournalFilter & { cursor?: number }

type LogsOpts = KernelCommandOpts & {
  since?: string
  until?: string
  topic?: string
  principal?: string
  limit?: string
  cursor?: string
  follow?: boolean
  all?: boolean
  timing?: boolean
  // service mode
  service?: string
  tail?: string
  servicesOrigin?: string
}

/**
 * Kernel journal page. The function.journal syscall returns a BARE `JournalEntry[]`;
 * the client derives the next cursor from the max `seq`. We still model a
 * `nextCursor` field so the TTY footer / incremental tail share one shape, and
 * so a future paged kernel response degrades gracefully.
 */
type EventsPage = {
  entries: JournalEntry[]
  nextCursor?: number | null
}

// ── function.journal (default) ───────────────────────────────────

/** The highest `seq` across entries, or null when empty. */
function maxSeq(entries: JournalEntry[]): number | null {
  let max: number | null = null
  for (const e of entries) {
    if (typeof e.seq === 'number' && (max === null || e.seq > max)) max = e.seq
  }
  return max
}

/**
 * Accept the bare `JournalEntry[]` the syscall returns (and tolerate a paged
 * `{ entries, nextCursor }` shape if the kernel ever switches). `nextCursor` is
 * the max `seq` — the client passes it back as `cursor` to tail incrementally.
 */
export function normalizePage(raw: unknown): EventsPage {
  if (Array.isArray(raw)) {
    const entries = raw as JournalEntry[]
    return { entries, nextCursor: maxSeq(entries) }
  }
  const obj = (raw ?? {}) as { entries?: unknown; nextCursor?: unknown }
  const entries = Array.isArray(obj.entries) ? (obj.entries as JournalEntry[]) : []
  const nextCursor = typeof obj.nextCursor === 'number' ? obj.nextCursor : maxSeq(entries)
  return { entries, nextCursor }
}

/** Build the JournalFilter (+ optional seq cursor) from typed flags. */
export function buildEventsParams(opts: LogsOpts): EventsParams {
  const params: EventsParams = {}
  if (opts.topic) params.topic = opts.topic
  if (opts.principal) params.principal = opts.principal as JournalFilter['principal']
  if (opts.since !== undefined) params.since = parseTimeFlag('--since', opts.since)
  if (opts.until !== undefined) params.until = parseTimeFlag('--until', opts.until)
  params.limit = opts.limit !== undefined ? parsePositiveInt('--limit', opts.limit) : DEFAULT_LIMIT
  if (opts.cursor !== undefined) params.cursor = parsePositiveInt('--cursor', opts.cursor)
  return params
}

/** Accept epoch-ms or an ISO-8601 string → epoch ms. */
export function parseTimeFlag(flag: string, raw: string): number {
  if (/^-?\d+$/.test(raw)) return Number(raw)
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) throw new Error(`${flag} needs epoch-ms or ISO-8601, got "${raw}"`)
  return ms
}

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} needs a positive integer, got "${raw}"`)
  }
  return n
}

const TOPIC_COLOR = (s: string): string =>
  s.startsWith('op:') ? chalk.cyan(s) : s.startsWith('sys:') ? chalk.magenta(s) : chalk.dim(s)

/** op:*:completed|failed carry `durationMs` in their payload; started does not. */
const latencyOf = (e: JournalEntry): string => {
  const d = (e.event.payload as { durationMs?: number } | undefined)?.durationMs
  return typeof d === 'number' ? `${d}ms` : ''
}

/** Highlight slow ops: green < 100ms, yellow < 500ms, red beyond. */
const LATENCY_COLOR = (s: string): string => {
  if (!s) return s
  const ms = Number.parseInt(s, 10)
  if (ms >= 500) return chalk.red(s)
  if (ms >= 100) return chalk.yellow(s)
  return chalk.green(s)
}

/** Short labels for the per-step dispatch timing (payload.timing). */
const STEP_LABEL: Record<string, string> = {
  authenticate: 'auth',
  validateInput: 'in',
  authorize: 'authz',
  resolve: 'resolve',
  invariants: 'inv',
  execute: 'exec',
  validateOutput: 'out',
  effects: 'fx',
}

/** Compact per-step breakdown, non-zero steps only: e.g. "auth:7 authz:13 exec:12". */
const timingOf = (e: JournalEntry): string => {
  const t = (e.event.payload as { timing?: Record<string, number> } | undefined)?.timing
  if (!t || typeof t !== 'object') return ''
  return Object.entries(t)
    .filter(([, ms]) => typeof ms === 'number' && ms > 0)
    .map(([k, ms]) => `${STEP_LABEL[k] ?? k}:${ms}`)
    .join(' ')
}

function eventsProjection(entries: JournalEntry[], showTiming = false): ListProjection {
  const columns: Column[] = [
    { key: 'seq', header: 'SEQ', color: chalk.dim },
    { key: 'ts', header: 'TIME', color: chalk.dim },
    { key: 'topic', header: 'TOPIC', color: TOPIC_COLOR },
    { key: 'latency', header: 'LATENCY', color: LATENCY_COLOR },
    ...(showTiming ? [{ key: 'steps', header: 'STEPS', color: chalk.dim } as Column] : []),
    { key: 'principal', header: 'PRINCIPAL', color: chalk.dim },
  ]
  return {
    columns,
    rows: entries.map((e) => ({
      seq: String(e.seq),
      ts: new Date(e.event.metadata.timestamp).toISOString(),
      topic: e.event.topic,
      latency: latencyOf(e),
      ...(showTiming ? { steps: timingOf(e) } : {}),
      principal: String(e.event.metadata.principal),
    })),
    paths: entries.map((e) => String(e.seq)),
  }
}

async function fetchEventsPage(ctx: ClientContext, opts: LogsOpts): Promise<EventsPage> {
  const raw = await ctx.client.call(JOURNAL_FN_PATH, buildEventsParams(opts))
  const page = normalizePage(raw)
  // Strip the journal's own read ops by default (but keep nextCursor past them).
  const entries = opts.all
    ? page.entries
    : page.entries.filter((e) => !e.event.topic.startsWith(SELF_READ_PREFIX))
  return { entries, nextCursor: page.nextCursor }
}

function printEventLine(e: JournalEntry, showTiming = false): void {
  const ts = new Date(e.event.metadata.timestamp).toISOString()
  const lat = latencyOf(e)
  const steps = showTiming ? timingOf(e) : ''
  process.stdout.write(
    `${chalk.dim(String(e.seq).padStart(6))} ${chalk.dim(ts)} ${TOPIC_COLOR(e.event.topic)} ${chalk.dim(String(e.event.metadata.principal))}${lat ? ` ${LATENCY_COLOR(lat)}` : ''}${steps ? ` ${chalk.dim(`[${steps}]`)}` : ''}\n`,
  )
}

async function runEvents(opts: LogsOpts): Promise<void> {
  if (opts.follow) return followEvents(opts)

  await runKernelCommand<EventsPage>({
    opts,
    label: 'Kernel events',
    fn: (ctx) => fetchEventsPage(ctx, opts),
    format: (page, fmtOpts) => {
      if (isMachine(fmtOpts) || fmtOpts.format) {
        // Machine surface: the kernel's own entries array, no projection.
        output(page.entries, fmtOpts)
        return
      }
      presentList(page.entries, fmtOpts, (entries) => eventsProjection(entries, opts.timing))
      if (typeof page.nextCursor === 'number') {
        process.stdout.write(chalk.dim(`  tail: --follow  (or --cursor ${page.nextCursor})\n`))
      }
    },
  })
}

/**
 * Client-side polling follow (ctx.client exposes no stream transport). Take the
 * max `seq` from each page and pass it back as `cursor` (exclusive cursor) so
 * the next poll only returns new entries.
 */
async function followEvents(opts: LogsOpts): Promise<void> {
  await withKernelClient(opts, async (ctx) => {
    let cursor = opts.cursor !== undefined ? parsePositiveInt('--cursor', opts.cursor) : undefined
    for (;;) {
      const page = await fetchEventsPage(ctx, { ...opts, cursor: cursor?.toString() })
      for (const e of page.entries) printEventLine(e, opts.timing)
      if (typeof page.nextCursor === 'number') cursor = page.nextCursor
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS))
    }
  })
}

// ── --service (legacy services-domain log buffer) ───────────

type ServiceLogs = {
  name: string
  lines: Array<{ ts: number; level: string; line: string }>
}

const LEVEL_COLOR: Record<string, (s: string) => string> = {
  error: chalk.red,
  warn: chalk.yellow,
  access: chalk.cyan,
  debug: chalk.dim,
}

/** Accept a bare service name, a `<name>.…` host, or a full https URL → the service name. */
export function parseServiceName(ref: string): string {
  let host = ref.trim()
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      // keep the raw value — the call will fail loud with the name
    }
  }
  return host.includes('.') ? (host.split('.')[0] ?? host) : host
}

async function runService(opts: LogsOpts): Promise<void> {
  const name = parseServiceName(opts.service as string)
  const origin = opts.servicesOrigin ?? DEFAULT_SERVICES_ORIGIN
  const tail = opts.tail !== undefined ? Number(opts.tail) : undefined
  if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) {
    throw new Error(`--tail needs a positive integer, got "${opts.tail}"`)
  }
  const result = await withSpinner(`Fetching logs for ${name}`, !isMachine(opts), () =>
    withKernelClient(
      opts,
      async (ctx) =>
        (await ctx.client.call(
          `/${origin}/services/${name}::logs`,
          tail !== undefined ? { tail } : {},
        )) as ServiceLogs,
    ),
  )
  if (isMachine(opts)) {
    output(result, opts)
    return
  }
  if (result.lines.length === 0) {
    console.log(chalk.dim(`no log lines captured yet for ${result.name}`))
    return
  }
  for (const entry of result.lines) {
    const ts = new Date(entry.ts).toISOString()
    const paint = LEVEL_COLOR[entry.level] ?? ((s: string) => s)
    console.log(`${chalk.dim(ts)} ${paint(entry.level.padEnd(6))} ${entry.line}`)
  }
}

export default {
  name: 'logs',
  description: 'Tail the kernel event journal (or a service log buffer with --service)',
  options: [
    { flags: '--since <t>', description: 'Events at/after this time (epoch-ms or ISO-8601)' },
    { flags: '--until <t>', description: 'Events at/before this time (epoch-ms or ISO-8601)' },
    { flags: '--topic <glob>', description: 'Topic glob (e.g. op:*:failed, graph:node:**)' },
    { flags: '--principal <id>', description: 'Filter by the triggering identity' },
    { flags: '--limit <n>', description: `Max entries (default ${DEFAULT_LIMIT})` },
    { flags: '--cursor <n>', description: 'Start after this journal sequence number' },
    { flags: '--follow', description: 'Poll for new events (Ctrl-C to stop)' },
    { flags: '--all', description: 'Include the journal-read syscall ops (hidden by default)' },
    { flags: '--timing', description: 'Show the per-step dispatch breakdown (auth/authz/exec/…)' },
    { flags: '--service <name>', description: 'Tail a deployed service log buffer instead' },
    { flags: '--tail <n>', description: '[--service] lines to return (default 200, max 500)' },
    {
      flags: '--services-origin <origin>',
      description: `[--service] services-domain origin (default ${DEFAULT_SERVICES_ORIGIN})`,
    },
  ],
  afterHelpText: `
Default: tails the kernel event journal via ${JOURNAL_FN_PATH} on the target
instance (-i <instance>). Topics use ':'-segmented globs ('*' one segment,
'**' zero-or-more). Machine output (--json / pipe) emits the JournalEntry[]
array; a TTY shows a SEQ/TIME/TOPIC/LATENCY/PRINCIPAL table (LATENCY is the
op's durationMs, present on :completed/:failed). --timing adds a STEPS column
with the per-step dispatch breakdown (auth/in/authz/resolve/inv/exec/out/fx,
non-zero only). --follow polls for new entries (client-side, tailing by
sequence number). The journal-read syscall's own ops are hidden unless --all.

--service <name> switches to the per-instance 'services' domain log buffer
(console output, 5xx accesses, uncaught exceptions). Requires the services
domain installed on the target instance.

Examples:
  astrale logs -i staging
  astrale logs -i staging --topic 'op:*:failed' --limit 50
  astrale logs -i staging --topic 'op:*:completed' --timing
  astrale logs -i staging --since 2026-06-20T00:00:00Z --follow
  astrale logs --service my-notes -i staging --tail 50
`,
  action: async (opts: LogsOpts) => {
    try {
      if (opts.service) {
        await runService(opts)
      } else {
        await runEvents(opts)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
