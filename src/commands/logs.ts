import { Path } from '@astrale-os/sdk/graph/path'
import { K } from '@astrale-os/sdk/schema'
import chalk from 'chalk'
import { z } from 'zod'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { ListProjection } from '../lib/terminal/output'
import type { Column } from '../lib/terminal/table'
import type { CommandDefinition } from '../program/index'

import { createPathCall, expandSelfInPath, runKernelCommand } from '../connection'
import { AstraleError } from '../errors'
import { failInput, log } from '../lib/terminal/log'
import { isMachine, output, presentList } from '../lib/terminal/output'

const JOURNAL_PATH = Path.project(K.functions.journal.ref).raw
const DEFAULT_LIMIT = 200
const FOLLOW_INTERVAL_MS = 2_000

type LogsOpts = KernelCommandOpts & {
  since?: string
  until?: string
  topic?: string
  topicPrefix?: string
  principal?: string
  caller?: string
  limit?: string
  cursor?: string
  follow?: boolean
}

const text = z.string({ error: 'must be text' })
const identifier = text.refine(
  (value) => value.trim() !== '' && new TextEncoder().encode(value).byteLength <= 256,
  { error: 'must be non-empty and at most 256 UTF-8 bytes' },
)

/** Journal generation and positions at the time of the read. `id` changes when the journal is recreated. */
const JournalFrontierSchema = z.object({
  id: z.string().refine((id) => id.trim() !== ''),
  first: z.int().min(1).optional(),
  committed: z.int().min(0),
  durable: z.int().min(0),
})

/**
 * The record fields the CLI presentation consumes. `principal` executed the recorded operation (a
 * Domain acting for a user included); `caller`, whose authority it exercised, is recorded only when
 * it differs from the principal and is absent on direct calls.
 */
const JournalRecordSchema = z.object({
  sequence: z.int({ error: 'invalid' }),
  occurredAt: z.string({
    error: (issue) => (issue.input === undefined ? 'missing' : 'must be text'),
  }),
  topic: z.string({ error: 'invalid' }),
  payload: z.unknown().optional(),
  committedAt: text.optional(),
  principal: text.optional(),
  caller: text.optional(),
  correlation: z
    .strictObject(
      {
        operationId: identifier.optional(),
        parentOperationId: identifier.optional(),
        invocationId: identifier.optional(),
        rootInvocationId: identifier.optional(),
        parentInvocationId: identifier.optional(),
        traceId: identifier.optional(),
        spanId: identifier.optional(),
      },
      { error: 'must be an object' },
    )
    .optional(),
})

/** A page without a cursor reached the end of the selection. */
const JournalPageSchema = z.object({
  records: z.array(JournalRecordSchema),
  cursor: z.string().optional(),
  frontier: JournalFrontierSchema.optional(),
  /** Records the reader can no longer receive, or a cursor the Kernel refused. Never an ordinary empty page. */
  gap: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal(['retention', 'generation']), frontier: JournalFrontierSchema }),
      z
        .object({
          kind: z.literal('recovery'),
          from: z.int().min(1),
          through: z.int().min(1),
          frontier: JournalFrontierSchema,
        })
        .refine((gap) => gap.through >= gap.from),
      z.object({ kind: z.literal('cursor'), reason: z.enum(['stale', 'selection', 'visibility']) }),
    ])
    .optional(),
})

type JournalRecord = z.infer<typeof JournalRecordSchema>
type JournalPage = z.infer<typeof JournalPageSchema>
type JournalGap = NonNullable<JournalPage['gap']>

interface JournalInput {
  readonly topics?: { readonly exact?: readonly string[]; readonly prefixes?: readonly string[] }
  readonly principal?: string
  readonly since?: string
  readonly until?: string
  readonly cursor?: string
  readonly limit: number
}

const ISO_TIMESTAMP = z.iso.datetime({ offset: true })
const MILLISECOND_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3}0*)?(?:Z|[+-]\d{2}:\d{2})$/
const CURSOR_TOKEN = /^[A-Za-z0-9._:+=/-]{8,}$/

