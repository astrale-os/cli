/** CLI-stable projection of one caller-visible Admin Instance. */
export type InstanceState = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted'

export interface InstanceInfo {
  readonly id: string
  readonly slug: string
  readonly url: string
  readonly hostId?: string
  readonly region?: string
  readonly state: InstanceState
  readonly phase?: string
  readonly error?: string | null
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly organizationId?: string
}

/** An Instance returned through the caller-scoped Admin graph inventory. */
export interface OwnedInstanceInfo extends InstanceInfo {
  readonly state: InstanceState
}

export interface DomainInstallReceipt {
  readonly domain: string
  readonly instance: string
  readonly origin: string
  readonly ok: boolean
  readonly installedRevision?: string
  readonly error?: string
}

export class AdminInstanceNotFoundError extends AstraleError {
  constructor(readonly identifier: string) {
    super(
      'INSTANCE_NOT_FOUND',
      `No owned Admin Instance matches ${JSON.stringify(identifier)}.`,
      'Run `astrale instance list` to see your instances.',
    )
  }
}

/** Match an owner-scoped Instance by slug, canonical Node Path, or bare Node id. */
export function findOwnedInstance(
  instances: readonly OwnedInstanceInfo[],
  identifier: string,
): OwnedInstanceInfo | undefined {
  return instances.find(
    (instance) =>
      instance.slug === identifier ||
      instance.id === identifier ||
      (instance.id.startsWith('@') && instance.id.slice(1) === identifier),
  )
}

/** Human-readable non-ready lifecycle state for one Instance. */
export function formatInstanceState(info: InstanceInfo): string {
  return info.state === 'ready' ? '' : `${info.state}${info.phase ? ` (${info.phase})` : ''}`
}
import { AstraleError } from '../../errors'
