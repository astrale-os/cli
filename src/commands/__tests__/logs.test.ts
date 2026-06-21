import { describe, expect, test } from 'bun:test'

import { buildEventsParams, normalizePage, parseServiceName, parseTimeFlag } from '../logs'

describe('parseTimeFlag', () => {
  test('passes through epoch-ms', () => {
    expect(parseTimeFlag('--since', '1718841600000')).toBe(1718841600000)
    expect(parseTimeFlag('--since', '0')).toBe(0)
    expect(parseTimeFlag('--since', '-5')).toBe(-5)
  })

  test('parses ISO-8601 to epoch ms', () => {
    expect(parseTimeFlag('--since', '2026-06-20T00:00:00Z')).toBe(
      Date.parse('2026-06-20T00:00:00Z'),
    )
  })

  test('throws on garbage', () => {
    expect(() => parseTimeFlag('--since', 'not-a-time')).toThrow('--since')
  })
})

describe('buildEventsParams', () => {
  test('defaults limit when unset, no other fields', () => {
    expect(buildEventsParams({})).toEqual({ limit: 200 })
  })

  test('maps typed flags into a JournalFilter', () => {
    expect(
      buildEventsParams({
        topic: 'op:*:failed',
        principal: 'id_abc',
        since: '1000',
        until: '2000',
        limit: '50',
        cursor: '7',
      }),
    ).toEqual({
      topic: 'op:*:failed',
      principal: 'id_abc' as never,
      since: 1000,
      until: 2000,
      limit: 50,
      cursor: 7,
    })
  })

  test('rejects a non-positive limit', () => {
    expect(() => buildEventsParams({ limit: '0' })).toThrow('--limit')
    expect(() => buildEventsParams({ limit: '-3' })).toThrow('--limit')
    expect(() => buildEventsParams({ limit: 'x' })).toThrow('--limit')
  })

  test('rejects a non-positive cursor', () => {
    expect(() => buildEventsParams({ cursor: '0' })).toThrow('--cursor')
  })

  test('omits empty topic/principal', () => {
    expect(buildEventsParams({ topic: '', principal: '' })).toEqual({ limit: 200 })
  })
})

describe('normalizePage', () => {
  const entry = (seq: number) => ({
    seq,
    event: {
      id: `e${seq}`,
      topic: 'op:x',
      payload: {},
      metadata: { traceId: 't', timestamp: seq, principal: 'p', root: 'r' },
    },
  })

  test('wraps a bare entry array and derives nextCursor from max seq', () => {
    const page = normalizePage([entry(3), entry(7), entry(5)])
    expect(page.entries).toHaveLength(3)
    expect(page.nextCursor).toBe(7)
  })

  test('empty array → empty entries, null cursor', () => {
    expect(normalizePage([])).toEqual({ entries: [], nextCursor: null })
  })

  test('accepts a paged { entries, nextCursor } shape', () => {
    const page = normalizePage({ entries: [entry(1)], nextCursor: 42 })
    expect(page.entries).toHaveLength(1)
    expect(page.nextCursor).toBe(42)
  })

  test('paged shape without nextCursor falls back to max seq', () => {
    expect(normalizePage({ entries: [entry(9)] }).nextCursor).toBe(9)
  })

  test('non-array, non-page input → empty', () => {
    expect(normalizePage(null)).toEqual({ entries: [], nextCursor: null })
    expect(normalizePage(undefined)).toEqual({ entries: [], nextCursor: null })
    expect(normalizePage('nope')).toEqual({ entries: [], nextCursor: null })
  })
})

describe('parseServiceName', () => {
  test('bare name is returned as-is', () => {
    expect(parseServiceName('my-notes')).toBe('my-notes')
  })

  test('host → first label', () => {
    expect(parseServiceName('my-notes.svc.eu.astrale.ai')).toBe('my-notes')
  })

  test('full URL → hostname first label', () => {
    expect(parseServiceName('https://my-notes.example.dev/path')).toBe('my-notes')
  })

  test('trims whitespace', () => {
    expect(parseServiceName('  my-notes  ')).toBe('my-notes')
  })
})
