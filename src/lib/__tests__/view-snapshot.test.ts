import { describe, expect, test } from 'bun:test'

import type { AbResult } from '../browser/agent-browser'

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
  /** Settle the page `at(elapsed)` shows over a fake clock. */
  async function settle(
    at: (elapsed: number) => AbResult,
    timeoutMs: number,
    quietWindowMs: number,
  ) {
    const fakeClock = clock()
    const snapshot = await waitForSettledSnapshot(async () => at(fakeClock.elapsed()), fakeClock, {
      timeoutMs,
      quietWindowMs,
      pollMs: 250,
    })
    return { snapshot, elapsed: fakeClock.elapsed() }
  }

  test('waits through a late loading-to-content transition and a quiet window, within its bound', async () => {
    const late = await settle((elapsed) => (elapsed < 1_250 ? pending : settled), 4_000, 750)
    expect(snapshotText(late.snapshot)).toContain('Connect Google')
    expect(late.elapsed).toBe(2_000)

    // A permanently pending page returns its latest snapshot at the bound.
    expect(await settle(() => pending, 1_000, 500)).toEqual({ snapshot: pending, elapsed: 1_000 })
  })

  test('ignores changing agent-browser refs when measuring stability', async () => {
    let ref = 0
    const stable = await settle(() => result(`- button "Deploy" [ref=e${++ref}]`), 2_000, 500)
    expect(snapshotText(stable.snapshot)).toContain('Deploy')
    expect(stable.elapsed).toBe(500)
  })
})
