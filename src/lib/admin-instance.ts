/**
 * The admin control-plane `Instance` surface used by `astrale instance
 * list/status/create/delete`. The merged admin domain models instances as the
 * `Instance` class (provisioned via `Instance.init`); these commands target it.
 */
export const ADMIN_INSTANCE = '/admin.astrale.ai/class.Instance'

/** Read shape returned by `Instance.list` / `info` / `delete` (domain `InstanceInfoSchema`). */
export type InstanceInfo = {
  id: string
  slug: string
  url: string
  hostId?: string
  region?: string
  createdAt?: string
}

/** Human-readable location of a managed instance ("region · hostId"). */
export function formatInstanceLocation(info: InstanceInfo): string {
  return [info.region, info.hostId].filter(Boolean).join(' · ')
}
