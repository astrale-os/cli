import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError, TransportError } from '@astrale-os/sdk/client'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { submitIssue, type IssuePayload } from '../submit'

type ResponseArguments = ConstructorParameters<typeof ResponseError>
const INVOCATION = { source: issuer.accept('https://admin.test'), id: 'submission' }

/** A Kernel answer to `reportIssue`, as the Kernel client raises it. */
function answer(code: number, reason?: { code: string; details: Record<string, unknown> }) {
  return new ResponseError(
    code as ResponseArguments[0],
    'Answered by the Kernel.',
    INVOCATION,
    reason as ResponseArguments[3],
  )
}

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

  it('shows a refusal as the refusal itself and keeps nothing to retry', async () => {
    const tooLong = answer(1003, {
      code: 'FUNCTION_INPUT_INVALID',
      details: {
        issues: [
          {
            code: 'VALUE_SCHEMA_INSTANCE_INVALID',
            path: '/context/project/packages/0/name',
            message: 'String exceeds maxLength.',
          },
        ],
      },
    })
    for (const refusal of [
      tooLong,
      answer(5000),
      answer(4001, { code: 'REPORT_REQUEST_CONFLICT', details: {} }),
      answer(2002),
      answer(2004),
    ]) {
      const send = mock(async () => {
        throw refusal
      })
      await expect(submitIssue({ content, scope, directory, send })).rejects.toBe(refusal)
      expect(send).toHaveBeenCalledTimes(1)
      expect(await readdir(directory)).toEqual([])
    }
  })

  it('keeps the request for --retry only when the outcome is unknown, naming why', async () => {
    const lost = TransportError.invocation('The response was lost.', {
      phase: 'receive',
      delivery: 'unknown',
    })
    for (const [failure, summary] of [
      [answer(5002, { code: 'FUNCTION_OUTCOME_UNKNOWN', details: {} }), '(5002)'],
      [answer(4005), '(4005)'],
      [answer(4004), '(4004)'],
      [lost, 'The response was lost (TRANSPORT_ERROR)'],
    ] as const) {
      await rm(directory, { recursive: true, force: true })
      const send = mock(async () => {
        throw failure
      })
      await expect(submitIssue({ content, scope, directory, send })).rejects.toMatchObject({
        code: 'ISSUE_NOT_CONFIRMED',
        message: expect.stringContaining(summary),
        hint: expect.stringContaining('astrale issue --retry'),
      })
      expect(send).toHaveBeenCalledTimes(1)
      expect(await readdir(directory)).toHaveLength(1)
    }
  })

  it('resends at once a request the Kernel ran nothing for because its snapshot advanced', async () => {
    const stale = answer(4001, { code: 'MUTATION_SNAPSHOT_STALE', details: {} })
    const send = mock(async () => {
      if (send.mock.calls.length === 1) throw stale
      return receipt
    })
    await expect(submitIssue({ content, scope, directory, send })).resolves.toEqual(receipt)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('drops a retried request once Admin refuses it', async () => {
    let requestId = ''
    await submitIssue({
      content,
      scope,
      directory,
      send: async (payload) => {
        requestId = payload.requestId
        throw answer(5001)
      },
    }).catch(() => {})
    expect(await readdir(directory)).toHaveLength(1)
    const refusal = answer(5000)
    await expect(
      submitIssue({
        retry: requestId,
        scope,
        directory,
        send: async () => {
          throw refusal
        },
      }),
    ).rejects.toBe(refusal)
    expect(await readdir(directory)).toEqual([])
  })

  it('refuses, naming the field or input path, a request that can never be sent', async () => {
    const send = mock(async () => receipt)
    for (const [refused, message] of [
      [{ ...content, title: 'T'.repeat(101) }, 'The title has 101 characters; the limit is 100.'],
      [{ ...content, body: 'before\u0000after' }, 'The body contains a NUL character (U+0000)'],
      [{ ...content, body: 'lone \ud800' }, 'The body contains an unpaired surrogate'],
      [
        { ...content, context: { project: { name: 'orders\u0000' } } },
        'The report cannot be sent: Portable strings must not contain U+0000 at /context/project/name.',
      ],
    ] as const) {
      await expect(submitIssue({ content: refused, scope, directory, send })).rejects.toMatchObject(
        { code: 'ISSUE_INPUT_INVALID', message: expect.stringContaining(message) },
      )
    }
    expect(send).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])

    // Saved by an earlier CLI that allowed 200-character titles: no retry can send it.
    const requestId = '00000000-0000-4000-8000-000000000002'
    const path = join(directory, `${requestId}.json`)
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        scope,
        payload: { ...content, title: 'T'.repeat(150), requestId },
      }),
    )
    await expect(submitIssue({ retry: requestId, scope, directory, send })).rejects.toMatchObject({
      code: 'ISSUE_INPUT_INVALID',
      message: 'The title has 150 characters; the limit is 100.',
    })
    expect(send).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('does not dispatch if the request cannot be saved', async () => {
    const send = mock(async () => receipt)
    await expect(
      submitIssue({ content, scope, directory: '/dev/null/invalid', send }),
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
