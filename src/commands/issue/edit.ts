import type { CommandDefinition } from '../../program'

import { AstraleError } from '../../errors'
import {
  findReportedIssue,
  reportedIssueChangesSchema,
  reportedIssueMethodPath,
} from '../../issues/reported'
import { fatal, log } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { withIssueAdminOptions } from './options'
import { reporterSession, withReporter, type ReportedIssueOptions } from './session'

type EditOptions = ReportedIssueOptions & { title?: string; body?: string }

export async function editReportedIssueCommand(
  reference: string,
  { title, body, ...options }: EditOptions,
  dependencies = reporterSession,
): Promise<unknown> {
  const changes = reportedIssueChangesSchema.safeParse({ title, description: body })
  if (!changes.success)
    throw new AstraleError(
      'ISSUE_INPUT_INVALID',
      'Provide --title (1–200 characters), --body (up to 50,000 characters), or both.',
    )
  return withReporter(
    options,
    async (reporter) => {
      const issue = findReportedIssue(await reporter.issues(), reference)
      return reporter.call(reportedIssueMethodPath(issue.id, 'edit'), changes.data)
    },
    dependencies,
  )
}

export default withIssueAdminOptions({
  name: 'edit',
  description: 'Edit the title or details of one of your reports',
  arguments: [{ name: 'reference', description: 'Issue reference, e.g. ASTRALE-12' }],
  options: [
    { flags: '--title <text>', description: 'New title' },
    { flags: '--body <text>', description: 'New details; replaces the current ones' },
  ],
  action: async (reference: string, options: EditOptions) => {
    try {
      const issue = await editReportedIssueCommand(reference, options)
      if (isMachine(options) || options.format !== undefined) output(issue, options)
      else log.success(`Edited: ${reference.trim().toUpperCase()}`)
    } catch (cause) {
      fatal(cause, options)
    }
  },
} satisfies CommandDefinition)
