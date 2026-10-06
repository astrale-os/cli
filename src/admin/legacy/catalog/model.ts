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

/**
 * Admin refused to catalogue an origin in the selected Fleet (`CATALOG_ORIGIN_CONFLICT`). A Fleet
 * other than the core Fleet changes only the Domains it contains (`not-in-fleet`); the core Fleet
 * catalogues an origin only when no Domain of it exists (`in-another-fleet`). No Admin method makes
 * a Fleet list an origin it does not, so the hints name only steps that work.
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
        ? `Admin refused to catalogue ${origin} in the core Fleet: a Domain of this origin already exists, and Admin keeps one Domain per origin.`
        : listed
          ? `This Fleet lists ${origin} from another Fleet's catalog; only that Fleet changes its name, URL or description.`
          : `Admin refused to catalogue ${origin} in this Fleet: a Fleet other than the core Fleet changes only the Domains it contains.`,
      reason === 'in-another-fleet'
        ? 'If another Fleet contains its Domain, rerun from that Fleet with `--fleet <path>`. A Domain that only the registry holds cannot be catalogued.'
        : listed
          ? 'Rerun with its current --name and --public-url to change only --install-by-default.'
          : 'Ask an Astrale operator, or install it without the catalog: astrale domain install <url> --direct -i <instance>',
      options,
    )
  }
}
