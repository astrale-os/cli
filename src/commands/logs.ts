import { Path } from '@astrale-os/sdk/graph/path'
import { K } from '@astrale-os/sdk/schema'
import chalk from 'chalk'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { Column, ListProjection } from '../lib/output'
import type { CommandDefinition } from '../program/index'

import { createPathCall, expandSelfInPath, runKernelCommand } from '../connection'
import { failInput } from '../lib/log'
import { isMachine, output, presentList } from '../lib/output'

const JOURNAL_PATH = Path.project(K.functions.journal.ref).raw
const DEFAULT_LIMIT = 200
const FOLLOW_INTERVAL_MS = 2_000

type LogsOpts = KernelCommandOpts & {
  since?: string
  until?: string
  topic?: string
  topicPrefix?: string
  principal?: string
  limit?: string
  cursor?: string
  follow?: boolean
}

export interface JournalRecord {
  readonly sequence: number
  readonly timestamp: string
  readonly topic: string
  readonly payload: unknown
  readonly occurredAt?: string
  readonly committedAt?: string
  readonly principal?: string
  readonly correlation?: JournalCorrelation
  readonly correlationId?: string
  readonly causationId?: string
}

export interface JournalCorrelation {
  readonly operationId?: string
  readonly parentOperationId?: string
  readonly invocationId?: string
  readonly rootInvocationId?: string
  readonly parentInvocationId?: string
  readonly traceId?: string
  readonly spanId?: string
}

export interface JournalPage {
  readonly records: readonly JournalRecord[]
  readonly cursor?: string
}

