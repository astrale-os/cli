/**
 * Projections of the Admin Fleet catalog.
 *
 * @deprecated Successor: the registry models of `../../registry/model.ts`. Short-term consumers and
 * removal: see `./client.ts`.
 */
/** CLI-stable projection of one Admin Domain catalog record. */
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

/** The outcome `Instance.installDomain` reports for one catalog Domain. */
export interface DomainInstallReceipt {
  readonly domain: string
  readonly instance: string
  readonly origin: string
  readonly ok: boolean
  readonly installedRevision?: string
  readonly error?: string
}

export class AdminDomainNotFoundError extends AstraleError {
  constructor(readonly identifier: string) {
    super('DOMAIN_NOT_FOUND', `No visible Admin Domain matches ${JSON.stringify(identifier)}.`)
  }
}
import { AstraleError } from '../../../errors'
