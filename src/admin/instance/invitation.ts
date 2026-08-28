import type { InvitationInfo } from './model'

import { AstraleError } from '../../errors'

export interface InvitationWaitOptions {
  readonly timeoutMs: number
  readonly pollIntervalMs?: number
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

/** Poll explicit Invitation reconciliation until the invited user can use the Instance. */
export async function waitForInvitation(
  initial: InvitationInfo,
  reconcile: () => Promise<InvitationInfo>,
  options: InvitationWaitOptions,
): Promise<InvitationInfo> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? delay
  const pollIntervalMs = options.pollIntervalMs ?? 3_000
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new TypeError('Invitation wait timeout must be a positive integer.')
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new TypeError('Invitation poll interval must be a positive integer.')
  }

  const deadline = now() + options.timeoutMs
  let invitation = initial
  while (invitation.state === 'pending') {
    const remaining = deadline - now()
    if (remaining <= 0) {
      throw new AstraleError(
        'INVITATION_ACCEPTANCE_TIMEOUT',
        `Invitation ${invitation.id} was not accepted before the wait timeout.`,
        `Resume safely with \`astrale instance invitation reconcile ${invitation.id}\`.`,
      )
    }
    await sleep(Math.min(pollIntervalMs, remaining))
    invitation = await reconcile()
  }
  if (invitation.state !== 'accepted') {
    throw new AstraleError(
      'INVITATION_NOT_ACCEPTED',
      `Invitation ${invitation.id} is ${invitation.state}.`,
      'Send a new invitation if this user should still join the Instance.',
    )
  }
  return invitation
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
