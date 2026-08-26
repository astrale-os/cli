import type { ClientSession } from '@astrale-os/sdk/client/session'

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

export interface AdminInstanceContext {
  readonly session: ClientSession
}

export interface AdminInstanceApi {
  list(): Promise<OwnedInstanceInfo[]>
  create(slug: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt>
}

export class AdminInstanceNotFoundError extends Error {
  constructor(identifier: string)
  readonly name: 'NotFoundError'
  readonly identifier: string
}

export interface AdminInstanceDependencies {
  readonly operationId?: (kind: 'create' | 'status' | 'delete' | 'install-domain') => string
}

export function connectAdminInstances(
  context: AdminInstanceContext,
  dependencies?: AdminInstanceDependencies,
): Promise<AdminInstanceApi>
export function findOwnedInstance(
  instances: readonly OwnedInstanceInfo[],
  identifier: string,
): OwnedInstanceInfo | undefined
export function formatInstanceState(info: InstanceInfo): string
