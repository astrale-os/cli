import { expect, test } from 'bun:test'

import { collectJournal } from '../../lib/journal/collect'
import { acceptJournalPage } from '../logs'

const frontier = { id: 'journal-one', committed: 20, durable: 20, first: 1 }
const record = {
  sequence: 4,
  timestamp: '2026-09-21T00:00:00.000Z',
  topic: 'query.execute',
  payload: { input: { omitted: 'secret' } },
}

test('continues through filtered empty pages and freezes the selection for every cursor', async () => {
  const inputs: unknown[] = []
  const pages = [
    { records: [], cursor: 'cursor-one', frontier },
    { records: [record], cursor: 'cursor-two', frontier },
    { records: [record], frontier },
  ]
  const result = await collectJournal(
    { limit: 20 },
    async (input) => {
      expect(JSON.parse(JSON.stringify(input))).toEqual(input)
      expect(Object.values(input)).not.toContain(undefined)
      inputs.push(input)
      return acceptJournalPage(pages.shift())
    },
    { maxPages: 4, now: () => new Date('2026-09-21T01:00:00.000Z') },
  )
  expect(result.records).toEqual([record])
  expect(result.coverage).toMatchObject({ status: 'complete', pages: 3 })
  expect(inputs).toEqual(
    [undefined, 'cursor-one', 'cursor-two'].map((cursor) => ({
      limit: 20,
      cursor,
      until: '2026-09-21T01:00:00.000Z',
    })),
  )
})

test('preserves gaps and cursor for an explicitly partial bounded result', async () => {
  const gap = { kind: 'recovery', from: 1, through: 3, frontier }
  const result = await collectJournal(
    { limit: 20 },
    async () => acceptJournalPage({ records: [record], frontier, gap, cursor: 'cursor-one' }),
    { maxPages: 1 },
  )
  expect(result.coverage).toMatchObject({
    status: 'partial',
    reasons: ['journal-gap', 'page-limit'],
    gaps: [gap],
  })
  expect(result.cursor).toBe('cursor-one')
  expect(result.records[0]?.payload).toEqual(record.payload)
})

test('does not report legacy responses, generation changes or looping cursors as complete', async () => {
  const legacy = await collectJournal({ limit: 20 }, async () => ({ records: [] }), { maxPages: 1 })
  expect(legacy.coverage.reasons).toEqual(['frontier-unavailable'])
  let count = 0
  const loop = await collectJournal(
    { limit: 20 },
    async () => ({
      records: [],
      frontier: { ...frontier, id: String(count++) },
      cursor: 'same-cursor',
    }),
    { maxPages: 10 },
  )
  expect(loop.coverage.pages).toBe(2)
  expect(loop.coverage.reasons).toEqual(['journal-generation-changed', 'cursor-not-advancing'])
})

test('retains record evidence and refuses a resume that changes its implicit time window', async () => {
  expect(
    acceptJournalPage({
      records: [
        { ...record, id: 'entry-id', journal: 'journal-one', version: 2, configuration: 'config' },
      ],
      frontier,
    }).records[0],
  ).toMatchObject({ id: 'entry-id', journal: 'journal-one', version: 2, configuration: 'config' })
  await expect(
    collectJournal({ limit: 20, cursor: 'cursor-one' }, async () => ({ records: [] }), {
      maxPages: 2,
    }),
  ).rejects.toThrow('original until')
})

test('retains prior evidence and the failing cursor without retrying an authorization refusal', async () => {
  const { ResponseError } = await import('@astrale-os/sdk/client')
  let calls = 0
  const result = await collectJournal(
    { limit: 20 },
    async () => {
      if (++calls === 1) return { records: [record], frontier, cursor: 'cursor-denied' }
      throw new ResponseError(2004, 'Access denied.', {
        source: 'https://instance.test',
        id: 'invocation',
      } as ConstructorParameters<typeof ResponseError>[2])
    },
    { maxPages: 10 },
  )
  expect(calls).toBe(2)
  expect(result.cursor).toBe('cursor-denied')
  expect(result.records).toEqual([record])
  expect(result.coverage).toMatchObject({ status: 'partial', reasons: ['read-failed'] })
  expect(result.error).toMatchObject({ code: 2004, message: 'Access denied.' })
})
