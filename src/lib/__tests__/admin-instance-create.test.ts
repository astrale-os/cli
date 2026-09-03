import { describe, expect, test } from 'bun:test'

import { planInstanceCreate } from '../admin-instance'

const ready = {
  id: '@ready',
  slug: 'demo',
  url: 'https://demo.example.test/api',
  state: 'ready' as const,
}

describe('Admin Instance create recovery', () => {
  test('returns an existing ready Instance', () => {
    expect(planInstanceCreate([ready], 'demo', 'new-operation')).toEqual({
      kind: 'ready',
      instance: ready,
    })
  })

  test('replays the operation retained by a provisioning Instance', () => {
    expect(
      planInstanceCreate(
        [{ ...ready, state: 'provisioning', operationId: 'retained-operation' }],
        'demo',
        'new-operation',
      ),
    ).toEqual({ kind: 'create', operationId: 'retained-operation' })
  })

  test('uses the caller operation only when no durable Instance exists', () => {
    expect(planInstanceCreate([], 'demo', 'new-operation')).toEqual({
      kind: 'create',
      operationId: 'new-operation',
    })
  })

  test('reports old receipts and terminal Instances without inventing recovery', () => {
    expect(() => planInstanceCreate([{ ...ready, state: 'provisioning' }], 'demo')).toThrow(
      'has no operation id',
    )
    expect(() => planInstanceCreate([{ ...ready, state: 'failed' }], 'demo')).toThrow('is failed')
  })
})
