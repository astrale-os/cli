import { describe, expect, it, vi } from 'bun:test'

import type { InvitationInfo } from '../model'

import { waitForInvitation } from '../invitation'

const pending: InvitationInfo = Object.freeze({
  id: '@invitation',
  email: 'invited@example.com',
  state: 'pending',
  access: 'member',
  instance: '@instance',
  createdAt: '2026-08-28T10:00:00.000Z',
})

describe('Instance invitation wait', () => {
  it('reconciles until accepted and returns the admitted claimant', async () => {
    let now = 0
    const reconcile = vi.fn(async () =>
      Object.freeze({
        ...pending,
        state: reconcile.mock.calls.length < 2 ? ('pending' as const) : ('accepted' as const),
        claimedBy: '@user',
      }),
    )

    await expect(
      waitForInvitation(pending, reconcile, {
        timeoutMs: 10_000,
        pollIntervalMs: 1_000,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds
        },
      }),
    ).resolves.toMatchObject({ state: 'accepted', claimedBy: '@user' })
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('times out with an exact resumable CLI command', async () => {
    let now = 0
    await expect(
      waitForInvitation(pending, async () => pending, {
        timeoutMs: 2_000,
        pollIntervalMs: 1_000,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVITATION_ACCEPTANCE_TIMEOUT',
      hint: 'Resume safely with `astrale instance invitation reconcile @invitation`.',
    })
  })

  it('does not retry a terminal revoked invitation', async () => {
    const reconcile = vi.fn(async () => pending)
    await expect(
      waitForInvitation({ ...pending, state: 'revoked' }, reconcile, { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_ACCEPTED' })
    expect(reconcile).not.toHaveBeenCalled()
  })
})
