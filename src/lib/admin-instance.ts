/**
 * The admin `Instance` surface used by `astrale instance
 * list/status/create/delete`. The merged admin domain models instances as the
 * `Instance` class (provisioned via `Instance.init`); these commands target it.
 */
export const ADMIN_INSTANCE = '/:admin.astrale.ai:class.Instance'

export function adminInstanceMethod(method: 'alphaCreate' | 'delete' | 'info' | 'list'): string {
  return `${ADMIN_INSTANCE}:${method}`
}

/** Read shape returned by `Instance.list` / `info` / `delete` (domain `InstanceInfoSchema`). */
export type InstanceInfo = {
  id: string
  slug: string
  url: string
  hostId?: string
  region?: string
  state?: 'provisioning' | 'ready' | 'failed'
  phase?: string
  error?: string | null
  createdAt?: string
}

/** Human-readable location of a managed instance ("region · hostId"). */
export function formatInstanceLocation(info: InstanceInfo): string {
  return [info.state && info.state !== 'ready' ? info.state : undefined, info.region, info.hostId]
    .filter(Boolean)
    .join(' · ')
}
