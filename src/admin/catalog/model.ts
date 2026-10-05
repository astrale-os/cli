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

/**
 * Admin refused to catalogue an origin in the selected Fleet (`CATALOG_ORIGIN_CONFLICT`): only the
 * core Fleet catalogues a new origin, and a Fleet changes only the Domains it contains.
 */
export class AdminCatalogOriginConflictError extends AstraleError {
  constructor(
    readonly origin: string,
    readonly reason: 'not-in-fleet' | 'in-another-fleet' | undefined,
    listed: boolean,
    options?: ErrorOptions,
  ) {
    super(
      'CATALOG_ORIGIN_CONFLICT',
      reason === 'in-another-fleet'
        ? `Admin refused to catalogue ${origin}: another Fleet already holds its Domain, and Admin keeps one Domain per origin.`
        : listed
          ? `This Fleet lists ${origin} from another Fleet's catalog; only that Fleet changes its name, URL or description.`
          : `Admin refused to catalogue ${origin} in this Fleet: only the core Fleet catalogues a new origin.`,
      reason === 'in-another-fleet'
        ? "Align or remove the other Fleet's Domain of this origin, then rerun."
        : listed
          ? 'Rerun with its current --name and --public-url to change only --install-by-default.'
          : 'Ask an Astrale operator to publish it in the core Fleet, or install it without the catalog: astrale domain install <url> --direct -i <instance>',
      options,
    )
  }
}
