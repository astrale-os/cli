import type { Input } from '@astrale-os/sdk/client'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { ClassRef } from '@astrale-os/sdk/schema'

import { call } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import { K, PropertyKey } from '@astrale-os/sdk/schema'

const origin = 'admin.astrale.ai'

function classRef(name: string): ClassRef {
  return Object.freeze({ origin, kind: 'class', name }) as ClassRef
}

const Domain = classRef('Domain')

export const AdminContract = Object.freeze({
  origin,
  fleet: Path.parse('/:admin.astrale.ai:core.fleet'),
  classes: Object.freeze({
    Domain,
  }),
  edges: Object.freeze({
    fleetInstallsDomainByDefault: classRef('fleet_installs_domain_by_default'),
  }),
  properties: Object.freeze({
    domain: Object.freeze({
      origin: PropertyKey.of(Domain, 'origin'),
      name: K.classes.Named.properties.name.key,
      discoveryUrl: PropertyKey.of(Domain, 'discoveryUrl'),
      description: K.classes.Descriptable.properties.description.key,
      createdAt: K.classes.Timestamped.properties.createdAt.key,
      updatedAt: K.classes.Timestamped.properties.updatedAt.key,
    }),
  }),
})

/** Invoke one stable Admin instance Method without schema discovery or reflection. */
export function callAdminMethod(
  session: ClientSession,
  receiver: Path,
  method: string,
  input: Input,
): Promise<unknown> {
  return session.call(call(Path.instanceMethod(receiver, method), input))
}
