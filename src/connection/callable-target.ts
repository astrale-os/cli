import type { SchemaApi } from '@astrale-os/sdk/client/schema'
import type { Path } from '@astrale-os/sdk/graph/path'

import { issuer } from '@astrale-os/sdk/auth'
import { ClassKey } from '@astrale-os/sdk/schema'

import type { ConnectionTarget } from './target'

/** The executable declaration owns exchange; a receiver's instance does not select Shell. */
export function callableOrigin(path: Path): string | undefined {
  const method = path.ast.steps.at(-1)
  if (method?.kind === 'method' && method.dispatch === 'instance' && method.class !== undefined) {
    return ClassKey.ref(method.class).origin
  }
  return path.ast.anchor.kind === 'domain' ? path.ast.anchor.origin : undefined
}

/** Trust only the selected Kernel's installed Publication for the Domain issuer. */
export async function resolveCallableTarget(
  target: ConnectionTarget,
  origin: string,
  schema: Pick<SchemaApi, 'inspect'>,
): Promise<ConnectionTarget> {
  const installed = await schema.inspect(origin)
  const domainIssuer = installed.publication?.identity.issuer
  const { domainIssuer: _bookmarkDomain, ...source } = target
  return {
    ...source,
    ...(domainIssuer === undefined || domainIssuer === target.kernelIssuer
      ? {}
      : { domainIssuer: issuer.accept(domainIssuer) }),
  }
}
