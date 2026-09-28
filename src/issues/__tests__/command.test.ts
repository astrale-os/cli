import { describe, expect, it, mock } from 'bun:test'

import type { ConnectionContext } from '../../connection'

import { reportIssueCommand } from '../../commands/issue'
import { createPathCall } from '../../connection'
import { ISSUE_REPORT_PATH, type IssuePayload } from '../submit'

function fixture() {
  const payload: IssuePayload = {
    title: 'Title',
    body: 'Body',
    requestId: '00000000-0000-4000-8000-000000000001',
  }
  const receipt = { id: 'accepted-id', reference: 'ASTRALE-5' }
  const call = mock(async () => receipt)
  const connection = {
    target: {
      url: 'https://admin.test/api',
      kernelIssuer: 'https://admin.test/api',
      domainIssuer: 'https://admin-domain.test',
    },
    self: async () => ({ id: 'alice' }),
    session: { call },
  } as unknown as ConnectionContext
  const context = {
    observedAt: '2026-09-28T00:00:00.000Z',
    cli: { version: '1', arch: 'arm64', platform: 'darwin' },
    runtime: { node: '26' },
  }
  const collectIssueContext = mock(async () => context)
  const readInstances = mock(async () => ({
    active: 'other',
    instances: { staging: { url: 'https://offline.test' } },
  }))
  const readBody = mock(async () => 'stdin body')
  const submitIssue = mock(async (input: { send: (payload: IssuePayload) => Promise<unknown> }) => {
    await input.send(payload)
    return receipt
  })
  const optionsSeen: unknown[] = []
  const dependencies = {
    collectIssueContext,
    readInstances,
    readBody,
    submitIssue,
    cwd: () => '/workspace',
    directory: () => '/private/reports',
    withAdminClientSession: async <T>(
      options: unknown,
      action: (context: ConnectionContext) => Promise<T>,
    ) => {
      optionsSeen.push(options)
      return action(connection)
    },
  }
  return {
    dependencies,
    call,
    receipt,
    payload,
    collectIssueContext,
    readInstances,
    readBody,
    submitIssue,
    optionsSeen,
  }
}

describe('issue command', () => {
  it('keeps affected instance and local project out of the Admin target and payload attribution', async () => {
    const f = fixture()
    await expect(
      reportIssueCommand(
        'Failure',
        { body: 'Body', project: './orders', instance: 'staging', admin: 'control', as: 'alice' },
        f.dependencies,
      ),
    ).resolves.toEqual(f.receipt)
    expect(f.optionsSeen).toEqual([{ admin: 'control', as: 'alice' }])
    expect(f.collectIssueContext).toHaveBeenCalledWith(
      expect.objectContaining({ project: './orders', instance: 'staging' }),
    )
    expect(f.call).toHaveBeenCalledWith(createPathCall(ISSUE_REPORT_PATH, f.payload))
    expect(f.submitIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          principal: 'alice',
          kernelIssuer: 'https://admin.test/api',
          domainIssuer: 'https://admin-domain.test',
        },
      }),
    )
    expect(f.readBody).not.toHaveBeenCalled()
  })

  it('accepts title/body alone without consulting the active instance', async () => {
    const f = fixture()
    await reportIssueCommand('Failure', { body: 'Body' }, f.dependencies)
    expect(f.readInstances).not.toHaveBeenCalled()
    expect(f.optionsSeen).toEqual([{}])
  })

  it('uses stdin only when --body is absent', async () => {
    const f = fixture()
    await reportIssueCommand('Failure', {}, f.dependencies)
    expect(f.readBody).toHaveBeenCalledTimes(1)
    expect(f.submitIssue).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.objectContaining({ body: 'stdin body' }) }),
    )
  })

  it('retries without reading stdin, bookmarks or current project metadata', async () => {
    const f = fixture()
    await reportIssueCommand(undefined, { retry: f.payload.requestId }, f.dependencies)
    expect(f.collectIssueContext).not.toHaveBeenCalled()
    expect(f.readInstances).not.toHaveBeenCalled()
    expect(f.readBody).not.toHaveBeenCalled()
  })

  it('rejects retry context changes and empty content before any Admin session', async () => {
    const f = fixture()
    await expect(
      reportIssueCommand('Changed', { retry: f.payload.requestId }, f.dependencies),
    ).rejects.toMatchObject({ code: 'ISSUE_RETRY_INVALID' })
    await expect(reportIssueCommand(' ', { body: 'Body' }, f.dependencies)).rejects.toMatchObject({
      code: 'ISSUE_INPUT_INVALID',
    })
    expect(f.optionsSeen).toEqual([])
  })
})
