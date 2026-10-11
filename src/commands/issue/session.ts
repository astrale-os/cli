import type { AdminConnectionOptions } from '../../connection'
import type { OutputOpts } from '../../lib/terminal/output'

import { createPathCall, withAdminClientSession } from '../../connection'

export type ReportedIssueOptions = AdminConnectionOptions & OutputOpts & { debug?: boolean }

export type ReporterCall = (path: string, input: unknown) => Promise<unknown>

export const reporterSession = { withAdminClientSession }

/** Run reporter calls on Admin, where the Issues Domain that holds the reports is installed. */
export function withReporterCalls<Value>(
  options: ReportedIssueOptions,
  action: (call: ReporterCall) => Promise<Value>,
  dependencies = reporterSession,
): Promise<Value> {
  return dependencies.withAdminClientSession(options, (connection) =>
    action((path, input) => connection.session.call(createPathCall(path, input))),
  )
}
