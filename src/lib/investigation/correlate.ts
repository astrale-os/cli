import type { JournalRecord } from '../../commands/logs'

import { traceId } from './trace'

/** Operation identity is the primary join; normalized trace identity also admits unsampled child records. */
export function correlateJournal(
  records: readonly JournalRecord[],
  trace: { traceId: string; spans: readonly { attributes: Readonly<Record<string, unknown>> }[] },
) {
  const operations = new Set(
    trace.spans
      .map((span) => span.attributes['astrale.operation.id'])
      .filter((value): value is string => typeof value === 'string'),
  )
  return records.filter((record) => {
    if (record.correlation?.operationId && operations.has(record.correlation.operationId))
      return true
    if (!record.correlation?.traceId) return false
    try {
      return traceId(record.correlation.traceId) === traceId(trace.traceId)
    } catch {
      return false
    }
  })
}
