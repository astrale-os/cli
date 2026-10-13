import type { GraphApi } from '@astrale-os/sdk/client'
import type { QueryAST, QueryResult } from '@astrale-os/sdk/query'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query, queryResult } from '@astrale-os/sdk/query'
import { z } from 'zod'

import { AstraleError } from '../errors'
import { ISSUE_BODY, ISSUE_TITLE } from './submit'

const ISSUES = 'issues.astrale.ai'
const issueReportedBy = edgeClass('issue_reported_by')
const issueHasComment = edgeClass('issue_has_comment')
const PROPERTY = {
  reference: `${ISSUES}:class.Issue.property.reference`,
  status: `${ISSUES}:class.Issue.property.status`,
  priority: `${ISSUES}:class.Issue.property.priority`,
  archived: `${ISSUES}:class.Issue.property.archived`,
  body: `${ISSUES}:class.Comment.property.body`,
  title: 'kernel.astrale.ai:class.Named.property.name',
  /** The Issue description since Issues 0.4.5; Markdown, up to 50,000 characters. */
  issueBody: `${ISSUES}:class.Issue.property.body`,
  /** Where an Issue stored before 0.4.5 keeps its description until its next revision. */
  description: 'kernel.astrale.ai:class.Descriptable.property.description',
  createdAt: 'kernel.astrale.ai:class.Timestamped.property.createdAt',
  updatedAt: 'kernel.astrale.ai:class.Timestamped.property.updatedAt',
} as const
const PAGE_SIZE = 256
const MAXIMUM_PAGES = 64

export function reportedIssueMethodPath(id: string, method: 'edit' | 'archive'): string {
  return `@${id}::${ISSUES}:class.Issue.method.${method}`
}

const issueProps = z.object({
  [PROPERTY.reference]: z.string().min(1),
  [PROPERTY.title]: z.string(),
  [PROPERTY.issueBody]: z.string().optional(),
  [PROPERTY.description]: z.string().optional(),
  [PROPERTY.status]: z.string(),
  [PROPERTY.priority]: z.number(),
  [PROPERTY.archived]: z.boolean(),
  [PROPERTY.updatedAt]: z.string(),
})
const commentProps = z.object({
  [PROPERTY.body]: z.string(),
  [PROPERTY.createdAt]: z.string(),
})

export interface ReportedIssue {
  readonly id: string
  readonly reference: string
  readonly title: string
  readonly description: string
  readonly status: string
  readonly priority: number
  readonly archived: boolean
  readonly comments: readonly { readonly id: string; readonly body: string }[]
}

export const reportedIssueChangesSchema = z
  .strictObject({
    title: z
      .string()
      .min(1)
      .max(ISSUE_TITLE.maximum)
      .refine((value) => value.trim().length > 0)
      .optional(),
    description: z.string().max(ISSUE_BODY.maximum).optional(),
  })
  .refine((value) => value.title !== undefined || value.description !== undefined)

/**
 * The reporter's own Issues and their Comment threads, read under its own authority: from its
 * Identity through `issue_reported_by`, then `issue_has_comment`. The Issues read rules decide what
 * the caller sees; nothing is filtered here.
 */
export async function readReportedIssues(
  graph: Pick<GraphApi, 'query'>,
  reporterId: string,
): Promise<ReportedIssue[]> {
  const issues = Query.from({ nodes: [Path.parse(`@${reporterId}`)] }).expand({
    via: [issueReportedBy],
    direction: 'outgoing',
  })
  const comments = issues.expand({ via: [issueHasComment], direction: 'outgoing' })
  const [issuePages, commentPages] = await Promise.all([
    allPages(graph, issues.select({ kind: 'nodes', projection: { kind: 'value' } })),
    allPages(
      graph,
      comments.select({
        kind: 'edges',
        binding: comments.edge,
        projection: { edge: 'reference', source: 'reference', target: 'value' },
      }),
    ),
  ])
  const threads = new Map<string, { id: string; body: string; createdAt: string }[]>()
  for (const item of commentPages.flatMap((page) =>
    queryResult.edgeItems(page, 'reported Issue Comments'),
  )) {
    if (item.target.kind !== 'value')
      throw new TypeError('Reported Issue Comments must project their values.')
    const props = commentProps.parse(item.target.value.props)
    const thread = threads.get(item.source.value.id) ?? []
    thread.push({
      id: item.target.value.id,
      body: props[PROPERTY.body],
      createdAt: props[PROPERTY.createdAt],
    })
    threads.set(item.source.value.id, thread)
  }
  return queryResult
    .completeNodeValues(issuePages, 'reported Issues')
    .map((node) => {
      const props = issueProps.parse(node.props)
      return {
        id: node.id,
        reference: props[PROPERTY.reference],
        title: props[PROPERTY.title],
        description: props[PROPERTY.issueBody] ?? props[PROPERTY.description] ?? '',
        status: props[PROPERTY.status],
        priority: props[PROPERTY.priority],
        archived: props[PROPERTY.archived],
        updatedAt: props[PROPERTY.updatedAt],
        comments: (threads.get(node.id) ?? [])
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(({ id, body }) => ({ id, body })),
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ updatedAt: _updatedAt, ...issue }) => issue)
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

async function allPages(graph: Pick<GraphApi, 'query'>, ast: QueryAST): Promise<QueryResult[]> {
  const results: QueryResult[] = []
  let after: string | undefined
  while (results.length < MAXIMUM_PAGES) {
    const response = await graph.query(ast, {
      page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
    })
    results.push(response.result)
    after = response.page.next
    if (after === undefined) return results
  }
  throw new AstraleError(
    'ISSUE_LIST_TOO_LARGE',
    `More than ${PAGE_SIZE * MAXIMUM_PAGES} reported issues or comments to read.`,
  )
}

function edgeClass(name: string) {
  return ClassKey.ref(ClassKey.of({ origin: ISSUES, kind: 'class', name }))
}
