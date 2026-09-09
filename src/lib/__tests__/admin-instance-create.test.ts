import { describe, expect, test } from 'bun:test'

import { planInstanceCreate } from '../admin-instance'

const ready = {
  id: '@ready',
  slug: 'demo',
  url: 'https://demo.example.test/api',
  state: 'ready' as const,
  operationId: 'retained-operation',
}

describe('Admin Instance create recovery', () => {
  test('refuses a receipt from another creation operation', () => {
    expect(() => planInstanceCreate([ready], 'demo', 'other-operation')).toThrow('another creation operation')
  })
  test('replays a ready Instance receipt instead of treating visibility as owner access', () => {
    expect(planInstanceCreate([ready], 'demo', 'retained-operation')).toEqual({
      operationId: ready.operationId,
    })
  })

  test('replays the operation retained by a provisioning Instance', () => {
    expect(
      planInstanceCreate(
        [{ ...ready, state: 'provisioning', operationId: 'retained-operation' }],
        'demo',
        'retained-operation',
      ),
    ).toEqual({ operationId: 'retained-operation' })
  })

  test('uses the caller operation only when no durable Instance exists', () => {
    expect(planInstanceCreate([], 'demo', 'new-operation')).toEqual({
      operationId: 'new-operation',
    })
  })

  test('refuses missing receipts and terminal Instances without creating a replacement', () => {
    for (const state of ['ready', 'provisioning'] as const) {
      expect(() =>
        planInstanceCreate([{ ...ready, state, operationId: undefined }], 'demo'),
      ).toThrow('has no retained creation operation id')
    }
    expect(() => planInstanceCreate([{ ...ready, state: 'failed' }], 'demo')).toThrow('is failed')
  })

  test('does not arbitrarily select a receipt when several visible Instances share the slug', () => {
    expect(() =>
      planInstanceCreate(
        [ready, { ...ready, id: '@another', operationId: 'other-operation' }],
        'demo',
      ),
    ).toThrow('More than one visible Admin Instance')
  })
})
