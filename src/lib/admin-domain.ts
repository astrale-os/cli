import type { AdminConnectionOptions, ConnectionContext } from '../connection'

import { connectAdminCatalog, type DomainInfo, type PublishDomainInput } from '../admin/catalog'
import { resourceFleet } from '../admin/fleet/client'
import { connectAdminInstances, type OwnedInstanceInfo } from '../admin/instance'
import { withAdminClientSession } from '../connection'

export type { DomainInfo, InstallDomainResult, PublishDomainInput } from '../admin/catalog'

/** Read the caller-visible V2 Admin Domain catalog. */
export function listAdminDomains(options: AdminConnectionOptions): Promise<DomainInfo[]> {
  return withAdminClientSession(options, async (context) =>
    (await connectAdminCatalog({ ...context, fleet: options.fleet })).list(),
  )
}

/** Reuse one open Admin session for catalog reads. */
export async function listAdminDomainsInContext(
  context: ConnectionContext,
  fleet?: string,
  instance?: string,
): Promise<DomainInfo[]> {
  const selected = instance === undefined ? fleet : (await resourceFleet(context, instance)).raw
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
  const receipt = await (await connectAdminInstances(context)).installDomain(instance.id, domain.id)
  return Object.freeze({
    name: domain.name,
    origin: receipt.origin,
    instanceId: instance.slug,
    url: domain.url ?? '',
    ok: receipt.ok,
    ...(receipt.error === undefined ? {} : { error: receipt.error }),
  })
}
