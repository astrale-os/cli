import chalk from 'chalk'

import type { Column } from '../../lib/terminal/table'
import type { CommandDefinition } from '../../program'

import { listReportedIssues, type ReportedIssue } from '../../issues/reported'
import { fatal, log, withSpinner } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { renderTable } from '../../lib/terminal/table'
import { withIssueAdminOptions } from './options'
import { reporterSession, withReporterCalls, type ReportedIssueOptions } from './session'

type ListOptions = ReportedIssueOptions & { all?: boolean }

const COLUMNS: Column[] = [
  { key: 'reference', header: 'REFERENCE', color: chalk.bold },
  { key: 'status', header: 'STATUS' },
  { key: 'title', header: 'TITLE' },
  { key: 'comments', header: 'COMMENTS', color: chalk.dim },
]

export async function listReportedIssuesCommand(
  { all, ...options }: ListOptions,
  dependencies = reporterSession,
): Promise<ReportedIssue[]> {
  const issues = await withReporterCalls(options, listReportedIssues, dependencies)
  return all ? issues : issues.filter((issue) => !issue.archived)
}

export default withIssueAdminOptions({
  name: 'list',
  description: 'List the issues you reported, with their triage status',
  options: [{ flags: '--all', description: 'Include the reports you archived' }],
  action: async (options: ListOptions) => {
    try {
      const issues = await withSpinner('Fetching your reports', !isMachine(options), () =>
        listReportedIssuesCommand(options),
      )
      if (isMachine(options) || options.format !== undefined) {
        output({ issues }, options)
        return
      }
      if (issues.length === 0) {
        log.dim('  No reports. Report one with: astrale issue "Short title" --body "Details"')
        return
      }
      const rows = issues.map((issue) => ({
        reference: issue.reference,
        status: issue.archived ? `${issue.status} (archived)` : issue.status,
        title: issue.title,
        comments: issue.comments.length === 0 ? '' : String(issue.comments.length),
      }))
      process.stdout.write(renderTable(rows, { columns: COLUMNS, showHeader: true }) + '\n')
    } catch (cause) {
      fatal(cause, options)
    }
  },
} satisfies CommandDefinition)
