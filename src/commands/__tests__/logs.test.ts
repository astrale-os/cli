import { describe, expect, test } from 'bun:test'

import {
  acceptJournalPage,
  buildJournalInput,
  describeJournalGap,
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

  /** @evidence TEST-CLI-LOGS-RETAINS-TYPED-GAP */
  test('retains the frontier and every typed gap instead of an ordinary empty page', () => {
    const frontier = { id: 'journal-1', first: 40, committed: 90, durable: 90 }
    for (const gap of [
      { kind: 'retention', frontier },
      { kind: 'recovery', from: 41, through: 44, frontier },
      { kind: 'generation', frontier: { id: 'journal-2', committed: 0, durable: 0 } },
      { kind: 'cursor', reason: 'stale' },
      { kind: 'cursor', reason: 'selection' },
      { kind: 'cursor', reason: 'visibility' },
    ] as const) {
      expect(acceptJournalPage({ records: [], frontier, gap })).toEqual({
        records: [],
        frontier,
        gap,
      })
    }
  })

  test('rejects malformed frontiers and gaps', () => {
    const frontier = { id: 'journal-1', committed: 9, durable: 9 }
    expect(() => acceptJournalPage({ records: [], frontier: { ...frontier, id: ' ' } })).toThrow(
      'frontier',
    )
    expect(() =>
      acceptJournalPage({ records: [], frontier: { ...frontier, committed: -1 } }),
    ).toThrow('frontier')
    expect(() => acceptJournalPage({ records: [], frontier: { ...frontier, first: 0 } })).toThrow(
      'frontier',
    )
    for (const gap of [
      { kind: 'retention' },
      { kind: 'recovery', from: 5, through: 4, frontier },
      { kind: 'cursor', reason: 'expired' },
      { kind: 'unknown', frontier },
      'retention',
    ]) {
      expect(() => acceptJournalPage({ records: [], frontier, gap })).toThrow('gap')
    }
  })

  test('names what each gap lost', () => {
    const frontier = { id: 'journal-1', first: 40, committed: 90, durable: 90 }
    expect(describeJournalGap({ kind: 'retention', frontier })).toContain('before #40')
    expect(describeJournalGap({ kind: 'recovery', from: 41, through: 44, frontier })).toContain(
      '#41–#44',
    )
    expect(describeJournalGap({ kind: 'generation', frontier })).toContain('recreated')
    expect(describeJournalGap({ kind: 'cursor', reason: 'selection' })).toContain('selection')
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
      {
        sequence: 3,
        topic: 't',
        occurredAt: '2026-09-23T10:00:02.000Z',
        principal: 'user-2',
        caller: 'user-2',
      },
    ],
    cursor: 'next-page',
  })

  /** @evidence TEST-CLI-LOGS-FILTERS-CALLER */
  test('keeps exact caller matches and the page cursor; records without caller never match', () => {
    expect(selectCallerRecords(page, 'user-1')).toEqual({
      records: [page.records[1]!],
      cursor: 'next-page',
    })
    expect(selectCallerRecords(page, 'domain-1')).toEqual({ records: [], cursor: 'next-page' })
    expect(selectCallerRecords(page, undefined)).toBe(page)
    expect(selectCallerRecords(page, '  ')).toBe(page)
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

  /** @evidence TEST-CLI-LOGS-CALLER-SELF */
  test('expands --caller @self once and keeps only that caller', async () => {
    const inputs: unknown[] = []
    let whoamiCalls = 0
    let pages = 0
    const records = [
      { ...inputRecord, sequence: 3, caller: 'user-1' },
      { ...inputRecord, sequence: 4, caller: 'user-2' },
      { ...inputRecord, sequence: 5 },
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
    ).toEqual([3])
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

describe('follow continuity', () => {
  const record = (sequence: number) => ({
    sequence,
    topic: 'function.invoke',
    occurredAt: '2026-09-28T12:00:00.000Z',
    payload: {},
  })
  const frontier = (id: string, committed: number, first?: number) => ({
    id,
    ...(first === undefined ? {} : { first }),
    committed,
    durable: committed,
  })

  /** @evidence TEST-CLI-LOGS-FOLLOW-EMITS-ONCE */
  test('emits each record once while the tail is re-read without a new cursor', async () => {
    const run = await follow({ json: true }, [
      { records: [record(1), record(2)], frontier: frontier('journal-1', 2) },
      { records: [record(1), record(2), record(3)], frontier: frontier('journal-1', 3) },
      { records: [record(4)], cursor: 'after-four', frontier: frontier('journal-1', 5) },
      { records: [record(5)], frontier: frontier('journal-1', 5) },
      { records: [record(5)], frontier: frontier('journal-1', 5) },
    ])

    expect(run.sequences).toEqual([1, 2, 3, 4, 5])
    expect(run.cursors).toEqual([
      undefined,
      undefined,
      undefined,
      'after-four',
      'after-four',
      'after-four',
    ])
    expect(run.stderr).toBe('')
  })

  /** @evidence TEST-CLI-LOGS-FOLLOW-RESUMES-AFTER-RETENTION */
  test('reports a retention gap and resumes at the oldest retained record at once', async () => {
    const current = frontier('journal-1', 900, 500)
    const run = await follow({ json: true, cursor: 'evicted-cursor' }, [
      { records: [], frontier: current, gap: { kind: 'retention', frontier: current } },
      { records: [record(500), record(501)], cursor: 'after-501', frontier: current },
    ])

    expect(run.sequences).toEqual([500, 501])
    expect(run.cursors).toEqual(['evicted-cursor', undefined, 'after-501'])
    expect(run.events).toEqual(['call', 'call', 'call'])
    expect(JSON.parse(run.stderr)).toEqual({
      warning: 'JOURNAL_GAP',
      message: 'Journal records before #500 were evicted by retention',
      gap: { kind: 'retention', frontier: current },
    })
  })

  test('restarts sequence tracking in a recreated journal', async () => {
    const recreated = frontier('journal-2', 2)
    const run = await follow({ json: true }, [
      {
        records: [record(1), record(2), record(3)],
        cursor: 'journal-1-cursor',
        frontier: frontier('journal-1', 9),
      },
      { records: [], frontier: recreated, gap: { kind: 'generation', frontier: recreated } },
      { records: [record(1), record(2)], frontier: recreated },
    ])

    expect(run.sequences).toEqual([1, 2, 3, 1, 2])
    expect(run.cursors).toEqual([undefined, 'journal-1-cursor', undefined, undefined])
    expect(JSON.parse(run.stderr)).toMatchObject({ gap: { kind: 'generation' } })
  })

  test('reports records lost during recovery and keeps the returned cursor', async () => {
    const current = frontier('journal-1', 7)
    const run = await follow({ json: true }, [
      {
        records: [record(3), record(7)],
        cursor: 'after-seven',
        frontier: current,
        gap: { kind: 'recovery', from: 4, through: 6, frontier: current },
      },
    ])

    expect(run.sequences).toEqual([3, 7])
    expect(run.cursors).toEqual([undefined, 'after-seven'])
    expect(JSON.parse(run.stderr)).toMatchObject({
      message: 'Journal records #4–#6 were lost during journal recovery',
    })
  })

  test('ends the follow when the Kernel refuses its cursor', async () => {
    const run = await follow({ json: true, cursor: 'foreign-cursor' }, [
      { records: [], frontier: frontier('journal-1', 9), gap: { kind: 'cursor', reason: 'stale' } },
    ])

    expect(run.error).toMatchObject({ code: 'JOURNAL_CURSOR_INVALID' })
    expect(run.cursors).toEqual(['foreign-cursor'])
    expect(run.stdout).toBe('')
  })

  test('waits before polling again when a gap arrives without a cursor to drop', async () => {
    const current = frontier('journal-1', 9, 5)
    const run = await follow({ json: true }, [
      { records: [], frontier: current, gap: { kind: 'retention', frontier: current } },
    ])

    expect(run.events).toEqual(['call', 'pause', 'call'])
  })

  /** @evidence TEST-CLI-LOGS-FOLLOW-DRAINS-WHILE-BEHIND */
  test('reads on at once while the Kernel returns new cursors and polls once caught up', async () => {
    const current = frontier('journal-1', 3)
    const run = await follow({ json: true }, [
      { records: [record(1)], cursor: 'after-one-cursor', frontier: current },
      { records: [record(2)], cursor: 'after-two-cursor', frontier: current },
      { records: [record(3)], frontier: current },
    ])

    expect(run.sequences).toEqual([1, 2, 3])
    expect(run.cursors).toEqual([
      undefined,
      'after-one-cursor',
      'after-two-cursor',
      'after-two-cursor',
    ])
    expect(run.events).toEqual(['call', 'call', 'call', 'pause', 'call'])
  })

  test('waits before polling again when the Kernel repeats the cursor it was sent', async () => {
    const current = frontier('journal-1', 1)
    const run = await follow({ json: true }, [
      { records: [record(1)], cursor: 'repeated-cursor', frontier: current },
      { records: [], cursor: 'repeated-cursor', frontier: current },
    ])

    expect(run.events).toEqual(['call', 'call', 'pause', 'call'])
  })

  test('warns a human reader on stderr, never on stdout', async () => {
    const current = frontier('journal-1', 900, 500)
    const originalError = console.error
    const warnings: string[] = []
    console.error = (...parts: unknown[]) => void warnings.push(parts.join(' '))
    try {
      const run = await follow(
        { cursor: 'evicted-cursor' },
        [{ records: [], frontier: current, gap: { kind: 'retention', frontier: current } }],
        true,
      )
      expect(run.stdout).toBe('')
    } finally {
      console.error = originalError
    }
    expect(warnings.join('\n')).toContain('before #500 were evicted by retention')
  })

  async function follow(
    opts: Omit<Parameters<typeof followLogs>[0], 'follow'>,
    pages: readonly unknown[],
    tty = false,
  ) {
    const originalStdout = process.stdout.write
    const originalStderr = process.stderr.write
    const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const result = {
      stdout: '',
      stderr: '',
      cursors: [] as (string | undefined)[],
      events: [] as string[],
      error: undefined as unknown,
      sequences: [] as number[],
    }
    process.stdout.write = ((chunk: string | Uint8Array) => {
      result.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      result.stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stderr.write
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty })
    try {
      await followLogs(
        { ...opts, follow: true },
        {
          run: async (input) => {
            await input.fn({
              session: {
                call: async (call: { readonly input: { readonly cursor?: string } }) => {
                  result.events.push('call')
                  result.cursors.push(call.input.cursor)
                  const page = pages[result.cursors.length - 1]
                  if (page === undefined) throw new Error('end of controlled stream')
                  return page
                },
              },
            } as never)
          },
          pause: async () => void result.events.push('pause'),
        },
      )
    } catch (error) {
      if (!(error instanceof Error && error.message === 'end of controlled stream')) {
        result.error = error
      }
    } finally {
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
      if (originalTty === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY
      else Object.defineProperty(process.stdout, 'isTTY', originalTty)
    }
    if (!tty) {
      result.sequences = result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { sequence: number }).sequence)
    }
    return result
  }
})
