import { Path } from '@astrale-os/sdk/graph/path'

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

/**
 * The reporter acts for itself: the Issues read rules alone decide which reports it sees. Read
 * through the Admin Domain, the Kernel would also bound each read by that Domain's own authority,
 * which holds no Issue. A report Method is called like any callable on Admin, with the credential
 * of the Domain that declares it.
 */
export function withReporter<Value>(
  options: ReportedIssueOptions,
  action: (reporter: Reporter) => Promise<Value>,
  dependencies = reporterSession,
): Promise<Value> {
  return dependencies.withAdminClientSession(
    options,
    async (connection) => {
      const reporterId = (await connection.self()).id
      return action({
        issues: () => readReportedIssues(connection.graph, reporterId),
        call: (path, input) =>
          dependencies.withAdminClientSession(
            options,
            (callable) => callable.session.call(createPathCall(path, input)),
            { principal: 'callable', path: Path.parse(path) },
          ),
      })
    },
    { principal: 'caller' },
  )
}
