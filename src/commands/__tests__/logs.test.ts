import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import {
  acceptJournalPage,
  buildJournalInput,
  followLogs,
  formatFollowRecord,
  selectCallerRecords,
} from '../logs'

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
      since: '2026-08-10T00:00:00.000Z',
      until: '2026-08-11T00:00:00.000Z',
      cursor: 'opaque-next',
      limit: 50,
    })
  })

  test.each([
    ['2026-09-08T19:40:00Z', '2026-09-08T19:40:00.000Z'],
    ['2026-09-08T19:40:00.1Z', '2026-09-08T19:40:00.100Z'],
    ['2026-09-08T19:40:00.1200Z', '2026-09-08T19:40:00.120Z'],
    ['2026-09-08T19:40:00.123Z', '2026-09-08T19:40:00.123Z'],
    ['2024-03-01T00:30:00+01:00', '2024-02-29T23:30:00.000Z'],
    ['2024-02-29T23:30:00.123-01:00', '2024-03-01T00:30:00.123Z'],
  ])('canonicalizes both bounds without changing the instant: %s', (input, canonical) => {
    expect(buildJournalInput({ since: input, until: input })).toEqual({
      since: canonical,
      until: canonical,
      limit: 200,
    })
    expect(Date.parse(canonical)).toBe(Date.parse(input))
  })

  test.each([
    '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-09-08T24:00:00Z',
    '2026-09-08T19:40:00',
    '2026-09-08T19:40:00+24:00',
    '2026-09-08T19:40:00.1234Z',
    '2026-09-08T19:40:00.0001Z',
  ])('rejects invalid or unrepresentable bounds: %s', (input) => {
    expect(() => buildJournalInput({ since: input })).toThrow('--since')
    expect(() => buildJournalInput({ until: input })).toThrow('--until')
  })

  test('compares bounds by their instants after timezone normalization', () => {
    expect(
      buildJournalInput({
        since: '2026-09-08T21:40:00+02:00',
        until: '2026-09-08T19:40:00Z',
      }),
    ).toEqual({ since: '2026-09-08T19:40:00.000Z', until: '2026-09-08T19:40:00.000Z', limit: 200 })
    expect(() =>
      buildJournalInput({
        since: '2026-09-08T19:40:00.001Z',
        until: '2026-09-08T21:40:00+02:00',
      }),
    ).toThrow('--since')
  })

  /** @evidence TEST-CLI-LOGS-CALLER-NOT-SENT */
  test('never sends --caller: the journal syscall input has no caller field', () => {
    expect(buildJournalInput({ caller: 'user-1', principal: 'domain-1' })).toEqual({
      principal: 'domain-1',
      limit: 200,
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

  /** @evidence TEST-CLI-LOGS-ADMITS-CALLER */
  test('copies the recorded caller beside the executing principal', () => {
    const record = {
      sequence: 8,
      topic: 'function.invoke',
      occurredAt: '2026-09-23T10:00:00.000Z',
      payload: {},
      principal: 'domain-1',
    }
    const [withCaller, withoutCaller] = acceptJournalPage({
      records: [
        { ...record, caller: 'user-1' },
        { ...record, sequence: 9 },
      ],
    }).records
    expect(withCaller).toMatchObject({ principal: 'domain-1', caller: 'user-1' })
    expect(withoutCaller).not.toHaveProperty('caller')
    expect(() => acceptJournalPage({ records: [{ ...record, caller: 7 }] })).toThrow(
      'record 0.caller must be text',
    )
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

describe('selectCallerRecords', () => {
  const page = acceptJournalPage({
    records: [
      { sequence: 1, topic: 't', occurredAt: '2026-09-23T10:00:00.000Z', principal: 'domain-1' },
      {
        sequence: 2,
        topic: 't',
        occurredAt: '2026-09-23T10:00:01.000Z',
        principal: 'domain-1',
        caller: 'user-1',
      },
      { sequence: 3, topic: 't', occurredAt: '2026-09-23T10:00:02.000Z', principal: 'user-2' },
      { sequence: 4, topic: 't', occurredAt: '2026-09-23T10:00:03.000Z' },
    ],
    cursor: 'next-page',
  })

  /** @evidence TEST-CLI-LOGS-FILTERS-CALLER */
  test('keeps exact effective caller matches (caller, else principal) and the page cursor', () => {
    expect(selectCallerRecords(page, 'user-1')).toEqual({
      records: [page.records[1]!],
      cursor: 'next-page',
    })
    // The Domain's own direct call matches; the call it ran for user-1 does not.
    expect(selectCallerRecords(page, 'domain-1')).toEqual({
      records: [page.records[0]!],
      cursor: 'next-page',
    })
    // A record with neither caller nor principal never matches.
    expect(selectCallerRecords(page, 'user-2')).toEqual({
      records: [page.records[2]!],
      cursor: 'next-page',
    })
    expect(selectCallerRecords(page, undefined)).toBe(page)
    expect(selectCallerRecords(page, '  ')).toBe(page)
  })

  /** @evidence TEST-CLI-LOGS-CALLER-DIRECT-CALL */
  test('matches a direct call, which the Kernel records without caller, by its principal', () => {
    const direct = acceptJournalPage({
      records: [
        { sequence: 5, topic: 't', occurredAt: '2026-09-23T10:00:04.000Z', principal: 'user-3' },
      ],
    })
    expect(direct.records[0]).not.toHaveProperty('caller')
    expect(selectCallerRecords(direct, 'user-3').records).toEqual([direct.records[0]!])
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

  test('shows the recorded caller beside the principal on an unflagged TTY', async () => {
    const stdout = await captureFollowOutput({ follow: true }, true, [
      { ...inputRecord, caller: 'caller-1' },
    ])
    expect(stdout).toContain('principal-1')
    expect(stdout).toContain('caller-1')
  })

  test('shows the principal as the caller of a direct call on an unflagged TTY', async () => {
    const stdout = await captureFollowOutput({ follow: true }, true)
    expect(stripVTControlCharacters(stdout).trimEnd().endsWith(' principal-1 principal-1')).toBe(
      true,
    )
  })

  /** @evidence TEST-CLI-LOGS-CALLER-SELF */
  test('expands --caller @self once and keeps only that caller', async () => {
    const inputs: unknown[] = []
    let whoamiCalls = 0
    let pages = 0
    const records = [
      { ...inputRecord, sequence: 3, caller: 'user-1' },
      { ...inputRecord, sequence: 4, caller: 'user-2' },
      { ...inputRecord, sequence: 5 },
      { ...inputRecord, sequence: 6, principal: 'user-1' },
    ]
    const stdout = await captureStdout(true, () =>
      followLogs(
        { follow: true, json: true, caller: '@self' },
        {
          run: async (input) => {
            await input.fn({
              target: {},
              self: async () => {
                whoamiCalls += 1
                return { id: 'user-1' }
              },
              session: {
                call: async (call: { readonly input?: unknown }) => {
                  inputs.push(call.input)
                  pages += 1
                  if (pages === 1) return { records }
                  throw new Error('end of controlled stream')
                },
              },
            } as never)
          },
          pause: async () => {},
        },
      ),
    )
    expect(whoamiCalls).toBe(1)
    expect(
      stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).sequence),
    ).toEqual([3, 6])
    expect(inputs[0]).not.toHaveProperty('caller')
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
    records: readonly unknown[] = [inputRecord],
  ): Promise<string> {
    let pages = 0
    return captureStdout(tty, () =>
      followLogs(opts, {
        run: async (input) => {
          await input.fn({
            session: {
              call: async () => {
                pages += 1
                if (pages === 1) return { records }
                throw new Error('end of controlled stream')
              },
            },
          } as never)
        },
        pause: async () => {},
      }),
    )
  }

  async function captureStdout(tty: boolean, follow: () => Promise<void>): Promise<string> {
    const originalWrite = process.stdout.write
    const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    let stdout = ''
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stdout.write
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty })
    try {
      await expect(follow()).rejects.toThrow('end of controlled stream')
      return stdout
    } finally {
      process.stdout.write = originalWrite
      if (originalTty === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY
      else Object.defineProperty(process.stdout, 'isTTY', originalTty)
    }
  }
})
