import { describe, expect, test } from 'bun:test'

import { acceptJournalPage, buildJournalInput, followLogs, formatFollowRecord } from '../logs'

describe('buildJournalInput', () => {
  /** @evidence TEST-CLI-LOGS-MAPS-EXACT-JOURNAL-INPUT */
  test('maps flags to the current public journal syscall contract', () => {
    expect(
      buildJournalInput({
        topic: 'op:function.failed',
        topicPrefix: 'security.',
        principal: 'caller',
        since: '2026-08-10T00:00:00Z',
        until: '2026-08-11T00:00:00Z',
        cursor: 'opaque-next',
        limit: '50',
      }),
    ).toEqual({
      topics: { exact: ['op:function.failed'], prefixes: ['security.'] },
      principal: 'caller',
      since: '2026-08-10T00:00:00Z',
      until: '2026-08-11T00:00:00Z',
      cursor: 'opaque-next',
      limit: 50,
    })
  })

  test('defaults only the finite limit and rejects invalid values', () => {
    expect(buildJournalInput({})).toEqual({ limit: 200 })
    expect(() => buildJournalInput({ limit: '0' })).toThrow('--limit')
    expect(() => buildJournalInput({ limit: 'all' })).toThrow('--limit')
    expect(() => buildJournalInput({ since: 'not-a-date' })).toThrow('--since')
    expect(() =>
      buildJournalInput({ since: '2026-01-01T00:00:00Z', until: '1999-01-01T00:00:00Z' }),
    ).toThrow('--since')
    expect(() => buildJournalInput({ cursor: 'junk' })).toThrow('--cursor')
  })
})

describe('acceptJournalPage', () => {
  /** @evidence TEST-CLI-LOGS-ADMITS-OPAQUE-CURSOR-PAGE */
  test('retains current records and an opaque continuation cursor', () => {
    const page = acceptJournalPage({
      records: [
        {
          sequence: 7,
          timestamp: '2026-08-11T12:00:00.000Z',
          topic: 'op:function.completed',
          payload: { durationMs: 4 },
          principal: 'caller',
        },
      ],
      cursor: 'next-page',
    })

    expect(page).toEqual({
      records: [
        {
          sequence: 7,
          timestamp: '2026-08-11T12:00:00.000Z',
          topic: 'op:function.completed',
          payload: { durationMs: 4 },
          principal: 'caller',
        },
      ],
      cursor: 'next-page',
    })
  })

  test('rejects malformed record and cursor fields instead of formatting them loosely', () => {
    expect(() => acceptJournalPage({ records: [{}] })).toThrow('record 0')
    expect(() => acceptJournalPage({ records: [], cursor: 7 })).toThrow('cursor')
  })

  test('admits journal v2 records that use occurredAt instead of timestamp', () => {
    const page = acceptJournalPage({
      records: [
        {
          sequence: 10241,
          topic: 'function.invoke',
          occurredAt: '2026-08-19T16:51:10.049Z',
          committedAt: '2026-08-19T16:51:10.070Z',
          payload: { outcome: 'rejected' },
          correlation: {
            operationId: 'operation-child',
            parentOperationId: 'operation-parent',
            invocationId: 'cf862a64-3aa1-4343-ba86-f9b516c4ff95',
            rootInvocationId: 'invocation-root',
            parentInvocationId: 'invocation-parent',
            traceId: 'trace-1',
            spanId: 'span-1',
          },
        },
      ],
    })
    expect(page.records[0]).toMatchObject({
      sequence: 10241,
      topic: 'function.invoke',
      timestamp: '2026-08-19T16:51:10.049Z',
      occurredAt: '2026-08-19T16:51:10.049Z',
      committedAt: '2026-08-19T16:51:10.070Z',
      correlation: {
        operationId: 'operation-child',
        parentOperationId: 'operation-parent',
        invocationId: 'cf862a64-3aa1-4343-ba86-f9b516c4ff95',
        rootInvocationId: 'invocation-root',
        parentInvocationId: 'invocation-parent',
        traceId: 'trace-1',
        spanId: 'span-1',
      },
      correlationId: 'cf862a64-3aa1-4343-ba86-f9b516c4ff95',
    })
  })

  test('rejects malformed or invented structured correlation fields', () => {
    const record = {
      sequence: 1,
      topic: 'function.invoke',
      occurredAt: '2026-08-19T16:51:10.049Z',
      payload: {},
    }
    expect(() => acceptJournalPage({ records: [{ ...record, correlation: 'opaque' }] })).toThrow(
      'correlation must be an object',
    )
    expect(() =>
      acceptJournalPage({ records: [{ ...record, correlation: { authority: 'forged' } }] }),
    ).toThrow('correlation.authority is unsupported')
    for (const field of [
      'operationId',
      'parentOperationId',
      'invocationId',
      'rootInvocationId',
      'parentInvocationId',
      'traceId',
      'spanId',
    ]) {
      expect(() =>
        acceptJournalPage({ records: [{ ...record, correlation: { [field]: 7 } }] }),
      ).toThrow(`correlation.${field}`)
    }
    expect(() =>
      acceptJournalPage({ records: [{ ...record, correlation: { invocationId: '   ' } }] }),
    ).toThrow('must be non-empty')
    expect(() =>
      acceptJournalPage({
        records: [{ ...record, correlation: { invocationId: 'x'.repeat(257) } }],
      }),
    ).toThrow('at most 256 UTF-8 bytes')
    expect(
      acceptJournalPage({
        records: [{ ...record, correlation: { invocationId: 'x'.repeat(256) } }],
      }).records[0].correlation?.invocationId,
    ).toHaveLength(256)
    expect(
      acceptJournalPage({
        records: [{ ...record, correlation: { invocationId: 'é'.repeat(128) } }],
      }).records[0].correlation?.invocationId,
    ).toHaveLength(128)
    expect(() =>
      acceptJournalPage({
        records: [{ ...record, correlation: { invocationId: `${'é'.repeat(127)}€` } }],
      }),
    ).toThrow('at most 256 UTF-8 bytes')
  })

  test('keeps legacy identity compatibility coherent with structured correlation', () => {
    const record = {
      sequence: 1,
      topic: 'function.invoke',
      occurredAt: '2026-08-19T16:51:10.049Z',
      payload: {},
    }
    expect(
      acceptJournalPage({
        records: [{ ...record, correlationId: 'legacy-only', causationId: 'legacy-cause' }],
      }).records[0],
    ).toMatchObject({ correlationId: 'legacy-only', causationId: 'legacy-cause' })
    expect(
      acceptJournalPage({
        records: [
          {
            ...record,
            correlationId: 'same',
            correlation: { invocationId: 'same' },
          },
        ],
      }).records[0],
    ).toMatchObject({ correlationId: 'same', correlation: { invocationId: 'same' } })
    expect(() =>
      acceptJournalPage({
        records: [
          {
            ...record,
            correlationId: 'legacy',
            correlation: { invocationId: 'structured' },
          },
        ],
      }),
    ).toThrow('conflicting correlation identifiers')
  })

  test('serializes one complete structured record per machine-follow line', () => {
    const record = acceptJournalPage({
      records: [
        {
          sequence: 2,
          topic: 'function.invoke',
          occurredAt: '2026-08-19T16:51:10.049Z',
          payload: { outcome: 'completed' },
          correlation: {
            operationId: 'operation-child',
            parentOperationId: 'operation-parent',
            invocationId: 'invocation-child',
            rootInvocationId: 'invocation-root',
            parentInvocationId: 'invocation-parent',
            traceId: 'trace-1',
            spanId: 'span-1',
          },
        },
      ],
    }).records[0]
    expect(formatFollowRecord(record).endsWith('\n')).toBe(true)
    expect(JSON.parse(formatFollowRecord(record))).toEqual(record)
  })
})

