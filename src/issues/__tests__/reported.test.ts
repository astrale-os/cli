import type { Node } from '@astrale-os/sdk/graph/node'

import { edge, edgeKeyOf } from '@astrale-os/sdk/graph/edge'
import { NodeId, node } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, it, mock } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { archiveReportedIssueCommand } from '../../commands/issue/archive'
import { editReportedIssueCommand } from '../../commands/issue/edit'
import { listReportedIssuesCommand } from '../../commands/issue/list'
import { showReportedIssueCommand } from '../../commands/issue/show'
import { createPathCall } from '../../connection'
import { readReportedIssues, reportedIssueMethodPath } from '../reported'

const ISSUE = 'issues.astrale.ai:class.Issue'
const COMMENT = 'issues.astrale.ai:class.Comment'

function issueNode(reference: string, updatedAt: string, overrides = {}): Node {
  return node({
    id: NodeId(`${reference.toLowerCase()}-id`),
    class: ISSUE as never,
    props: normalizeProperties({
      [`${ISSUE}.property.reference`]: reference,
      [`${ISSUE}.property.status`]: 'accepted',
      [`${ISSUE}.property.priority`]: 2,
      [`${ISSUE}.property.archived`]: false,
      // Readable by the reporter, but never part of the CLI's view.
      [`${ISSUE}.property.reporterId`]: 'alice',
      'kernel.astrale.ai:class.Named.property.name': `${reference} title`,
      'kernel.astrale.ai:class.Timestamped.property.createdAt': '2026-10-11T08:00:00.000Z',
      'kernel.astrale.ai:class.Timestamped.property.updatedAt': updatedAt,
      ...overrides,
    }),
  })
}

function commentItem(issueId: string, id: string, body: string, createdAt: string) {
  const comment = node({
    id: NodeId(id),
    class: COMMENT as never,
    props: normalizeProperties({
      [`${COMMENT}.property.body`]: body,
      'kernel.astrale.ai:class.Timestamped.property.createdAt': createdAt,
      'kernel.astrale.ai:class.Timestamped.property.updatedAt': createdAt,
    }),
  })
  const relationship = edge({
    class: 'issues.astrale.ai:class.issue_has_comment' as never,
    source: NodeId(issueId),
    target: comment.id,
    props: normalizeProperties({}),
  })
  return {
    edge: { kind: 'reference' as const, value: edgeKeyOf(relationship) },
    source: { kind: 'reference' as const, value: { id: NodeId(issueId), class: ISSUE } },
    target: { kind: 'value' as const, value: comment },
  }
}

/** A Kernel answering the two reporter Queries: Issue pages, then Comment edge pages. */
function graph() {
  const issues = [
    issueNode('ASTRALE-1', '2026-10-11T09:00:00.000Z', {
      [`${ISSUE}.property.archived`]: true,
    }),
    issueNode('ASTRALE-2', '2026-10-11T10:00:00.000Z', {
      'kernel.astrale.ai:class.Descriptable.property.description': 'Details',
    }),
  ]
  const query = mock(async (ast: { select: { kind: string } }, options: { page: unknown }) => {
    const after = (options.page as { after?: string }).after
    if (ast.select.kind === 'nodes')
      return after === undefined
        ? {
            result: { kind: 'nodes', nodes: [{ kind: 'value', value: issues[0] }] },
            page: { next: 'n' },
          }
        : { result: { kind: 'nodes', nodes: [{ kind: 'value', value: issues[1] }] }, page: {} }
    return {
      result: {
        kind: 'edges',
        edges: [
          commentItem('astrale-2-id', 'later', 'Fixed in 0.12.2', '2026-10-11T12:00:00.000Z'),
          commentItem('astrale-2-id', 'earlier', 'Which Host?', '2026-10-11T11:00:00.000Z'),
        ],
      },
      page: {},
    }
  })
  return { query }
}

function fixture() {
  const kernel = graph()
  const call = mock(async (_request: unknown) => ({ ok: true }))
  const connection = {
    self: async () => ({ id: 'alice' }),
    graph: kernel,
    session: { call },
  } as unknown as ConnectionContext
  const optionsSeen: unknown[] = []
  const credentialsSeen: unknown[] = []
  const dependencies = {
    withAdminClientSession: async <T>(
      options: unknown,
      action: (context: ConnectionContext) => Promise<T>,
      credential?: unknown,
    ) => {
      optionsSeen.push(options)
      credentialsSeen.push(credential)
      return action(connection)
    },
  }
  return { kernel, call, dependencies, optionsSeen, credentialsSeen }
}

