import chalk from 'chalk'

import type { CommandDefinition } from '../../program'

import { findReportedIssue, listReportedIssues, type ReportedIssue } from '../../issues/reported'
import { fatal } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { withIssueAdminOptions } from './options'
import { reporterSession, withReporterCalls, type ReportedIssueOptions } from './session'

export async function showReportedIssueCommand(
  reference: string,
  options: ReportedIssueOptions,
  dependencies = reporterSession,
): Promise<ReportedIssue> {
  return withReporterCalls(
    options,
    async (call) => findReportedIssue(await listReportedIssues(call), reference),
    dependencies,
  )
}

export default withIssueAdminOptions({
  name: 'show',
  description: 'Show one of your reports with the triage comments',
  arguments: [{ name: 'reference', description: 'Issue reference, e.g. ASTRALE-12' }],
  action: async (reference: string, options: ReportedIssueOptions) => {
    try {
      const issue = await showReportedIssueCommand(reference, options)
      if (isMachine(options) || options.format !== undefined) {
        output(issue, options)
        return
      }
      const status = issue.archived ? `${issue.status}, archived` : issue.status
      const lines = [
        `${chalk.bold(issue.reference)} ${chalk.dim(`(${status})`)}`,
        chalk.bold(issue.title),
        '',
        issue.description,
      ]
      for (const comment of issue.comments) lines.push('', chalk.dim('── comment'), comment.body)
      process.stdout.write(lines.join('\n') + '\n')
    } catch (cause) {
      fatal(cause, options)
    }
  },
} satisfies CommandDefinition)