/** Map flags to the exact public journal syscall input without legacy glob/sequence lowering. */
export function buildJournalInput(opts: LogsOpts): JournalInput {
  const exact = nonEmpty(opts.topic)
  const prefix = nonEmpty(opts.topicPrefix)
  const since = timestampFlag('--since', opts.since)
  const until = timestampFlag('--until', opts.until)
  if (since !== undefined && until !== undefined && Date.parse(since) > Date.parse(until)) {
    throw new TypeError('--since must be earlier than or equal to --until')
  }
  return {
    ...(exact === undefined && prefix === undefined
      ? {}
      : {
          topics: {
            ...(exact === undefined ? {} : { exact: [exact] }),
            ...(prefix === undefined ? {} : { prefixes: [prefix] }),
          },
        }),
    ...(nonEmpty(opts.principal) === undefined ? {} : { principal: opts.principal }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(opts.cursor === undefined ? {} : { cursor: cursorFlag(opts.cursor) }),
    limit: opts.limit === undefined ? DEFAULT_LIMIT : positiveInteger('--limit', opts.limit),
  }
}

function timestampFlag(name: string, raw: string | undefined): string | undefined {
  const value = nonEmpty(raw)
  if (value === undefined) return undefined
  if (!ISO_TIMESTAMP.safeParse(value).success || !MILLISECOND_TIMESTAMP.test(value)) {
    throw new TypeError(
      `${name} must be a valid ISO-8601 timestamp with a timezone and at most millisecond precision (e.g. 2026-08-19T16:51:10.049Z)`,
    )
  }
  return new Date(value).toISOString()
}

function cursorFlag(raw: string): string {
  const value = raw.trim()
  if (!CURSOR_TOKEN.test(value)) {
    throw new TypeError('--cursor must be an opaque journal resume token (at least 8 characters)')
  }
  return value
}

/** Validate the record fields the CLI presentation consumes and retain the cursor, frontier and gap. */
export function acceptJournalPage(input: unknown): JournalPage {
  const page = JournalPageSchema.safeParse(input)
  if (page.success) return page.data
  const [issue] = page.error.issues
  const [section, index, ...field] = issue!.path
  if (section !== 'records' || typeof index !== 'number') {
    throw new TypeError(
      section === undefined || section === 'records'
        ? 'Kernel journal response must contain a records array'
        : `Kernel journal ${String(section)} ${section === 'cursor' ? 'must be text' : 'is invalid'}`,
    )
  }
  const record = `Kernel journal record ${index}`
  if (issue!.code === 'unrecognized_keys') {
    throw new TypeError(`${record}.${[...field, issue!.keys[0]].join('.')} is unsupported`)
  }
  if (field.length === 0 || issue!.message === 'invalid')
    throw new TypeError(`${record} is invalid`)
  if (issue!.message === 'missing') throw new TypeError(`${record} is missing ${field.join('.')}`)
  throw new TypeError(`${record}.${field.join('.')} ${issue!.message}`)
}

/** One sentence naming what the reader lost or why its cursor was refused. */
function describeJournalGap(gap: JournalGap): string {
  switch (gap.kind) {
    case 'retention':
      return gap.frontier.first === undefined
        ? 'Journal records after this cursor were evicted by retention'
        : `Journal records before #${gap.frontier.first} were evicted by retention`
    case 'recovery':
      return `Journal records #${gap.from}–#${gap.through} were lost during journal recovery`
    case 'generation':
      return 'The journal was recreated; records of the previous journal are gone'
    case 'cursor':
      return {
        stale: 'The Kernel no longer accepts this journal cursor',
        selection: 'This journal cursor belongs to another topic, principal or time selection',
        visibility: 'This journal cursor was issued under other read authority',
      }[gap.reason]
  }
}

/**
 * The Kernel records `caller` only when it differs from the principal, so a record without one
 * was a direct call made by its principal.
 */
function effectiveCaller(record: JournalRecord): string | undefined {
  return record.caller ?? record.principal
}

/**
 * Keep the records whose effective caller is exactly `caller`. The journal syscall has no caller
 * input, so the filter applies to each returned page; the cursor still advances past the page.
 */
export function selectCallerRecords(page: JournalPage, caller: string | undefined): JournalPage {
  const wanted = nonEmpty(caller)
  if (wanted === undefined) return page
  return { ...page, records: page.records.filter((record) => effectiveCaller(record) === wanted) }
}

async function fetchPage(context: ConnectionContext, opts: LogsOpts): Promise<JournalPage> {
  return selectCallerRecords(
    acceptJournalPage(
      await context.session.call(createPathCall(JOURNAL_PATH, buildJournalInput(opts))),
    ),
    opts.caller,
  )
}

async function runOnce(opts: LogsOpts): Promise<void> {
  await runKernelCommand({
    opts,
    label: 'Kernel journal',
    fn: async (context) => fetchPage(context, await resolveLogsOpts(opts, context)),
    format: (page, format) => {
      if (isMachine(format) || format.format !== undefined) output(page, format)
      else {
        presentList([...page.records], format, journalProjection)
        if (page.cursor) process.stderr.write(`  cursor: ${page.cursor}\n`)
        if (page.gap) log.warn(describeJournalGap(page.gap))
      }
    },
  })
}

type FollowDependencies = {
  readonly run: typeof runKernelCommand
  readonly pause: (milliseconds: number) => Promise<void>
}

/**
 * Follow one admitted journal stream. Dependencies are explicit so routing is proven at the command boundary.
 *
 * The journal syscall is a finite read: a page that reaches the end of the journal carries no cursor,
 * so the next poll repeats the previous cursor and re-reads its tail. Records are emitted at most
 * once per journal generation by sequence. A new cursor means the Kernel stopped before the end, so
 * the next page is read at once; the follow waits only once it has caught up. A gap is reported on
 * stderr; after retention or a new generation the Kernel returns no cursor, and the follow resumes
 * at the oldest retained record.
 */
export async function followLogs(
  opts: LogsOpts,
  dependencies: FollowDependencies = {
    run: runKernelCommand,
    pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<void> {
  validateLogsOpts(opts)
  await dependencies.run({
    opts,
    label: 'Kernel journal',
    fn: async (context): Promise<never> => {
      const resolved = await resolveLogsOpts(opts, context)
      let cursor = resolved.cursor
      let emitted: { readonly journal?: string; readonly sequence: number } = { sequence: 0 }
      for (;;) {
        const page = await fetchPage(context, { ...resolved, cursor })
        if (page.gap?.kind === 'cursor') {
          throw new AstraleError(
            'JOURNAL_CURSOR_INVALID',
            describeJournalGap(page.gap),
            'Restart without --cursor, or with --since, to read from a known position.',
          )
        }
        if (page.gap !== undefined) reportGap(page.gap, opts)
        if (page.frontier !== undefined && page.frontier.id !== emitted.journal) {
          emitted = { journal: page.frontier.id, sequence: 0 }
        }
        for (const record of page.records) {
          if (record.sequence <= emitted.sequence) continue
          printRecord(record, opts)
          emitted = { ...emitted, sequence: record.sequence }
        }
        if (page.cursor !== undefined && page.cursor !== cursor) {
          cursor = page.cursor
          continue
        }
        if (page.cursor === undefined && page.gap !== undefined && cursor !== undefined) {
          cursor = undefined
          continue
        }
        await dependencies.pause(FOLLOW_INTERVAL_MS)
      }
    },
  })
}

/** Diagnostics never share stdout with the record stream; machine modes get one JSON line. */
function reportGap(gap: JournalGap, opts: LogsOpts): void {
  const message = describeJournalGap(gap)
  if (isMachine(opts) || opts.format === 'json') {
    process.stderr.write(`${JSON.stringify({ warning: 'JOURNAL_GAP', message, gap })}\n`)
  } else log.warn(message)
}

function journalProjection(records: JournalRecord[]): ListProjection {
  const columns: Column[] = [
    { key: 'sequence', header: 'SEQ', color: chalk.dim },
    { key: 'timestamp', header: 'TIME', color: chalk.dim },
    { key: 'topic', header: 'TOPIC', color: chalk.cyan },
    { key: 'principal', header: 'PRINCIPAL', color: chalk.dim },
    { key: 'caller', header: 'CALLER', color: chalk.dim },
  ]
  return {
    columns,
    rows: records.map((record) => ({
      sequence: String(record.sequence),
      timestamp: record.occurredAt,
      topic: record.topic,
      principal: record.principal ?? '',
      caller: effectiveCaller(record) ?? '',
    })),
    paths: records.map((record) => String(record.sequence)),
  }
}

function printRecord(record: JournalRecord, opts: LogsOpts): void {
  // Machine follow is an NDJSON stream: one complete admitted record per line.
  if (isMachine(opts) || opts.format === 'json') {
    process.stdout.write(`${JSON.stringify(record)}\n`)
    return
  }
  process.stdout.write(
    `${chalk.dim(String(record.sequence).padStart(6))} ${chalk.dim(record.occurredAt)} ${chalk.cyan(record.topic)} ${chalk.dim(record.principal ?? '')} ${chalk.dim(effectiveCaller(record) ?? '')}\n`,
  )
}

function validateLogsOpts(opts: LogsOpts): void {
  buildJournalInput(opts)
  if (opts.follow && opts.format === 'yaml' && !opts.json && !opts.raw) {
    throw new TypeError('--follow does not support YAML; use --json for an NDJSON stream')
  }
}

function positiveInteger(flag: string, raw: string): number {
  const value = Number.parseInt(raw, 10)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${flag} must be a positive integer`)
  }
  return value
}

async function resolveLogsOpts(opts: LogsOpts, context: ConnectionContext): Promise<LogsOpts> {
  const principal = nonEmpty(opts.principal)
  const caller = nonEmpty(opts.caller)
  if (principal !== '@self' && caller !== '@self') return opts
  const { path } = await expandSelfInPath('@self', context)
  const self = path.startsWith('@') ? path.slice(1) : path
  return {
    ...opts,
    ...(principal === '@self' ? { principal: self } : {}),
    ...(caller === '@self' ? { caller: self } : {}),
  }
}

function nonEmpty(input: string | undefined): string | undefined {
  const value = input?.trim()
  return value ? value : undefined
}

export default {
  name: 'logs',
  description: 'Read or follow the authorized Kernel journal',
  afterHelpText: `
Behavior:
  Calls the public Kernel journal syscall and emits its { records, cursor, frontier, gap }
  page. Topic selection is exact or prefix-based; cursors are opaque backend tokens.
  A page without a cursor reached the end of the journal. A gap names records lost
  to retention or recovery, a recreated journal, or a refused cursor.
  Timestamps accept ISO-8601 with a timezone and millisecond precision; offsets
  are converted to canonical UTC (e.g. 2026-08-19T16:51:10.000Z).
  --follow reuses one Client Session, advances with the returned cursors and emits
  each record once. It reads the next page at once while the Kernel returns a new
  cursor, and polls every 2 s once caught up. With --json, follow output is NDJSON with one complete admitted
  record per line; YAML follow is unsupported. Gaps are reported on stderr (one JSON
  line with warning JOURNAL_GAP in machine modes), and after retention or a recreated
  journal the follow resumes at the oldest retained record. A refused cursor ends the
  follow with JOURNAL_CURSOR_INVALID.

  --principal filters in the Kernel by the executing principal: a Domain acting
  for a user (managed CLI, Console, astrale call) is the principal of its
  records. --caller keeps the records whose caller, the identity whose authority
  the operation exercised, matches; it filters each returned page, so --limit
  bounds the page before the filter. The Kernel records caller only when it
  differs from the principal, so the effective caller is caller, else principal;
  CALLER shows it. JSON output keeps the record as written. Both accept @self.

Examples:
  $ astrale logs -i staging --limit 50
  $ astrale logs --topic op:function.failed
  $ astrale logs --topic-prefix op:function. --follow
  $ astrale logs --caller @self --topic-prefix op:function.
`,
  options: [
    { flags: '--since <timestamp>', description: 'Inclusive journal timestamp lower bound' },
    { flags: '--until <timestamp>', description: 'Inclusive journal timestamp upper bound' },
    { flags: '--topic <topic>', description: 'Match one exact topic' },
    { flags: '--topic-prefix <prefix>', description: 'Match one topic prefix' },
    { flags: '--principal <id>', description: 'Filter by executing principal identity ID' },
    { flags: '--caller <id>', description: 'Filter by effective caller identity ID' },
    { flags: '--limit <n>', description: `Maximum records (default: ${DEFAULT_LIMIT})` },
    { flags: '--cursor <token>', description: 'Resume from an opaque journal cursor' },
    { flags: '--follow', description: 'Poll using returned cursors until interrupted' },
  ],
  action: async (opts: LogsOpts) => {
    try {
      validateLogsOpts(opts)
    } catch (error) {
      failInput(error, opts)
    }
    if (opts.follow) await followLogs(opts)
    else await runOnce(opts)
  },
} satisfies CommandDefinition
