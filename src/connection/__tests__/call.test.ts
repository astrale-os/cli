import { describe, expect, test } from 'bun:test'

import { createPathCall } from '../call'

describe('createPathCall', () => {
  /** @evidence TEST-CLI-CONNECTION-CREATES-ONE-CANONICAL-CALL */
  test('creates one path Call without legacy routing hints', () => {
    expect(
      JSON.parse(
        JSON.stringify(createPathCall('/:kernel.astrale.ai:function.query', { value: 1 })),
      ),
    ).toEqual({
      target: '/:kernel.astrale.ai:function.query',
      input: { value: 1 },
    })
  })
})
