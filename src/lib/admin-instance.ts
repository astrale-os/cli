import type { InstanceInfo, OwnedInstanceInfo, RootIdentityRecipient } from '../admin/instance'
import type { AdminConnectionOptions, ConnectionContext } from '../connection'

import { connectAdminInstances, findOwnedInstance } from '../admin/instance'
import { withAdminClientSession } from '../connection'
import { AstraleError } from '../errors'

export {
  AdminInstanceNotFoundError,
  findOwnedInstance,
  formatInstanceState,
  type InstanceInfo,
  type InstanceState,
  type InvitationInfo,
  type InvitationState,
  type OwnedInstanceInfo,
  type RetrievedRootIdentity,
  type RootIdentityRecipient,
  type RootIdentityTransfer,
} from '../admin/instance'

/** Resolve the Admin target and read only the caller-visible Instance inventory. */
export function listOwnedInstances(options: AdminConnectionOptions, includeRetired = false) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).list({ includeRetired }),
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

/** Create or resume one managed Instance from its durable Admin receipt. */
export function createOwnedInstance(
  options: AdminConnectionOptions,
  slug: string,
  operationId?: string,
) {
  return withAdminClientSession(options, async (context) => {
    const instances = await connectAdminInstances(context)
    const plan = planInstanceCreate(await instances.list(), slug, operationId)
    return plan.kind === 'ready' ? plan.instance : instances.create(slug, plan.operationId)
  })
}

type InstanceCreatePlan =
  | Readonly<{ kind: 'ready'; instance: InstanceInfo }>
  | Readonly<{ kind: 'create'; operationId?: string }>

/** @internal Resolve creation from durable caller-visible Admin state. */
export function planInstanceCreate(
  inventory: readonly OwnedInstanceInfo[],
  slug: string,
  operationId?: string,
): InstanceCreatePlan {
  const existing = findOwnedInstance(inventory, slug)
  if (existing?.state === 'ready') return Object.freeze({ kind: 'ready', instance: existing })
  if (existing?.state === 'provisioning') {
    if (existing.operationId === undefined) {
      throw new AstraleError(
        'INSTANCE_RECOVERY_UNAVAILABLE',
        `Instance ${JSON.stringify(slug)} is provisioning but its Admin receipt has no operation id.`,
        'Upgrade the Admin Domain, then retry the same command.',
      )
    }
    return Object.freeze({ kind: 'create', operationId: existing.operationId })
  }
  if (existing !== undefined) {
    throw new AstraleError(
      'INSTANCE_NOT_CREATABLE',
      `Instance ${JSON.stringify(slug)} is ${existing.state}.`,
      'Run `astrale instance list` to inspect it.',
    )
  }
  return Object.freeze({ kind: 'create', ...(operationId === undefined ? {} : { operationId }) })
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

/** Retrieve one owner's root identity, sealed to a caller-generated ephemeral recipient. */
export function retrieveOwnedInstanceRootIdentity(
  options: AdminConnectionOptions,
  identifier: string,
  recipient: RootIdentityRecipient,
) {
  return withAdminClientSession(options, async (context) =>
    Object.freeze({
      ...(await (await connectAdminInstances(context)).retrieveRootIdentity(identifier, recipient)),
      ...(context.identity === undefined ? {} : { ownerIdentity: context.identity }),
    }),
  )
}

/** Invite one external member to an exact caller-managed Instance. */
export function inviteOwnedInstance(
  options: AdminConnectionOptions,
  identifier: string,
  email: string,
  expiresInDays?: number,
) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).invite(identifier, email, expiresInDays),
  )
}

/** Observe one retained Instance Invitation without reconciling or mutating it. */
export function statusManagedInvitation(options: AdminConnectionOptions, invitation: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).statusInvitation(invitation),
  )
}

/** Reconcile one Invitation sent by the active caller. */
export function reconcileOwnedInvitation(options: AdminConnectionOptions, invitation: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).reconcileInvitation(invitation),
  )
}
