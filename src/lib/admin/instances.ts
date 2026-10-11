import type {
  AdminInstanceApi,
  OwnedInstanceInfo,
  RootIdentityRecipient,
} from '../../admin/instance'
import type { AdminConnectionOptions, ConnectionContext } from '../../connection'

import { connectAdminInstances, AdminInstanceNotFoundError } from '../../admin/instance'
import { resolveAdminFleet } from '../../admin/selection'
import { withAdminClientSession } from '../../connection'
import { AstraleError } from '../../errors'

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

/** Create or resume one managed Instance from its durable Admin receipt. */
export function createOwnedInstance(
  options: AdminConnectionOptions,
  slug: string,
  operationId?: string,
  onFleetSelected?: (fleet: string) => void,
) {
  return withAdminClientSession(options, async (context) => {
    const fleet = (await resolveAdminFleet({ ...context, fleet: options.fleet }, true)).raw
    onFleetSelected?.(fleet)
    const instances = await connectAdminInstances({ ...context, fleet })
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
      existing.operationId === undefined
        ? 'Inspect the Instance in Admin.'
        : `To recover that request, use --operation ${existing.operationId}.`,
    )
  // Admin owns whether a failed journey can resume from retained effects. A failed
  // Instance is not proof that its provisioning Operation is terminal.
  if (
    existing?.state === 'ready' ||
    existing?.state === 'provisioning' ||
    existing?.state === 'failed'
  ) {
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

/** Run `work` on the caller-visible Instances of the selected Admin target. */
function withAdminInstances<Value>(
  options: AdminConnectionOptions,
  work: (instances: AdminInstanceApi, context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  return withAdminClientSession(options, async (context) =>
    work(await connectAdminInstances(context), context),
  )
}

/** Refresh one exact caller-visible Instance through its V2 receiver Method. */
export const statusOwnedInstance = (options: AdminConnectionOptions, identifier: string) =>
  withAdminInstances(options, (instances) => instances.status(identifier))

/** Delete one exact caller-visible Instance through its V2 receiver Method. */
export const deleteOwnedInstance = (options: AdminConnectionOptions, identifier: string) =>
  withAdminInstances(options, (instances) => instances.delete(identifier))

/** Retrieve one owner's root identity, sealed to a caller-generated ephemeral recipient. */
export function retrieveOwnedInstanceRootIdentity(
  options: AdminConnectionOptions,
  identifier: string,
  recipient: RootIdentityRecipient,
) {
  return withAdminInstances(options, async (instances, context) =>
    Object.freeze({
      ...(await instances.retrieveRootIdentity(identifier, recipient)),
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
  return withAdminInstances(options, (instances) =>
    instances.invite(identifier, email, expiresInDays),
  )
}

/** Observe one retained Instance Invitation without reconciling or mutating it. */
export const statusManagedInvitation = (options: AdminConnectionOptions, invitation: string) =>
  withAdminInstances(options, (instances) => instances.statusInvitation(invitation))

/** Reconcile one Invitation sent by the active caller. */
export const reconcileOwnedInvitation = (options: AdminConnectionOptions, invitation: string) =>
  withAdminInstances(options, (instances) => instances.reconcileInvitation(invitation))

/** Resolve a known Instance in its own Admin session, whichever Fleet holds it. */
export function resolveOwnedInstance(options: AdminConnectionOptions, identifier: string) {
  return withAdminInstances(options, async (instances) => {
    try {
      return await instances.require(identifier)
    } catch (cause) {
      if (cause instanceof AdminInstanceNotFoundError) return undefined
      throw cause
    }
  })
}
