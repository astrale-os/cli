import { describe, expect, it, mock } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { archiveReportedIssueCommand } from '../../commands/issue/archive'
import { editReportedIssueCommand } from '../../commands/issue/edit'
import { listReportedIssuesCommand } from '../../commands/issue/list'
import { showReportedIssueCommand } from '../../commands/issue/show'
import { createPathCall } from '../../connection'
import { REPORTED_ISSUES_PATH, reportedIssueMethodPath } from '../reported'

function issue(reference: string, archived = false) {
  return {
    id: `${reference.toLowerCase()}-id`,
    reference,
    title: `${reference} title`,
    description: `${reference} details`,
    status: 'accepted',
    priority: 2,
    archived,
    comments: [{ id: 'comment-1', body: 'Which Host version?' }],
  }
}

function fixture() {
  const issues = [issue('ASTRALE-2'), issue('ASTRALE-1', true)]
  const call = mock(async (request: unknown) =>
    JSON.stringify(request) === JSON.stringify(createPathCall(REPORTED_ISSUES_PATH, {}))
      ? { issues }
      : { ok: true },
  )
  const connection = { session: { call } } as unknown as ConnectionContext
  const optionsSeen: unknown[] = []
  const dependencies = {
    withAdminClientSession: async <T>(
      options: unknown,
      action: (context: ConnectionContext) => Promise<T>,
    ) => {
      optionsSeen.push(options)
      return action(connection)
    },
  }
  return { issues, call, dependencies, optionsSeen }
}

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
    expect(f.call).toHaveBeenCalledWith(createPathCall(REPORTED_ISSUES_PATH, {}))
  })

  it('resolves a reference case-insensitively among the caller reports only', async () => {
    const f = fixture()
    await expect(showReportedIssueCommand(' astrale-1 ', {}, f.dependencies)).resolves.toEqual(
      f.issues[1]!,
    )
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
    expect(f.optionsSeen).toEqual([{ admin: 'control' }])
    expect(f.call).toHaveBeenLastCalledWith(
      createPathCall(reportedIssueMethodPath('astrale-2-id', 'edit'), {
        title: 'Clearer title',
        description: 'More details',
      }),
    )
  })

  it('refuses an empty edit before opening an Admin session', async () => {
    const f = fixture()
    await expect(editReportedIssueCommand('ASTRALE-2', {}, f.dependencies)).rejects.toMatchObject({
      code: 'ISSUE_INPUT_INVALID',
    })
    await expect(
      editReportedIssueCommand('ASTRALE-2', { title: '  ' }, f.dependencies),
    ).rejects.toMatchObject({ code: 'ISSUE_INPUT_INVALID' })
    expect(f.optionsSeen).toEqual([])
  })

  it('archives the resolved report', async () => {
    const f = fixture()
    await expect(archiveReportedIssueCommand('astrale-2', {}, f.dependencies)).resolves.toEqual({
      reference: 'ASTRALE-2',
      archived: true,
    })
    expect(f.call).toHaveBeenLastCalledWith(
      createPathCall(reportedIssueMethodPath('astrale-2-id', 'archive'), {}),
    )
  })
})
