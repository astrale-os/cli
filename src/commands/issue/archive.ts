import type { CommandDefinition } from '../../program'

import {
  findReportedIssue,
  listReportedIssues,
  reportedIssueMethodPath,
} from '../../issues/reported'
import { fatal, log } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { withIssueAdminOptions } from './options'
import { reporterSession, withReporterCalls, type ReportedIssueOptions } from './session'

export async function archiveReportedIssueCommand(
  reference: string,
  options: ReportedIssueOptions,
  dependencies = reporterSession,
): Promise<{ reference: string; archived: true }> {
  return withReporterCalls(
    options,
    async (call) => {
      const issue = findReportedIssue(await listReportedIssues(call), reference)
      await call(reportedIssueMethodPath(issue.id, 'archive'), {})
      return { reference: issue.reference, archived: true as const }
    },
    dependencies,
  )
}

export default withIssueAdminOptions({
  name: 'archive',
  description: 'Withdraw one of your reports (triage keeps its history)',
  arguments: [{ name: 'reference', description: 'Issue reference, e.g. ASTRALE-12' }],
  action: async (reference: string, options: ReportedIssueOptions) => {
    try {
      const result = await archiveReportedIssueCommand(reference, options)
      if (isMachine(options) || options.format !== undefined) output(result, options)
      else log.success(`Archived: ${result.reference}`)
    } catch (cause) {
      fatal(cause, options)
    }
  },
} satisfies CommandDefinition)