describe('reported issues read', () => {
  it('walks from the caller Identity through the reporting and Comment Edges', async () => {
    const kernel = graph()
    const issues = await readReportedIssues(kernel as never, 'alice')
    const [issueQuery, commentQuery] = kernel.query.mock.calls.map(([ast]) => ast) as unknown[]
    const reported = {
      op: 'expand',
      via: [{ origin: 'issues.astrale.ai', kind: 'class', name: 'issue_reported_by' }],
      direction: 'outgoing',
    }
    expect(issueQuery).toMatchObject({
      source: { terms: [{ kind: 'path', path: '@alice' }] },
      steps: [reported],
      select: { kind: 'nodes', projection: { kind: 'value' } },
    })
    expect(commentQuery).toMatchObject({
      source: { terms: [{ kind: 'path', path: '@alice' }] },
      steps: [
        reported,
        {
          op: 'expand',
          via: [{ origin: 'issues.astrale.ai', kind: 'class', name: 'issue_has_comment' }],
          direction: 'outgoing',
        },
      ],
      select: { kind: 'edges', projection: { source: 'reference', target: 'value' } },
    })
    expect(issues).toEqual([
      {
        id: 'astrale-2-id',
        reference: 'ASTRALE-2',
        title: 'ASTRALE-2 title',
        description: 'Details',
        status: 'accepted',
        priority: 2,
        archived: false,
        comments: [
          { id: 'earlier', body: 'Which Host?' },
          { id: 'later', body: 'Fixed in 0.12.2' },
        ],
      },
      {
        id: 'astrale-1-id',
        reference: 'ASTRALE-1',
        title: 'ASTRALE-1 title',
        description: '',
        status: 'accepted',
        priority: 2,
        archived: true,
        comments: [],
      },
    ])
    expect(kernel.query).toHaveBeenCalledTimes(3)
  })
})

describe('reporter issue commands', () => {
  it('lists active reports by default and archived ones on request', async () => {
    const f = fixture()
    expect(
      (await listReportedIssuesCommand({ as: 'alice' }, f.dependencies)).map((i) => i.reference),
    ).toEqual(['ASTRALE-2'])
    expect(
      (await listReportedIssuesCommand({ all: true }, f.dependencies)).map((i) => i.reference),
    ).toEqual(['ASTRALE-2', 'ASTRALE-1'])
    expect(f.optionsSeen).toEqual([{ as: 'alice' }, {}])
    // The reporter reads as itself: through the Admin Domain, its ceiling would hide every Issue.
    expect(f.credentialsSeen).toEqual([{ principal: 'caller' }, { principal: 'caller' }])
    expect(f.call).not.toHaveBeenCalled()
  })

  it('resolves a reference case-insensitively among the caller reports only', async () => {
    const f = fixture()
    await expect(
      showReportedIssueCommand(' astrale-1 ', {}, f.dependencies),
    ).resolves.toMatchObject({ id: 'astrale-1-id', reference: 'ASTRALE-1' })
    await expect(showReportedIssueCommand('ASTRALE-9', {}, f.dependencies)).rejects.toMatchObject({
      code: 'ISSUE_NOT_REPORTED',
    })
  })

  it('edits only the report text through the reporter Method', async () => {
    const f = fixture()
    await editReportedIssueCommand(
      'ASTRALE-2',
      { title: 'Clearer title', body: 'More details', admin: 'control' },
      f.dependencies,
    )
    expect(f.optionsSeen).toEqual([{ admin: 'control' }, { admin: 'control' }])
    expect(f.credentialsSeen).toEqual([
      { principal: 'caller' },
      { principal: 'callable', path: Path.parse(reportedIssueMethodPath('astrale-2-id', 'edit')) },
    ])
    expect(f.call.mock.calls).toEqual([
      [
        createPathCall(reportedIssueMethodPath('astrale-2-id', 'edit'), {
          title: 'Clearer title',
          description: 'More details',
        }),
      ],
    ])
  })

  it('refuses an empty edit before opening an Admin session', async () => {
    const f = fixture()
    await expect(editReportedIssueCommand('ASTRALE-2', {}, f.dependencies)).rejects.toMatchObject({
      code: 'ISSUE_INPUT_INVALID',
    })
    await expect(
      editReportedIssueCommand('ASTRALE-2', { title: '  ' }, f.dependencies),
    ).rejects.toMatchObject({
      code: 'ISSUE_INPUT_INVALID',
      message: '--title is empty; write 1–100 characters.',
    })
    await expect(
      editReportedIssueCommand('ASTRALE-2', { title: 'T'.repeat(101) }, f.dependencies),
    ).rejects.toMatchObject({ message: '--title has 101 characters; the limit is 100.' })
    await expect(
      editReportedIssueCommand('ASTRALE-2', { body: 'B'.repeat(50_001) }, f.dependencies),
    ).rejects.toMatchObject({ message: '--body has 50,001 characters; the limit is 50,000.' })
    expect(f.optionsSeen).toEqual([])
  })

  it('archives the resolved report', async () => {
    const f = fixture()
    await expect(archiveReportedIssueCommand('astrale-2', {}, f.dependencies)).resolves.toEqual({
      reference: 'ASTRALE-2',
      archived: true,
    })
    expect(f.call.mock.calls).toEqual([
      [createPathCall(reportedIssueMethodPath('astrale-2-id', 'archive'), {})],
    ])
  })
})
