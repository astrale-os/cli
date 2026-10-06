/**
 * The CLI's Fleet catalog journeys over one Admin session: list a Fleet's catalog, publish an entry
 * (and its install-by-default flag), and install one entry on an Admin-managed Instance.
 *
 * @deprecated Successor: the Domain version registry. `astrale-domain publish <environment>`
 * publishes a version, `astrale domain versions <origin>` lists them and `astrale domain install
 * <origin>@<version>` installs one through the instance Kernel. The Fleet catalog stays the only
 * source of a Fleet's default Domains until catalogue and provisioning by version ship.
 * Short-term consumers: operators who keep a Fleet's defaults (repointing its Shell default with
 * `astrale domain publish --fleet`), and 1Pact developer machines, whose adapter-astrale
 * 0.5.0-beta.148 `ensureServices` execs `domain install services.astrale.ai -i <instance>`.
 * Removal (D15): once catalogue and provisioning by version ship and no supported 1Pact SDK
 * installs by bare origin, in a breaking CLI release with `catalog-publish.ts`,
 * `catalog-list.ts`, `catalog-install.ts`, `catalog-deprecation.ts` and `src/admin/legacy/catalog`.
 */
import type { OwnedInstanceInfo } from '../../../admin/instance'
import type { AdminConnectionOptions, ConnectionContext } from '../../../connection'

import {
  connectAdminCatalog,
  installCatalogDomain,
  resourceFleet,
  type DomainInfo,
  type PublishDomainInput,
} from '../../../admin/legacy/catalog'
import { withAdminClientSession } from '../../../connection'

export type {
  DomainInfo,
  InstallDomainResult,
  PublishDomainInput,
} from '../../../admin/legacy/catalog'

/** Read the caller-visible V2 Admin Domain catalog. */
export function listAdminDomains(options: AdminConnectionOptions): Promise<DomainInfo[]> {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminCatalog({ ...context, fleet: options.fleet })).list(),
  )
}

/** Reuse one open Admin session for catalog reads. */
export async function listAdminDomainsInContext(
  context: ConnectionContext,
  instance: string,
): Promise<DomainInfo[]> {
  const selected = (await resourceFleet(context, instance)).raw
  return (await connectAdminCatalog({ ...context, fleet: selected })).list()
}

/** Publish and optionally configure default installation through V2 receiver Methods. */
export function publishAdminDomain(options: AdminConnectionOptions, input: PublishDomainInput) {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminCatalog({ ...context, fleet: options.fleet })).publish(input),
  )
}

/** Install one resolved catalog Domain on one caller-visible Instance. */
export async function installAdminDomainInContext(
  context: ConnectionContext,
  instance: OwnedInstanceInfo,
  domain: DomainInfo,
) {
  const receipt = await installCatalogDomain(context, instance.id, domain.id)
  return Object.freeze({
    name: domain.name,
    origin: receipt.origin,
    instanceId: instance.slug,
    url: domain.url ?? '',
    ok: receipt.ok,
    ...(receipt.error === undefined ? {} : { error: receipt.error }),
  })
}
