import type { DomainBinding } from '@astrale-os/kernel-client/domain'
import type { ClientSession } from '@astrale-os/kernel-client/session'

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

export interface AdminCatalogDependencies {
  readonly bind?: (session: ClientSession) => Promise<DomainBinding>
  readonly operationId?: (kind: 'publish' | 'configure-default') => string
}

export function connectAdminCatalog(
  context: AdminCatalogContext,
  dependencies?: AdminCatalogDependencies,
): Promise<AdminCatalogApi>
