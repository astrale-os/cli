import type { AdminConnectionOptions } from '../../connection'
import type { OutputOpts } from '../../lib/terminal/output'

import { createPathCall, withAdminClientSession } from '../../connection'
import { readReportedIssues, type ReportedIssue } from '../../issues/reported'

export type ReportedIssueOptions = AdminConnectionOptions & OutputOpts & { debug?: boolean }

/** The caller's view of its own reports on Admin, where the Issues Domain holds them. */
export interface Reporter {
  readonly issues: () => Promise<ReportedIssue[]>
  readonly call: (path: string, input: unknown) => Promise<unknown>
}

export const reporterSession = { withAdminClientSession }

export function withReporter<Value>(
  options: ReportedIssueOptions,
  action: (reporter: Reporter) => Promise<Value>,
  dependencies = reporterSession,
): Promise<Value> {
  return dependencies.withAdminClientSession(options, async (connection) => {
    const reporterId = (await connection.self()).id
    return action({
      issues: () => readReportedIssues(connection.graph, reporterId),
      call: (path, input) => connection.session.call(createPathCall(path, input)),
    })
  })
}
