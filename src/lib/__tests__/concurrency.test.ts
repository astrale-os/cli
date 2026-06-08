import { describe, expect, test } from 'bun:test'

import { mapBounded } from '../concurrency'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mapBounded', () => {
  test('preserves input order regardless of completion order', async () => {
    const out = await mapBounded([30, 10, 20, 0], 4, async (ms, i) => {
      await tick(ms)
      return i
    })
    expect(out).toEqual([0, 1, 2, 3])
  })

  test('never exceeds the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    await mapBounded(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await tick(5)
        inFlight--
      },
    )
    expect(peak).toBeLessThanOrEqual(3)
  })

  test('processes every item exactly once', async () => {
    const seen: number[] = []
    await mapBounded([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  test('empty input → empty output, fn never called', async () => {
    let called = false
    const out = await mapBounded([], 4, async () => {
      called = true
    })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })

  test('limit below 1 is clamped (still makes progress)', async () => {
    const out = await mapBounded([1, 2, 3], 0, async (n) => n * 2)
    expect(out).toEqual([2, 4, 6])
  })

  test('a rejection propagates', async () => {
    await expect(
      mapBounded([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})
