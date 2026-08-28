import type { AdminConnectionOptions, ConnectionContext } from '../connection'

import { connectAdminInstances, waitForInvitation } from '../admin/instance'
import { withAdminClientSession } from '../connection'

export {
  AdminInstanceNotFoundError,
  findOwnedInstance,
  formatInstanceState,
  type InstanceInfo,
  type InstanceState,
  type InvitationInfo,
  type InvitationState,
  type OwnedInstanceInfo,
} from '../admin/instance'

/** Resolve the Admin target and read only the caller-visible Instance inventory. */
export function listOwnedInstances(options: AdminConnectionOptions) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).list(),
  )
}

/** Read caller-visible inventory together with the exact local identity used for the Admin call. */
export function listOwnedInstancesWithIdentity(options: AdminConnectionOptions) {
  return withAdminClientSession(options, async (context) =>
    Object.freeze({
      instances: await (await connectAdminInstances(context)).list(),
      ...(context.identity === undefined ? {} : { identity: context.identity }),
    }),
  )
}

/** Reuse an already-open Admin session for a caller-visible Instance inventory. */
export async function listOwnedInstancesInContext(context: ConnectionContext) {
  return (await connectAdminInstances(context)).list()
}

/** Request one managed Instance; Admin owns infrastructure placement. */
export function createOwnedInstance(options: AdminConnectionOptions, slug: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).create(slug),
  )
}

/** Refresh one exact caller-visible Instance through its V2 receiver Method. */
export function statusOwnedInstance(options: AdminConnectionOptions, identifier: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).status(identifier),
  )
}

/** Delete one exact caller-visible Instance through its V2 receiver Method. */
export function deleteOwnedInstance(options: AdminConnectionOptions, identifier: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).delete(identifier),
  )
}

/** Invite one external member to an exact caller-managed Instance. */
export function inviteOwnedInstance(
  options: AdminConnectionOptions,
  identifier: string,
  email: string,
  invitation: Readonly<{ expiresInDays?: number; waitTimeoutMs?: number }> = {},
) {
  return withAdminClientSession(options, async (context) => {
    const api = await connectAdminInstances(context)
    const created = await api.invite(identifier, email, invitation.expiresInDays)
    return invitation.waitTimeoutMs === undefined
      ? created
      : waitForInvitation(created, () => api.reconcileInvitation(created.id), {
          timeoutMs: invitation.waitTimeoutMs,
        })
  })
}

/** Reconcile one Invitation sent by the active caller. */
export function reconcileOwnedInvitation(
  options: AdminConnectionOptions,
  invitation: string,
  waitTimeoutMs?: number,
) {
  return withAdminClientSession(options, async (context) => {
    const api = await connectAdminInstances(context)
    const current = await api.reconcileInvitation(invitation)
    return waitTimeoutMs === undefined
      ? current
      : waitForInvitation(current, () => api.reconcileInvitation(current.id), {
          timeoutMs: waitTimeoutMs,
        })
  })
}
