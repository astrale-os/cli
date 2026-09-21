import { Path } from '@astrale-os/sdk/graph/path'
import { K } from '@astrale-os/sdk/schema'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program'

import { createPathCall, withClientSession } from '../connection'
import { formatKernelError } from '../connection/errors'
import { AstraleError } from '../errors'
import { readInstances } from '../lib/instance'
import { correlateJournal } from '../lib/investigation/correlate'
import { investigationTarget } from '../lib/investigation/target'
import { createTempoReader } from '../lib/investigation/tempo'
import { inspectTrace } from '../lib/investigation/trace'
import { collectJournal } from '../lib/journal/collect'
import { output } from '../lib/output'
import { acceptJournalPage, buildJournalInput } from './logs'

type InspectOpts = KernelCommandOpts & {
  trace?: string
  operation?: string
  telemetryInstance?: string
  tempoUrl?: string
  cockpitUrl?: string
  tempoDatasource?: string
  since?: string
  until?: string
  maxPages?: string
}

export default {
  name: 'inspect',
  description: 'Correlate an Instance trace or operation with its authorized journal evidence',
  options: [
    { flags: '--trace <id>', description: 'Exact trace ID' },
    { flags: '--operation <id>', description: 'Operation ID to search or select within the trace' },
    {
      flags: '--telemetry-instance <id>',
      description: 'Exact service.instance.id from telemetry (required)',
    },
    {
      flags: '--tempo-url <url>',
      description: 'Tempo base URL (or ASTRALE_TEMPO_URL); bearer from ASTRALE_TELEMETRY_TOKEN',
    },
    {
      flags: '--cockpit-url <url>',
      description: 'Scaleway Cockpit base URL (or ASTRALE_COCKPIT_URL); uses SCW_API_KEY',
    },
    {
      flags: '--tempo-datasource <uid>',
      description: 'Cockpit Tempo datasource UID; auto-selected when unique',
    },
    {
      flags: '--since <timestamp>',
      description: 'Operation search lower bound (default: six hours ago)',
    },
    { flags: '--until <timestamp>', description: 'Operation search upper bound (default: now)' },
    { flags: '--max-pages <n>', description: 'Journal scan bound per trace (default: 100)' },
  ],
  afterHelpText: `
Returns a structured dossier with trace spans, versions, journal records and coverage.
Resolves the exact Instance issuer from telemetry and reuses its bookmark identity,
or the explicitly selected --as identity. Never imports a root key or switches
identity after an authorization refusal. Trace sampling completeness is unknown.

Examples:
  astrale inspect --telemetry-instance <uuid> --trace <trace-id> --cockpit-url <url> --as operator --json
  astrale inspect --telemetry-instance <uuid> --operation <operation-id> --tempo-url <url> --json
`,
  action: async (opts: InspectOpts) => {
    try {
      if (!opts.telemetryInstance || (!opts.trace && !opts.operation))
        throw new TypeError('--telemetry-instance and --trace or --operation are required')
      const bounds = buildJournalInput({
        since: opts.since ?? new Date(Date.now() - 6 * 3600000).toISOString(),
        until: opts.until ?? new Date().toISOString(),
        limit: opts.maxPages ?? '100',
      })
      const reader = createTempoReader({
        tempoUrl: opts.tempoUrl ?? process.env.ASTRALE_TEMPO_URL,
        cockpitUrl: opts.cockpitUrl ?? process.env.ASTRALE_COCKPIT_URL,
        datasource: opts.tempoDatasource,
        token: process.env.ASTRALE_TELEMETRY_TOKEN,
        scalewayKey: process.env.SCW_API_KEY,
      })
      const search = opts.trace
        ? undefined
        : await reader.search(opts.telemetryInstance, opts.operation!, bounds.since!, bounds.until!)
      const ids = opts.trace ? [opts.trace] : search!.traceIds
      const dossiers = []
      const bookmarks = await readInstances()
      for (const id of ids) {
        const trace = inspectTrace(await reader.trace(id), id, opts.telemetryInstance)
        if (
          opts.operation &&
          !trace.spans.some((span) => span.attributes['astrale.operation.id'] === opts.operation)
        )
          throw new TypeError('Trace does not contain the requested operation')
        const connection = investigationTarget(opts, trace.issuer, bookmarks)
        const journal = await withClientSession(
          connection,
          async (context) => {
            if (context.target.kernelIssuer !== trace.issuer)
              throw new TypeError('Selected Kernel issuer does not match the trace')
            const rootIds = [
              ...new Set(
                trace.spans
                  .map((span) => span.attributes['astrale.invocation.root_id'])
                  .filter((value): value is string => typeof value === 'string'),
              ),
            ]
            const collected = await collectJournal(
              {
                since: trace.since,
                until: trace.until,
                limit: 200,
                ...(rootIds.length === 1
                  ? { invocation: { source: trace.issuer, id: rootIds[0]! } }
                  : {}),
              },
              async (input) =>
                acceptJournalPage(
                  await context.session.call(
                    createPathCall(Path.project(K.functions.journal.ref).raw, input),
                  ),
                ),
              { maxPages: bounds.limit },
            )
            return {
              ...collected,
              records: correlateJournal(collected.records, trace),
              identity: context.identity,
              issuer: context.target.kernelIssuer,
            }
          },
          { principal: 'caller' },
        )
        if (journal.error) process.exitCode = 1
        dossiers.push({
          trace,
          journal,
          evidence: {
            inputOutputPrincipal: 'journal.records',
            missing: journal.records.length ? [] : ['no-correlated-journal-records'],
            template: 'not-retained',
          },
        })
      }
      output({ version: 1, ...(search ? { search } : {}), dossiers }, { ...opts, json: true })
    } catch (cause) {
      await formatKernelError(
        cause instanceof TypeError
          ? new AstraleError('INVESTIGATION_INVALID', cause.message)
          : cause,
        true,
        undefined,
        opts.debug,
      )
      process.exitCode = 1
    }
  },
} satisfies CommandDefinition