describe('follow output routing', () => {
  const inputRecord = {
    sequence: 2,
    topic: 'function.invoke',
    occurredAt: '2026-08-19T16:51:10.049Z',
    payload: { outcome: 'completed' },
    principal: 'principal-1',
    correlation: {
      invocationId: 'invocation-child',
      rootInvocationId: 'invocation-root',
      parentInvocationId: 'invocation-parent',
    },
  }
  const admittedRecord = acceptJournalPage({ records: [inputRecord] }).records[0]

  test('routes every effective machine mode through complete NDJSON records', async () => {
    for (const { opts, tty } of [
      { opts: { json: true }, tty: true },
      { opts: { raw: true }, tty: true },
      { opts: { format: 'json' as const }, tty: true },
      { opts: { ci: true }, tty: true },
      { opts: {}, tty: false },
      { opts: { format: 'yaml' as const, json: true }, tty: true },
      { opts: { format: 'yaml' as const, raw: true }, tty: true },
    ]) {
      const stdout = await captureFollowOutput({ ...opts, follow: true }, tty)
      expect(stdout.endsWith('\n')).toBe(true)
      expect(JSON.parse(stdout)).toEqual(admittedRecord)
    }
  })

  test('keeps an unflagged TTY human-readable', async () => {
    const stdout = await captureFollowOutput({ follow: true }, true)
    expect(stdout).toContain('function.invoke')
    expect(stdout).toContain('principal-1')
    expect(stdout).not.toContain('invocation-child')
    expect(() => JSON.parse(stdout)).toThrow()
  })

  test('rejects effective YAML before opening a Kernel session', async () => {
    let runCalls = 0
    await expect(
      followLogs(
        { follow: true, format: 'yaml' },
        {
          run: async () => {
            runCalls += 1
          },
          pause: async () => {},
        },
      ),
    ).rejects.toThrow('--follow does not support YAML')
    expect(runCalls).toBe(0)
  })

  async function captureFollowOutput(
    opts: Parameters<typeof followLogs>[0],
    tty: boolean,
  ): Promise<string> {
    const originalWrite = process.stdout.write
    const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    let stdout = ''
    let pages = 0
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stdout.write
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty })
    try {
      await expect(
        followLogs(opts, {
          run: async (input) => {
            await input.fn({
              session: {
                call: async () => {
                  pages += 1
                  if (pages === 1) return { records: [inputRecord] }
                  throw new Error('end of controlled stream')
                },
              },
            } as never)
          },
          pause: async () => {},
        }),
      ).rejects.toThrow('end of controlled stream')
      return stdout
    } finally {
      process.stdout.write = originalWrite
      if (originalTty === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY
      else Object.defineProperty(process.stdout, 'isTTY', originalTty)
    }
  }
})
