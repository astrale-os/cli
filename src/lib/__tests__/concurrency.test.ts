import { expect, test } from 'bun:test'

import { mapBounded } from '../concurrency'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('mapBounded keeps input order, every item once, and never exceeds its bound', async () => {
  let inFlight = 0
  let peak = 0
  const out = await mapBounded([30, 10, 20, 0, 5, 15], 3, async (ms, index) => {
    peak = Math.max(peak, ++inFlight)
    await tick(ms)
    inFlight--
    return index
  })
  expect(out).toEqual([0, 1, 2, 3, 4, 5])
  expect(peak).toBe(3)
})

test('mapBounded handles empty input, clamps a bound below 1, and propagates a rejection', async () => {
  expect(await mapBounded([], 4, async () => expect.unreachable())).toEqual([])
  expect(await mapBounded([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6])
  await expect(
    mapBounded([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    }),
  ).rejects.toThrow('boom')
})
