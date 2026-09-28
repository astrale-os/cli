import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError } from '@astrale-os/sdk/client'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { submitIssue, type IssuePayload } from '../submit'

let directory: string
const scope = {
  principal: 'alice',
  kernelIssuer: 'https://admin.test/api',
  domainIssuer: 'https://admin-domain.test',
}
const content = {
  title: 'A request failed',
  body: 'Context and reproduction',
  context: { observedAt: '2026-09-28', instance: { issuer: 'https://staging.test' } },
}
const receipt = { id: 'issue-id', reference: 'ASTRALE-42' }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-report-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('issue delivery', () => {
  it('retries backend unavailability once with the same request and stops if it persists', async () => {
    const unavailable = new ResponseError(5001, 'Unavailable', {
      source: issuer.accept('https://admin.test'),
      id: 'submission',
    })
    const requests: IssuePayload[] = []
    const send = mock(async (payload: IssuePayload) => {
      requests.push(payload)
      if (requests.length === 1) throw unavailable
      return receipt
    })
    await expect(submitIssue({ content, scope, directory, send })).resolves.toEqual(receipt)
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    const alwaysUnavailable = mock(async () => {
      throw unavailable
    })
    await expect(
      submitIssue({ content, scope, directory, send: alwaysUnavailable }),
    ).rejects.toMatchObject({ code: 'ISSUE_NOT_CONFIRMED' })
    expect(alwaysUnavailable).toHaveBeenCalledTimes(2)
    expect(await readdir(directory)).toHaveLength(1)
  })
  it('durably writes private exact input before sending and clears it only after a valid receipt', async () => {
    const send = mock(async (payload: IssuePayload) => {
      const path = join(directory, `${payload.requestId}.json`)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        version: 1,
        scope,
        payload: { ...content, requestId: payload.requestId },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      return receipt
    })
    await expect(submitIssue({ content, scope, directory, send })).resolves.toEqual(receipt)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await readdir(directory)).toEqual([])
  })

  it('retains the same key and metadata after a lost response, without recollecting context', async () => {
    let original: IssuePayload | undefined
    await expect(
      submitIssue({
        content,
        scope,
        directory,
        send: async (payload) => {
          original = payload
          throw new Error('Response lost after commit')
        },
      }),
    ).rejects.toMatchObject({
      code: 'ISSUE_NOT_CONFIRMED',
      hint: expect.stringContaining('astrale issue --retry'),
    })
    const send = mock(async (payload: IssuePayload) => {
      expect(payload).toEqual(original!)
      return receipt
    })
    await expect(
      submitIssue({ retry: original!.requestId, scope, directory, send }),
    ).resolves.toEqual(receipt)
    expect(await readdir(directory)).toEqual([])
  })

  it.each(['principal', 'kernelIssuer', 'domainIssuer'] as const)(
    'refuses a retry under a changed %s',
    async (field) => {
      let requestId = ''
      await submitIssue({
        content,
        scope,
        directory,
        send: async (payload) => {
          requestId = payload.requestId
          throw new Error('offline')
        },
      }).catch(() => {})
      const send = mock(async () => receipt)
      await expect(
        submitIssue({ retry: requestId, scope: { ...scope, [field]: 'other' }, directory, send }),
      ).rejects.toMatchObject({ code: 'ISSUE_RETRY_SCOPE_CHANGED' })
      expect(send).not.toHaveBeenCalled()
      expect(await readdir(directory)).toHaveLength(1)
    },
  )

  it('gives separate concurrent observations independent request IDs, even with identical text', async () => {
    const requests: string[] = []
    const send = async (payload: IssuePayload) => {
      requests.push(payload.requestId)
      return receipt
    }
    await Promise.all([
      submitIssue({ content, scope, directory, send }),
      submitIssue({ content, scope, directory, send }),
    ])
    expect(new Set(requests).size).toBe(2)
  })

  it.each([{}, { state: 'pending' }, { id: 'x', reference: '' }, null])(
    'does not accept a malformed receipt %j',
    async (value) => {
      await expect(
        submitIssue({ content, scope, directory, send: async () => value }),
      ).rejects.toMatchObject({ code: 'ISSUE_NOT_CONFIRMED' })
      expect(await readdir(directory)).toHaveLength(1)
    },
  )

  it('rejects path traversal and never sends a missing retry', async () => {
    const send = mock(async () => receipt)
    await expect(
      submitIssue({ retry: '../../credentials', scope, directory, send }),
    ).rejects.toMatchObject({ code: 'ISSUE_RETRY_INVALID' })
    await expect(
      submitIssue({ retry: '00000000-0000-4000-8000-000000000001', scope, directory, send }),
    ).rejects.toMatchObject({ code: 'ISSUE_RETRY_UNAVAILABLE' })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not dispatch if the request cannot be saved', async () => {
    const send = mock(async () => receipt)
    await expect(
      submitIssue({ content, scope, directory: '/dev/null/invalid', send }),
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
