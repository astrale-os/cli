import { expect, test } from 'bun:test'

import { inspectTrace, traceId } from '../trace'
const id = '000000000000000000000000000000ab'
const resource = {
  attributes: [
    { key: 'service.instance.id', value: { stringValue: 'instance-1' } },
    { key: 'astrale.issuer', value: { stringValue: 'https://instance.test/api' } },
  ],
}
const span = {
  traceId: Buffer.from(id, 'hex').toString('base64'),
  spanId: 'span-one',
  name: 'query.execute',
  startTimeUnixNano: '1789983992378000000',
  endTimeUnixNano: '1789983992498000000',
  attributes: [{ key: 'astrale.operation.id', value: { stringValue: 'operation-1' } }],
}
const data = { batches: [{ resource, scopeSpans: [{ spans: [span] }] }] }

test('normalizes Tempo IDs, preserves precision and resolves only the requested physical Instance', () => {
  expect(traceId('ab')).toBe(id)
  const result = inspectTrace(data, id, 'instance-1')
  expect(result.issuer).toBe('https://instance.test/api')
  expect(result.spans[0]?.durationMs).toBe(120)
  expect(result.spans[0]?.attributes['astrale.operation.id']).toBe('operation-1')
  expect(result.completeness).toBe('unknown')
  expect(() => inspectTrace(data, id, 'instance-2')).toThrow('No span')
  expect(() => inspectTrace(data, 'ff', 'instance-1')).toThrow('different trace')
})

test('rejects ambiguous issuers and malformed provider timestamps', () => {
  const other = {
    resource: {
      attributes: [
        ...resource.attributes.slice(0, 1),
        { key: 'astrale.issuer', value: { stringValue: 'https://other.test' } },
      ],
    },
    scopeSpans: [{ spans: [span] }],
  }
  expect(() => inspectTrace({ batches: [...data.batches, other] }, id, 'instance-1')).toThrow(
    'unambiguous',
  )
  expect(() =>
    inspectTrace(
      { batches: [{ resource, scopeSpans: [{ spans: [{ ...span, endTimeUnixNano: '0' }] }] }] },
      id,
      'instance-1',
    ),
  ).toThrow('timestamps')
})

test('joins by operation identity and normalizes journal trace IDs with leading zeroes', async () => {
  const { correlateJournal } = await import('../correlate')
  const base = {
    sequence: 1,
    timestamp: '2026-09-21T00:00:00.000Z',
    topic: 'syscall.query',
    payload: null,
  }
  const records = [
    { ...base, correlation: { operationId: 'op' } },
    { ...base, sequence: 2, correlation: { traceId: 'ab' } },
    { ...base, sequence: 3, correlation: { traceId: 'invalid!' } },
    { ...base, sequence: 4, correlation: { operationId: 'other' } },
  ]
  expect(
    correlateJournal(records, {
      traceId: id,
      spans: [{ attributes: { 'astrale.operation.id': 'op' } }],
    }),
  ).toEqual(records.slice(0, 2))
})
