import type { ClientSession } from '@astrale-os/sdk/client/session'

import type { AdminGraphApi } from '../../graph/.spec/api.js'

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

export interface AdminCatalogContext {
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

/** Admin refused `Fleet.publishDomain` with its declared `CATALOG_ORIGIN_CONFLICT`. */
export class AdminCatalogOriginConflictError extends Error {
  constructor(
    origin: string,
    reason: 'not-in-fleet' | 'in-another-fleet' | undefined,
    listed: boolean,
    options?: ErrorOptions,
  )
  readonly code: 'CATALOG_ORIGIN_CONFLICT'
  readonly origin: string
  readonly reason: 'not-in-fleet' | 'in-another-fleet' | undefined
}

export interface AdminCatalogDependencies {
  readonly operationId?: (kind: 'publish' | 'configure-default') => string
}

export function connectAdminCatalog(
  context: AdminCatalogContext,
  dependencies?: AdminCatalogDependencies,
): Promise<AdminCatalogApi>