export interface JournalInput {
  readonly topics?: { readonly exact?: readonly string[]; readonly prefixes?: readonly string[] }
  readonly principal?: string
  readonly since?: string
  readonly until?: string
  readonly cursor?: string
  readonly limit: number
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
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
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO-8601 timestamp (e.g. 2026-08-19T16:51:10.049Z)`)
  }
  return value
}

function cursorFlag(raw: string): string {
  const value = raw.trim()
  if (!CURSOR_TOKEN.test(value)) {
    throw new TypeError('--cursor must be an opaque journal resume token (at least 8 characters)')
  }
  return value
}

/** Validate the record fields the CLI presentation consumes and retain the opaque cursor. */
export function acceptJournalPage(input: unknown): JournalPage {
  if (!isRecord(input) || !Array.isArray(input.records)) {
    throw new TypeError('Kernel journal response must contain a records array')
  }
  const records = input.records.map((record, index) => acceptRecord(record, index))
  if (input.cursor !== undefined && typeof input.cursor !== 'string') {
    throw new TypeError('Kernel journal cursor must be text')
  }
  return Object.freeze({
    records: Object.freeze(records),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  })
}

async function fetchPage(context: ConnectionContext, opts: LogsOpts): Promise<JournalPage> {
  return acceptJournalPage(
    await context.session.call(createPathCall(JOURNAL_PATH, buildJournalInput(opts))),
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
      }
    },
  })
}

type FollowDependencies = {
  readonly run: typeof runKernelCommand
  readonly pause: (milliseconds: number) => Promise<void>
}

/** Follow one admitted journal stream. Dependencies are explicit so routing is proven at the command boundary. */
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
      for (;;) {
        const page = await fetchPage(context, { ...resolved, cursor })
        for (const record of page.records) printRecord(record, opts)
        cursor = page.cursor ?? cursor
        await dependencies.pause(FOLLOW_INTERVAL_MS)
      }
    },
  })
}

function journalProjection(records: JournalRecord[]): ListProjection {
  const columns: Column[] = [
    { key: 'sequence', header: 'SEQ', color: chalk.dim },
    { key: 'timestamp', header: 'TIME', color: chalk.dim },
    { key: 'topic', header: 'TOPIC', color: chalk.cyan },
    { key: 'principal', header: 'PRINCIPAL', color: chalk.dim },
  ]
  return {
    columns,
    rows: records.map((record) => ({
      sequence: String(record.sequence),
      timestamp: record.timestamp,
      topic: record.topic,
      principal: record.principal ?? '',
    })),
    paths: records.map((record) => String(record.sequence)),
  }
}

function printRecord(record: JournalRecord, opts: LogsOpts): void {
  if (isMachine(opts) || opts.format === 'json') {
    process.stdout.write(formatFollowRecord(record))
    return
  }
  process.stdout.write(
    `${chalk.dim(String(record.sequence).padStart(6))} ${chalk.dim(record.timestamp)} ${chalk.cyan(record.topic)} ${chalk.dim(record.principal ?? '')}\n`,
  )
}

/** Machine follow is an NDJSON stream: one complete admitted record per line. */
export function formatFollowRecord(record: JournalRecord): string {
  return `${JSON.stringify(record)}\n`
}

export function validateLogsOpts(opts: LogsOpts): void {
  buildJournalInput(opts)
  if (opts.follow && opts.format === 'yaml' && !opts.json && !opts.raw) {
    throw new TypeError('--follow does not support YAML; use --json for an NDJSON stream')
  }
}

function acceptRecord(input: unknown, index: number): JournalRecord {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.sequence) ||
    typeof input.topic !== 'string'
  ) {
    throw new TypeError(`Kernel journal record ${index} is invalid`)
  }
  const occurredAt = optionalText(input.occurredAt, index, 'occurredAt')
  const timestamp = optionalText(input.timestamp, index, 'timestamp') ?? occurredAt
  if (timestamp === undefined) {
    throw new TypeError(`Kernel journal record ${index} is missing occurredAt/timestamp`)
  }
  const correlation = acceptCorrelation(input.correlation, index)
  const legacyCorrelationId = optionalIdentifier(input.correlationId, index, 'correlationId')
  const structuredCorrelationId = correlation?.invocationId
  if (
    legacyCorrelationId !== undefined &&
    structuredCorrelationId !== undefined &&
    legacyCorrelationId !== structuredCorrelationId
  ) {
    throw new TypeError(`Kernel journal record ${index} has conflicting correlation identifiers`)
  }
  const correlationId = structuredCorrelationId ?? legacyCorrelationId
  const principal = optionalText(input.principal, index, 'principal')
  return Object.freeze({
    sequence: input.sequence as number,
    timestamp,
    topic: input.topic,
    payload: input.payload,
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(optionalText(input.committedAt, index, 'committedAt') === undefined
      ? {}
      : { committedAt: input.committedAt as string }),
    ...(principal === undefined ? {} : { principal }),
    ...(correlation === undefined ? {} : { correlation }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(optionalIdentifier(input.causationId, index, 'causationId') === undefined
      ? {}
      : { causationId: input.causationId as string }),
  })
}

const correlationFields = [
  'operationId',
  'parentOperationId',
  'invocationId',
  'rootInvocationId',
  'parentInvocationId',
  'traceId',
  'spanId',
] as const

function acceptCorrelation(input: unknown, index: number): JournalCorrelation | undefined {
  if (input === undefined) return undefined
  if (!isRecord(input)) {
    throw new TypeError(`Kernel journal record ${index}.correlation must be an object`)
  }
  const unknown = Object.keys(input).find(
    (field) => !correlationFields.includes(field as (typeof correlationFields)[number]),
  )
  if (unknown !== undefined) {
    throw new TypeError(`Kernel journal record ${index}.correlation.${unknown} is unsupported`)
  }
  return Object.freeze(
    Object.fromEntries(
      correlationFields.flatMap((field) => {
        const value = optionalIdentifier(input[field], index, `correlation.${field}`)
        return value === undefined ? [] : [[field, value]]
      }),
    ),
  )
}

function optionalIdentifier(input: unknown, index: number, field: string): string | undefined {
  const value = optionalText(input, index, field)
  if (value === undefined) return undefined
  if (value.trim() === '' || new TextEncoder().encode(value).byteLength > 256) {
    throw new TypeError(
      `Kernel journal record ${index}.${field} must be non-empty and at most 256 UTF-8 bytes`,
    )
  }
  return value
}

function optionalText(input: unknown, index: number, field: string): string | undefined {
  if (input === undefined) return undefined
  if (typeof input !== 'string') {
    throw new TypeError(`Kernel journal record ${index}.${field} must be text`)
  }
  return input
}

function positiveInteger(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new TypeError(`${flag} must be a positive integer`)
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${flag} must be a positive integer`)
  }
  return value
}

async function resolveLogsOpts(opts: LogsOpts, context: ConnectionContext): Promise<LogsOpts> {
  const principal = nonEmpty(opts.principal)
  if (principal !== '@self') return opts
  const { path } = await expandSelfInPath('@self', context)
  return { ...opts, principal: path.startsWith('@') ? path.slice(1) : path }
}

function nonEmpty(input: string | undefined): string | undefined {
  const value = input?.trim()
  return value ? value : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

export default {
  name: 'logs',
  description: 'Read or follow the authorized Kernel journal',
  afterHelpText: `
Behavior:
  Calls the public Kernel journal syscall and emits its { records, cursor }
  page. Topic selection is exact or prefix-based; cursors and timestamps are
  opaque strings owned by the journal backend. --follow reuses one Client Session
  and advances only with the returned cursor. With --json, follow output is
  NDJSON with one complete admitted record per line; YAML follow is unsupported.

Examples:
  $ astrale logs -i staging --limit 50
  $ astrale logs --topic op:function.failed
  $ astrale logs --topic-prefix op:function. --follow
`,
  options: [
    { flags: '--since <timestamp>', description: 'Inclusive journal timestamp lower bound' },
    { flags: '--until <timestamp>', description: 'Inclusive journal timestamp upper bound' },
    { flags: '--topic <topic>', description: 'Match one exact topic' },
    { flags: '--topic-prefix <prefix>', description: 'Match one topic prefix' },
    { flags: '--principal <id>', description: 'Filter by triggering identity ID' },
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
