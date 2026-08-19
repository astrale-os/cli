import { describe, expect, test } from 'bun:test'

import { acceptJournalPage, buildJournalInput } from '../logs'

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
          correlation: { invocationId: 'cf862a64-3aa1-4343-ba86-f9b516c4ff95' },
        },
      ],
    })
    expect(page.records[0]).toMatchObject({
      sequence: 10241,
      topic: 'function.invoke',
      timestamp: '2026-08-19T16:51:10.049Z',
      occurredAt: '2026-08-19T16:51:10.049Z',
      committedAt: '2026-08-19T16:51:10.070Z',
      correlationId: 'cf862a64-3aa1-4343-ba86-f9b516c4ff95',
    })
  })
})
