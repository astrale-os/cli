import type { AdminConnectionOptions, ConnectionContext } from '../connection'

import { connectAdminInstances } from '../admin/instance'
import { withAdminClientSession } from '../connection'

export {
  AdminInstanceNotFoundError,
  findOwnedInstance,
  formatInstanceLocation,
  type InstanceInfo,
  type InstanceState,
  type OwnedInstanceInfo,
} from '../admin/instance'

/** Resolve the Admin target and read only the caller-visible Instance inventory. */
export function listOwnedInstances(options: AdminConnectionOptions) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).list(),
  )
}

/** Reuse an already-open Admin session for a caller-visible Instance inventory. */
export async function listOwnedInstancesInContext(context: ConnectionContext) {
  return (await connectAdminInstances(context)).list()
}

/** Provision through Fleet placement or one explicitly resolved Host receiver. */
export function createOwnedInstance(
  options: AdminConnectionOptions,
  slug: string,
  hostId?: string,
) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminInstances(context)).create(slug, hostId),
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
