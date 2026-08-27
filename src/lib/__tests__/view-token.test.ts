import { describe, expect, mock, test } from 'bun:test'

import { createViewTokenBroker, type ViewToken } from '../../../viewer/token'

const token = (value: string, expiresAt: number): ViewToken => ({
  token: value,
  expiresAt,
  kind: 'minted',
})

describe('View token broker', () => {
  test('reuses a healthy credential and refreshes it before source-session expiry', async () => {
    let now = 100_000
    const load = mock(async () => token('fresh', 500_000))
    const broker = createViewTokenBroker(token('initial', 200_001), load, () => now)

    await expect(broker.resolve()).resolves.toEqual({ credential: 'initial' })
    expect(load).not.toHaveBeenCalled()

    now = 140_001
    await expect(broker.resolve()).resolves.toEqual({ credential: 'fresh' })
    expect(load).toHaveBeenCalledTimes(1)
    expect(broker.current()).toEqual(token('fresh', 500_000))
  })

  test('shares one refresh between Shell resolution and iframe handshake', async () => {
    let release: ((value: ViewToken) => void) | undefined
    const load = mock(
      () =>
        new Promise<ViewToken>((resolve) => {
          release = resolve
        }),
    )
    const broker = createViewTokenBroker(token('expired', 1), load, () => 100_000)

    const resolved = broker.resolve()
    const refreshed = broker.refresh()
    expect(load).toHaveBeenCalledTimes(1)
    release?.(token('shared', 500_000))

    await expect(resolved).resolves.toEqual({ credential: 'shared' })
    await expect(refreshed).resolves.toEqual({ token: 'shared', expiresAt: 500_000 })
  })
})
