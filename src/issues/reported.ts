import { z } from 'zod'

import { AstraleError } from '../errors'

/** Issues Domain callables a reporter uses on Admin; reporting itself goes through Admin. */
export const REPORTED_ISSUES_PATH = '/:issues.astrale.ai:class.Issue:listReported'

export function reportedIssueMethodPath(id: string, method: 'edit' | 'archive'): string {
  return `@${id}::issues.astrale.ai:class.Issue.method.${method}`
}

const reportedIssueSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.number(),
  archived: z.boolean(),
  comments: z.array(z.object({ id: z.string().min(1), body: z.string() })),
})
const reportedIssuesSchema = z.object({ issues: z.array(reportedIssueSchema) })

export type ReportedIssue = z.infer<typeof reportedIssueSchema>

export const reportedIssueChangesSchema = z
  .strictObject({
    title: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0)
      .optional(),
    description: z.string().max(50_000).optional(),
  })
  .refine((value) => value.title !== undefined || value.description !== undefined)

export type ReportedIssueChanges = z.infer<typeof reportedIssueChangesSchema>

export async function listReportedIssues(
  call: (path: string, input: unknown) => Promise<unknown>,
): Promise<ReportedIssue[]> {
  return reportedIssuesSchema.parse(await call(REPORTED_ISSUES_PATH, {})).issues
}

/** Resolve a reference such as `ASTRALE-12` among the caller's own reports. */
export function findReportedIssue(
  issues: readonly ReportedIssue[],
  reference: string,
): ReportedIssue {
  const wanted = reference.trim().toUpperCase()
  const issue = issues.find((candidate) => candidate.reference.toUpperCase() === wanted)
  if (issue === undefined)
    throw new AstraleError(
      'ISSUE_NOT_REPORTED',
      `You have not reported an issue ${wanted}.`,
      'List your reports with: astrale issue list',
    )
  return issue
}
