import { Path } from '@astrale-os/kernel-core/path'
import { syscalls } from '@astrale-os/kernel-core/schema'
import chalk from 'chalk'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { Column, ListProjection } from '../lib/output'
import type { CommandDefinition } from '../program/index'

import { createPathCall, runKernelCommand, withClientSession } from '../connection'
import { isMachine, output, presentList } from '../lib/output'

const JOURNAL_PATH = Path.project(syscalls.journal.ref).raw
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
  readonly principal?: string
  readonly correlationId?: string
  readonly causationId?: string
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

/** Map flags to the exact public journal syscall input without legacy glob/sequence lowering. */
export function buildJournalInput(opts: LogsOpts): JournalInput {
  const exact = nonEmpty(opts.topic)
  const prefix = nonEmpty(opts.topicPrefix)
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
    ...(nonEmpty(opts.since) === undefined ? {} : { since: opts.since }),
    ...(nonEmpty(opts.until) === undefined ? {} : { until: opts.until }),
    ...(nonEmpty(opts.cursor) === undefined ? {} : { cursor: opts.cursor }),
    limit: opts.limit === undefined ? DEFAULT_LIMIT : positiveInteger('--limit', opts.limit),
  }
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
    fn: (context) => fetchPage(context, opts),
    format: (page, format) => {
      if (isMachine(format) || format.format !== undefined) output(page, format)
      else {
        presentList([...page.records], format, journalProjection)
        if (page.cursor) process.stderr.write(`  cursor: ${page.cursor}\n`)
      }
    },
  })
}

async function follow(opts: LogsOpts): Promise<void> {
  await withClientSession(opts, async (context) => {
    let cursor = opts.cursor
    for (;;) {
      const page = await fetchPage(context, { ...opts, cursor })
      for (const record of page.records) printRecord(record)
      cursor = page.cursor ?? cursor
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS))
    }
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

function printRecord(record: JournalRecord): void {
  process.stdout.write(
    `${chalk.dim(String(record.sequence).padStart(6))} ${chalk.dim(record.timestamp)} ${chalk.cyan(record.topic)} ${chalk.dim(record.principal ?? '')}\n`,
  )
}

function acceptRecord(input: unknown, index: number): JournalRecord {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.sequence) ||
    typeof input.timestamp !== 'string' ||
    typeof input.topic !== 'string'
  ) {
    throw new TypeError(`Kernel journal record ${index} is invalid`)
  }
  for (const key of ['principal', 'correlationId', 'causationId'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      throw new TypeError(`Kernel journal record ${index}.${key} must be text`)
    }
  }
  return Object.freeze({
    sequence: input.sequence as number,
    timestamp: input.timestamp,
    topic: input.topic,
    payload: input.payload,
    ...(input.principal === undefined ? {} : { principal: input.principal as string }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId as string }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId as string }),
  })
}

function positiveInteger(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new TypeError(`${flag} must be a positive integer`)
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${flag} must be a positive integer`)
  }
  return value
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
  and advances only with the returned cursor.

  Historical event-glob lowering and the application-specific services-domain
  log buffer are not part of the Kernel V2 journal contract.

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
    if (opts.follow) await follow(opts)
    else await runOnce(opts)
  },
} satisfies CommandDefinition
