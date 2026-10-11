import { describe, expect, spyOn, test } from 'bun:test'

import { acceptJournalPage, buildJournalInput, followLogs, selectCallerRecords } from '../logs'

describe('buildJournalInput', () => {
  /** @evidence TEST-CLI-LOGS-MAPS-EXACT-JOURNAL-INPUT */
  test('maps flags to the current public journal syscall contract', () => {
    expect(
      buildJournalInput({
        topic: 'function.invoke',
        topicPrefix: 'security.',
        principal: 'caller',
        since: '2026-08-10T00:00:00Z',
        until: '2026-08-11T00:00:00Z',
        cursor: 'opaque-next',
        limit: '50',
      }),
    ).toEqual({
      topics: { exact: ['function.invoke'], prefixes: ['security.'] },
      principal: 'caller',
      since: '2026-08-10T00:00:00.000Z',
      until: '2026-08-11T00:00:00.000Z',
      cursor: 'opaque-next',
      limit: 50,
    })
  })

  test.each([
    ['2026-09-08T19:40:00.1200Z', '2026-09-08T19:40:00.120Z'],
    ['2024-03-01T00:30:00+01:00', '2024-02-29T23:30:00.000Z'],
  ])('canonicalizes both bounds without changing the instant: %s', (input, canonical) => {
    expect(buildJournalInput({ since: input, until: input })).toEqual({
      since: canonical,
      until: canonical,
      limit: 200,
    })
    expect(Date.parse(canonical)).toBe(Date.parse(input))
  })

  test.each(['2025-02-29T00:00:00Z', '2026-09-08T19:40:00', '2026-09-08T19:40:00.1234Z'])(
    'rejects invalid or unrepresentable bounds: %s',
    (input) => {
      expect(() => buildJournalInput({ since: input })).toThrow('--since')
      expect(() => buildJournalInput({ until: input })).toThrow('--until')
    },
  )

  test.each([
    [{ since: '2026-01-01T00:00:00Z', until: '1999-01-01T00:00:00Z' }, '--since'],
    [{ cursor: 'junk' }, '--cursor'],
    [{ limit: '0' }, '--limit'],
    [{ limit: 'all' }, '--limit'],
  ])('rejects %j before any journal read', (opts, flag) => {
    expect(() => buildJournalInput(opts)).toThrow(flag)
  })

  /** @evidence TEST-CLI-LOGS-CALLER-NOT-SENT */
  test('never sends --caller: the journal syscall input has no caller field', () => {
    expect(buildJournalInput({ caller: 'user-1', principal: 'domain-1' })).toEqual({
      principal: 'domain-1',
      limit: 200,
    })
  })
})

