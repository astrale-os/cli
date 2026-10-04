import type { ClientSession } from '@astrale-os/sdk/client/session'
/** @deprecated The Admin Fleet catalog; successor: the Domain version registry. */
import type { Path } from '@astrale-os/sdk/graph/path'

import type { AdminGraphApi } from '../../../graph/.spec/api.js'
import type { AdminInstanceContext } from '../../../instance/.spec/api.js'

export interface DomainInfo {
  readonly id: string
  readonly origin: string
  readonly name: string
  readonly url?: string
  readonly description?: string
  readonly installByDefault?: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PublishDomainInput {
  readonly origin: string
  readonly name: string
  readonly url: string
  readonly description?: string
  readonly installByDefault?: boolean
}

export interface PublishDomainResult {
  readonly entry: DomainInfo
  readonly changed: boolean
  readonly isNew: boolean
}

export interface InstallDomainResult {
  readonly name: string
  readonly origin: string
  readonly instanceId: string
  readonly url: string
  readonly ok: boolean
  readonly error?: string | null
}

export interface DomainInstallReceipt {
  readonly domain: string
  readonly instance: string
  readonly origin: string
  readonly ok: boolean
  readonly installedRevision?: string
  readonly error?: string
}

export interface AdminCatalogContext {
  readonly fleet?: string
  readonly session: ClientSession
  readonly graph: AdminGraphApi
}

export interface AdminCatalogApi {
  list(): Promise<DomainInfo[]>
  require(identifier: string): Promise<DomainInfo>
  publish(input: PublishDomainInput): Promise<PublishDomainResult>
}

export class AdminDomainNotFoundError extends Error {
  constructor(identifier: string)
  readonly name: 'NotFoundError'
  readonly identifier: string
}

export interface AdminCatalogDependencies {
  readonly operationId?: (kind: 'publish' | 'configure-default') => string
}

export function connectAdminCatalog(
  context: AdminCatalogContext,
  dependencies?: AdminCatalogDependencies,
): Promise<AdminCatalogApi>

export interface CatalogInstallDependencies {
  readonly operationId?: () => string
}

/** Resolve the caller-visible Instance, then invoke its `installDomain` receiver. */
export function installCatalogDomain(
  context: AdminInstanceContext,
  instance: string,
  domain: string,
  dependencies?: CatalogInstallDependencies,
): Promise<DomainInstallReceipt>

/** The one Fleet that contains a resource, whose catalog a bare-origin install reads. */
export function resourceFleet(context: AdminInstanceContext, resource: string): Promise<Path>
