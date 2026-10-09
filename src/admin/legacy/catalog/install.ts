/**
 * Install one Fleet catalog Domain on one Admin-managed Instance through `Instance.installDomain`.
 *
 * @deprecated Successor: a URL or `<origin>@<version>` install, which the CLI sends to the instance
 * Kernel itself (`../../../commands/domain/release-install.ts`). Short-term consumers: 1Pact
 * developer machines, whose adapter-astrale 0.5.0-beta.148 `ensureServices` execs
 * `domain install services.astrale.ai -i <instance>`; operators installing a Fleet catalog Domain
 * by its origin. Removal: see `./client.ts`.
 */
import { Path } from '@astrale-os/sdk/graph/path'
import { MethodKey } from '@astrale-os/sdk/schema'

import type { AdminInstanceContext } from '../../instance/client'
import type { DomainInstallReceipt } from './model'

import { randomOperationId } from '../../../lib/idempotency'
import { AdminContract, callAdminMethod } from '../../contract'
import { connectAdminInstances } from '../../instance/client'
import { record, requiredNodePath, requiredString } from './decode'

export interface CatalogInstallDependencies {
  readonly operationId?: () => string
}

/**
 * Resolve the caller-visible Instance (an exact Node Path or its slug), then invoke its
 * `installDomain` receiver with the catalog Domain's Node Path. Admin reports a failed install as
 * `ok: false` with its failure message; it never throws past its saga.
 */
export async function installCatalogDomain(
  context: AdminInstanceContext,
  instance: string,
  domain: string,
  dependencies: CatalogInstallDependencies = {},
): Promise<DomainInstallReceipt> {
  const target = await (await connectAdminInstances(context)).require(instance)
  const output = await callAdminMethod(
    context.session,
    Path.parse(target.id),
    MethodKey.of(AdminContract.classes.Instance, 'installDomain'),
    {
      operationId: (dependencies.operationId ?? defaultOperationId)(),
      domain: Path.parse(domain).raw,
    },
  )
  return domainInstallReceipt(output)
}

function domainInstallReceipt(input: unknown): DomainInstallReceipt {
  const value = record(input, 'Admin Domain install receipt')
  const failure = value.failure === undefined ? undefined : record(value.failure, 'Admin failure')
  if (typeof value.ok !== 'boolean') throw new TypeError('Admin Domain install outcome is invalid.')
  return Object.freeze({
    domain: requiredNodePath(value.domain, 'Admin Domain reference'),
    instance: requiredNodePath(value.instance, 'Admin Instance reference'),
    origin: requiredString(value.origin, 'Installed Domain origin'),
    ok: value.ok,
    ...(value.installedRevision === undefined
      ? {}
      : {
          installedRevision: requiredString(value.installedRevision, 'Installed Domain revision'),
        }),
    ...(failure === undefined
      ? {}
      : { error: requiredString(failure.message, 'Admin Domain install failure') }),
  })
}

/** The operation id the Instance adapter gave this call before it moved here. */
function defaultOperationId(): string {
  return randomOperationId('cli', 'instance', 'install-domain')
}
