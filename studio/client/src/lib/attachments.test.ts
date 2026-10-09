import { expect, test } from 'bun:test'

import { fitWithin } from './attachments'

test('a re-encoded image keeps its shape inside the longest edge', () => {
  expect(fitWithin(4096, 2048)).toEqual({ width: 2048, height: 1024 })
  expect(fitWithin(1000, 6000)).toEqual({ width: 341, height: 2048 })
  // never scaled UP: a small image is only re-encoded
  expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 })
})
