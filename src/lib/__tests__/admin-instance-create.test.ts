import { expect, test } from 'bun:test'

import { planInstanceCreate } from '../admin-instance'

const ready = {
  id: '@ready',
  slug: 'demo',
  url: 'https://demo.example.test/api',
  state: 'ready' as const,
  operationId: 'retained-operation',
}

test('a create resumes the visible receipt of its slug, never a new operation', () => {
  // Visibility is not owner access: a ready, provisioning or failed Instance replays its receipt.
  for (const state of ['ready', 'provisioning', 'failed'] as const) {
    expect(planInstanceCreate([{ ...ready, state }], 'demo')).toEqual({
      operationId: 'retained-operation',
    })
    expect(() => planInstanceCreate([{ ...ready, state, operationId: undefined }], 'demo')).toThrow(
      'has no retained creation operation id',
    )
  }
  expect(planInstanceCreate([], 'demo', 'new-operation')).toEqual({ operationId: 'new-operation' })
  expect(() => planInstanceCreate([ready], 'demo', 'other-operation')).toThrow(
    'another creation operation',
  )
  expect(() => planInstanceCreate([{ ...ready, state: 'deleting' }], 'demo')).toThrow('is deleting')
  expect(() =>
    planInstanceCreate([ready, { ...ready, id: '@another', operationId: 'other' }], 'demo'),
  ).toThrow('More than one visible Admin Instance')
})
