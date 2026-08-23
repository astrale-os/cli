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

export class AdminDomainNotFoundError extends AstraleError {
  constructor(readonly identifier: string) {
    super('DOMAIN_NOT_FOUND', `No visible Admin Domain matches ${JSON.stringify(identifier)}.`)
  }
}
import { AstraleError } from '../../errors'
