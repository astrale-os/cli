/**
 * The Admin Fleet catalog adapters, kept for the commands that still read or write it.
 *
 * @deprecated Successor, short-term consumers and removal: see `./client.ts`.
 */
export {
  connectAdminCatalog,
  type AdminCatalogApi,
  type AdminCatalogContext,
  type AdminCatalogDependencies,
} from './client'
export { installCatalogDomain, type CatalogInstallDependencies } from './install'
export {
  AdminDomainNotFoundError,
  type DomainInfo,
  type DomainInstallReceipt,
  type InstallDomainResult,
  type PublishDomainInput,
  type PublishDomainResult,
} from './model'
export { resourceFleet } from './resource-fleet'
