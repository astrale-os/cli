import type { OwnedInstanceInfo, RootIdentityRecipient } from '../admin/instance'
import type { AdminConnectionOptions, ConnectionContext } from '../connection'

import { connectAdminInstances, AdminInstanceNotFoundError } from '../admin/instance'
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
    (await connectAdminInstances({ ...context, fleet: options.fleet })).list({ includeRetired }),
  )
}

/** Read caller-visible inventory together with the exact local identity used for the Admin call. */
export function listOwnedInstancesWithIdentity(options: AdminConnectionOptions) {
  return withAdminClientSession(options, async (context) =>
    Object.freeze({
      instances: await (await connectAdminInstances({ ...context, fleet: options.fleet })).list(),
      ...(context.identity === undefined ? {} : { identity: context.identity }),
    }),
  )
}

/** Reuse an already-open Admin session for a caller-visible Instance inventory. */
export async function listOwnedInstancesInContext(context: ConnectionContext, fleet?: string) {
  return (await connectAdminInstances({ ...context, fleet: fleet })).list()
}

/** Create or resume one managed Instance from its durable Admin receipt. */
export function createOwnedInstance(
  options: AdminConnectionOptions,
  slug: string,
  operationId?: string,
) {
  return withAdminClientSession(options, async (context) => {
    const instances = await connectAdminInstances({ ...context, fleet: options.fleet })
    const plan = planInstanceCreate(await instances.list(), slug, operationId)
    // Inventory is caller-visible, not proof of creation ownership. Even ready
    // Instances must replay their receipt so Admin verifies its actor and input.
    return instances.create(slug, plan.operationId)
  })
}

type InstanceCreatePlan = Readonly<{ operationId?: string }>

/** @internal Resolve creation from durable caller-visible Admin state. */
export function planInstanceCreate(
  inventory: readonly OwnedInstanceInfo[],
  slug: string,
  operationId?: string,
): InstanceCreatePlan {
  const candidates = inventory.filter((instance) => instance.slug === slug)
  if (candidates.length > 1) {
    throw new AstraleError(
      'INSTANCE_RECOVERY_AMBIGUOUS',
      `More than one visible Admin Instance matches slug ${JSON.stringify(slug)}.`,
      'Inspect their creation receipts before retrying; no operation was selected.',
    )
  }
  const existing = candidates[0]
  if (existing !== undefined && operationId !== undefined && existing.operationId !== operationId)
    throw new AstraleError(
      'INSTANCE_OPERATION_CONFLICT',
      'This slug belongs to another creation operation.',
      existing.operationId === undefined ? 'Inspect the Instance in Admin.' : `To recover that request, use --operation ${existing.operationId}.`,
    )
  if (existing?.state === 'ready' || existing?.state === 'provisioning') {
    if (existing.operationId === undefined) {
      throw new AstraleError(
        'INSTANCE_RECOVERY_UNAVAILABLE',
        `Instance ${JSON.stringify(slug)} has no retained creation operation id.`,
        'Inspect its Admin creation receipt before retrying; no new instance was requested.',
      )
    }
    return Object.freeze({ operationId: existing.operationId })
  }
  if (existing !== undefined) {
    throw new AstraleError(
      'INSTANCE_NOT_CREATABLE',
      `Instance ${JSON.stringify(slug)} is ${existing.state}.`,
      'Run `astrale instance list` to inspect it.',
    )
  }
  return Object.freeze(operationId === undefined ? {} : { operationId })
}

/** Refresh one exact caller-visible Instance through its V2 receiver Method. */
export function statusOwnedInstance(options: AdminConnectionOptions, identifier: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances({ ...context, fleet: options.fleet })).status(identifier),
  )
}

/** Delete one exact caller-visible Instance through its V2 receiver Method. */
export function deleteOwnedInstance(options: AdminConnectionOptions, identifier: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances({ ...context, fleet: options.fleet })).delete(identifier),
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
      ...(await (
        await connectAdminInstances({ ...context, fleet: options.fleet })
      ).retrieveRootIdentity(identifier, recipient)),
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
    (await connectAdminInstances({ ...context, fleet: options.fleet })).invite(
      identifier,
      email,
      expiresInDays,
    ),
  )
}

/** Observe one retained Instance Invitation without reconciling or mutating it. */
export function statusManagedInvitation(options: AdminConnectionOptions, invitation: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances({ ...context, fleet: options.fleet })).statusInvitation(
      invitation,
    ),
  )
}

/** Reconcile one Invitation sent by the active caller. */
export function reconcileOwnedInvitation(options: AdminConnectionOptions, invitation: string) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances({ ...context, fleet: options.fleet })).reconcileInvitation(
      invitation,
    ),
  )
}

/** Resolve a known Instance independently of default placement. */
export async function resolveOwnedInstanceInContext(
  context: ConnectionContext,
  identifier: string,
  fleet?: string,
) {
  try {
    return await (await connectAdminInstances({ ...context, fleet })).require(identifier)
  } catch (cause) {
    if (cause instanceof AdminInstanceNotFoundError) return undefined
    throw cause
  }
}