describe('acceptJournalPage', () => {
  /** @evidence TEST-CLI-LOGS-ADMITS-OPAQUE-CURSOR-PAGE TEST-CLI-LOGS-ADMITS-CALLER */
  test('retains records, their recorded caller beside the principal, and an opaque cursor', () => {
    const record = {
      sequence: 7,
      occurredAt: '2026-08-11T12:00:00.000Z',
      topic: 'function.invoke',
      payload: { durationMs: 4 },
      principal: 'domain-1',
    }
    const page = { records: [{ ...record, caller: 'user-1' }, record], cursor: 'next-page' }
    expect(acceptJournalPage(page)).toEqual(page)
    expect(() => acceptJournalPage({ records: [{ ...record, caller: 7 }] })).toThrow(
      'record 0.caller must be text',
    )
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

  test('rejects malformed records, cursors, frontiers, gaps and invented correlation fields', () => {
    const frontier = { id: 'journal-1', committed: 9, durable: 9 }
    const record = { sequence: 1, topic: 't', occurredAt: '2026-08-19T16:51:10.049Z', payload: {} }
    expect(() => acceptJournalPage({ records: [{}] })).toThrow('record 0 is invalid')
    expect(() => acceptJournalPage({ records: [{ sequence: 1, topic: 't' }] })).toThrow(
      'record 0 is missing occurredAt',
    )
    expect(() => acceptJournalPage({ records: [], cursor: 7 })).toThrow('cursor must be text')
    for (const [correlation, message] of [
      ['opaque', 'correlation must be an object'],
      [{ authority: 'forged' }, 'correlation.authority is unsupported'],
      [{ invocationId: 'x'.repeat(257) }, 'at most 256 UTF-8 bytes'],
    ] as const) {
      expect(() => acceptJournalPage({ records: [{ ...record, correlation }] })).toThrow(message)
    }
    for (const malformed of [{ id: ' ' }, { committed: -1 }, { first: 0 }]) {
      expect(() =>
        acceptJournalPage({ records: [], frontier: { ...frontier, ...malformed } }),
      ).toThrow('frontier')
    }
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

  /** @evidence TEST-CLI-LOGS-FILTERS-CALLER TEST-CLI-LOGS-CALLER-DIRECT-CALL */
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
    // A direct call, recorded without caller, matches by its principal; a record with neither
    // caller nor principal never matches.
    expect(selectCallerRecords(page, 'user-2')).toEqual({
      records: [page.records[2]!],
      cursor: 'next-page',
    })
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
      { opts: { format: 'json' as const }, tty: true },
      { opts: {}, tty: false },
      { opts: { format: 'yaml' as const, raw: true }, tty: true },
    ]) {
      const { stdout } = await follow(opts, [{ records: [inputRecord] }], tty)
      expect(stdout.endsWith('\n')).toBe(true)
      expect(JSON.parse(stdout)).toEqual(admittedRecord)
    }
  })

  test('keeps an unflagged TTY human-readable, the recorded caller beside the principal', async () => {
    const { stdout } = await follow(
      {},
      [{ records: [{ ...inputRecord, caller: 'caller-1' }] }],
      true,
    )
    for (const shown of ['function.invoke', 'principal-1', 'caller-1'])
      expect(stdout).toContain(shown)
    expect(stdout).not.toContain('invocation-child')
  })

  /** @evidence TEST-CLI-LOGS-CALLER-SELF */
  test('expands both @self filters once and keeps only that caller', async () => {
    // Other command suites replace the connection barrel globally. A fresh process exercises
    // the real self resolver regardless of Bun's test-file load order.
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
        import { followLogs } from ${JSON.stringify(new URL('../logs.ts', import.meta.url).pathname)}
        const record = ${JSON.stringify(inputRecord)}
        const inputs = []
        let whoamiCalls = 0
        let pages = 0
        let stdout = ''
        const write = process.stdout.write.bind(process.stdout)
        process.stdout.write = (chunk) => { stdout += chunk; return true }
        try {
          await followLogs({ follow: true, json: true, caller: '@self', principal: '@self' }, {
            run: async (input) => input.fn({
              target: {},
              self: async () => { whoamiCalls++; return { id: 'user-1' } },
              session: { call: async (call) => {
                inputs.push(call.input)
                if (++pages > 1) throw new Error('end of controlled stream')
                return { records: [
                  { ...record, sequence: 3, caller: 'user-1' },
                  { ...record, sequence: 4, caller: 'user-2' },
                  { ...record, sequence: 5 },
                  { ...record, sequence: 6, principal: 'user-1' },
                ] }
              } },
            }),
            pause: async () => {},
          })
        } catch (error) {
          if (error.message !== 'end of controlled stream') throw error
        }
        write(JSON.stringify({ whoamiCalls, inputs, records: stdout.trim().split('\\n').map(JSON.parse) }))
        `,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.whoamiCalls).toBe(1)
    expect(result.records.map((record: { sequence: number }) => record.sequence)).toEqual([3, 6])
    expect(result.inputs[0]).not.toHaveProperty('caller')
    expect(result.inputs[0].principal).toBe('user-1')
  }, 10_000)

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

  test('restarts in a recreated journal, reports a recovery loss, ends on a refused cursor', async () => {
    const recreated = frontier('journal-2', 2)
    const restarted = await follow({ json: true }, [
      {
        records: [record(1), record(2), record(3)],
        cursor: 'journal-1-cursor',
        frontier: frontier('journal-1', 9),
      },
      { records: [], frontier: recreated, gap: { kind: 'generation', frontier: recreated } },
      { records: [record(1), record(2)], frontier: recreated },
    ])
    expect(restarted.sequences).toEqual([1, 2, 3, 1, 2])
    expect(restarted.cursors).toEqual([undefined, 'journal-1-cursor', undefined, undefined])
    expect(JSON.parse(restarted.stderr)).toMatchObject({ gap: { kind: 'generation' } })

    const current = frontier('journal-1', 7)
    const gap = { kind: 'recovery', from: 4, through: 6, frontier: current }
    const recovered = await follow({ json: true }, [
      { records: [record(3), record(7)], cursor: 'after-seven', frontier: current, gap },
    ])
    expect(recovered.sequences).toEqual([3, 7])
    expect(recovered.cursors).toEqual([undefined, 'after-seven'])
    expect(JSON.parse(recovered.stderr)).toMatchObject({
      message: 'Journal records #4–#6 were lost during journal recovery',
    })

    const refused = await follow({ json: true, cursor: 'foreign-cursor' }, [
      { records: [], frontier: current, gap: { kind: 'cursor', reason: 'stale' } },
    ])
    expect(refused.error).toMatchObject({ code: 'JOURNAL_CURSOR_INVALID' })
    expect(refused.stdout).toBe('')
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

    // A Kernel that repeats the cursor it was sent is caught up too.
    const repeated = await follow({ json: true }, [
      { records: [record(1)], cursor: 'repeated-cursor', frontier: current },
      { records: [], cursor: 'repeated-cursor', frontier: current },
    ])
    expect(repeated.events).toEqual(['call', 'call', 'pause', 'call'])
  })

  test('warns a human reader on stderr, never on stdout', async () => {
    const current = frontier('journal-1', 900, 500)
    const warned = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const run = await follow(
        { cursor: 'evicted-cursor' },
        [{ records: [], frontier: current, gap: { kind: 'retention', frontier: current } }],
        true,
      )
      expect(run.stdout).toBe('')
      expect(String(warned.mock.calls.flat())).toContain('before #500 were evicted by retention')
    } finally {
      warned.mockRestore()
    }
  })
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
