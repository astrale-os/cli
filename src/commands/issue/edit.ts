import type { CommandDefinition } from '../../program'

import { AstraleError } from '../../errors'
import {
  findReportedIssue,
  reportedIssueChangesSchema,
  reportedIssueMethodPath,
} from '../../issues/reported'
import { admitIssueText, ISSUE_BODY, ISSUE_TITLE } from '../../issues/submit'
import { log } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { failIssueCommand } from './failure'
import { withIssueAdminOptions } from './options'
import { reporterSession, withReporter, type ReportedIssueOptions } from './session'

type EditOptions = ReportedIssueOptions & { title?: string; body?: string }

export async function editReportedIssueCommand(
  reference: string,
  { title, body, ...options }: EditOptions,
  dependencies = reporterSession,
): Promise<unknown> {
  if (title === undefined && body === undefined)
    throw new AstraleError('ISSUE_INPUT_INVALID', 'Provide --title, --body, or both.')
  if (title !== undefined) admitIssueText('--title', title, ISSUE_TITLE)
  // An empty --body clears the details.
  if (body !== undefined) admitIssueText('--body', body, { ...ISSUE_BODY, blank: true })
  // Send only the fields given: call input refuses `undefined`.
  const changes = reportedIssueChangesSchema.parse({
    ...(title !== undefined && { title }),
    ...(body !== undefined && { description: body }),
  })
  return withReporter(
    options,
    async (reporter) => {
      const issue = findReportedIssue(await reporter.issues(), reference)
      return reporter.call(reportedIssueMethodPath(issue.id, 'edit'), changes)
    },
    dependencies,
  )
}

export default withIssueAdminOptions({
  name: 'edit',
  description: 'Edit the title or details of one of your reports',
  arguments: [{ name: 'reference', description: 'Issue reference, e.g. ASTRALE-12' }],
  options: [
    {
      flags: '--title <text>',
      description: `New title, at most ${ISSUE_TITLE.maximum} characters`,
    },
    { flags: '--body <text>', description: 'New details; replaces the current ones' },
  ],
  action: async (reference: string, options: EditOptions) => {
    try {
      const issue = await editReportedIssueCommand(reference, options)
      if (isMachine(options) || options.format !== undefined) output(issue, options)
      else log.success(`Edited: ${reference.trim().toUpperCase()}`)
    } catch (cause) {
      await failIssueCommand(cause, options)
    }
  },
} satisfies CommandDefinition)
