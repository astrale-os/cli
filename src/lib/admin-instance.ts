/**
 * The admin `Instance` surface used by `astrale instance
 * list/status/create/delete`. The merged admin domain models instances as the
 * `Instance` class (provisioned via `Instance.init`); these commands target it.
 */
import type { HostSession } from '@astrale-os/kernel-client/host'

import { pathCall } from '@astrale-os/kernel-client'
import { Path } from '@astrale-os/kernel-core/path'

import type { AdminConnectionOptions } from '../connection'

import { withAdminHostSession } from '../connection'

export const ADMIN_INSTANCE = '/:admin.astrale.ai:class.Instance'

export function adminInstanceMethod(
  method: 'alphaCreate' | 'delete' | 'info' | 'list' | 'listMine',
): string {
  return `${ADMIN_INSTANCE}:${method}`
}

export type InstanceState = 'provisioning' | 'ready' | 'failed'

/** Read shape returned by `Instance.list` / `info` / `delete` (domain `InstanceInfoSchema`). */
export type InstanceInfo = {
  id: string
  slug: string
  url: string
  hostId?: string
  region?: string
  state?: InstanceState
  phase?: string
  error?: string | null
  createdAt?: string
  organizationId?: string
}

/** Owner-scoped read shape returned by `Instance.listMine`. */
export type OwnedInstanceInfo = InstanceInfo & {
  state: InstanceState
}

/** Call the owner-scoped list contract through the public Host Call boundary. */
export async function callOwnedInstances(
  host: Pick<HostSession, 'call'>,
): Promise<OwnedInstanceInfo[]> {
  return (await host.call(
    pathCall(Path.parse(adminInstanceMethod('listMine')), {}),
  )) as OwnedInstanceInfo[]
}

/** Resolve the Admin target and read only the caller-owned instance inventory. */
export function listOwnedInstances(options: AdminConnectionOptions): Promise<OwnedInstanceInfo[]> {
  return withAdminHostSession(options, ({ host }) => callOwnedInstances(host))
}

/** Match an owner-scoped instance by its stable node id or human slug. */
export function findOwnedInstance(
  instances: readonly OwnedInstanceInfo[],
  identifier: string,
): OwnedInstanceInfo | undefined {
  return instances.find((instance) => instance.id === identifier || instance.slug === identifier)
}

/** Human-readable location of a managed instance ("region · hostId"). */
export function formatInstanceLocation(info: InstanceInfo): string {
  return [info.state && info.state !== 'ready' ? info.state : undefined, info.region, info.hostId]
    .filter(Boolean)
    .join(' · ')
}
