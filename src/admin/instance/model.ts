/** CLI-stable projection of one caller-visible Admin Instance. */
export type InstanceState = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted'

export interface InstanceInfo {
  readonly id: string
  readonly slug: string
  readonly url: string
  readonly hostId?: string
  readonly region?: string
  readonly state?: InstanceState
  readonly phase?: string
  readonly error?: string | null
  readonly createdAt?: string
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

export class AdminInstanceNotFoundError extends Error {
  readonly name = 'NotFoundError'

  constructor(readonly identifier: string) {
    super(`No owned Admin Instance matches ${JSON.stringify(identifier)}.`)
  }
}

export class AdminHostNotFoundError extends Error {
  readonly name = 'NotFoundError'

  constructor(readonly identifier: string) {
    super(`No caller-usable Admin Host matches ${JSON.stringify(identifier)}.`)
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

/** Human-readable location of an Instance (state, region, and Host Path). */
export function formatInstanceLocation(info: InstanceInfo): string {
  return [info.state && info.state !== 'ready' ? info.state : undefined, info.region, info.hostId]
    .filter(Boolean)
    .join(' · ')
}
