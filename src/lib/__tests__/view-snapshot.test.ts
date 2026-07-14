import { describe, expect, test } from 'bun:test'

import type { AbResult } from '../browser'

import { snapshotText, waitForSettledSnapshot } from '../view/snapshot'

const pending = result('- paragraph\n  - StaticText "Opening integrations…"')
const settled = result('- heading "Integrations" [level=1]\n- button "Connect Google" [ref=e4]')

function result(snapshot: string): AbResult {
  return { ok: true, data: { snapshot }, error: null }
}

function clock() {
  let elapsed = 0
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms
    },
    elapsed: () => elapsed,
  }
}

describe('view snapshot settling', () => {
  test('waits through a late loading-to-content transition and a quiet window', async () => {
    const fakeClock = clock()
    let calls = 0
    const takeSnapshot = async () => {
      calls += 1
      return fakeClock.elapsed() < 1_250 ? pending : settled
    }

    const snapshot = await waitForSettledSnapshot(takeSnapshot, fakeClock, {
      timeoutMs: 4_000,
      quietWindowMs: 750,
      pollMs: 250,
    })

    expect(snapshotText(snapshot)).toContain('Connect Google')
    expect(fakeClock.elapsed()).toBe(2_000)
    expect(calls).toBe(10)
  })

  test('returns the latest permanently pending snapshot at the bound', async () => {
    const fakeClock = clock()
    let calls = 0
    const takeSnapshot = async () => {
      calls += 1
      return pending
    }

    const snapshot = await waitForSettledSnapshot(takeSnapshot, fakeClock, {
      timeoutMs: 1_000,
      quietWindowMs: 500,
      pollMs: 250,
    })

    expect(snapshot).toBe(pending)
    expect(fakeClock.elapsed()).toBe(1_000)
    expect(calls).toBe(6)
  })

  test('ignores changing agent-browser refs when measuring stability', async () => {
    const fakeClock = clock()
    let ref = 0

    const snapshot = await waitForSettledSnapshot(
      async () => result(`- button "Deploy" [ref=e${++ref}]`),
      fakeClock,
      { timeoutMs: 2_000, quietWindowMs: 500, pollMs: 250 },
    )

    expect(snapshotText(snapshot)).toContain('Deploy')
    expect(fakeClock.elapsed()).toBe(500)
  })
})
