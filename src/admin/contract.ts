import type { Input } from '@astrale-os/sdk/client'
import type { ClientSession, SessionRequestOptions } from '@astrale-os/sdk/client/session'
import type { ClassRef, MethodKey } from '@astrale-os/sdk/schema'

import { call } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import { K, PropertyKey } from '@astrale-os/sdk/schema'

const origin = 'admin.astrale.ai'

function classRef(name: string): ClassRef {
  return Object.freeze({ origin, kind: 'class', name }) as ClassRef
}

const Fleet = classRef('Fleet')
const Domain = classRef('Domain')
const Instance = classRef('Instance')
const Invitation = classRef('Invitation')
const RegisteredDomain = classRef('RegisteredDomain')
const Publication = classRef('Publication')

export const AdminContract = Object.freeze({
  origin,
  fleet: Path.parse('/:admin.astrale.ai:core.fleet'),
  classes: Object.freeze({
    Fleet,
    Domain,
    Instance,
    Invitation,
    RegisteredDomain,
    Publication,
  }),
  edges: Object.freeze({
    fleetContains: classRef('fleet_contains'),
    fleetInstallsDomainByDefault: classRef('fleet_installs_domain_by_default'),
    publicationOfDomain: classRef('publication_of_domain'),
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
    instance: Object.freeze({
      slug: PropertyKey.of(Instance, 'slug'),
      operationId: PropertyKey.of(Instance, 'provisioningOperationId'),
      url: PropertyKey.of(Instance, 'url'),
      issuer: PropertyKey.of(Instance, 'childIssuer'),
      organizationId: PropertyKey.of(Instance, 'organizationId'),
      state: PropertyKey.of(Instance, 'state'),
      phase: PropertyKey.of(Instance, 'phase'),
      failure: PropertyKey.of(Instance, 'failure'),
      createdAt: K.classes.Timestamped.properties.createdAt.key,
      updatedAt: K.classes.Timestamped.properties.updatedAt.key,
    }),
    registeredDomain: Object.freeze({
      origin: PropertyKey.of(RegisteredDomain, 'origin'),
    }),
    publication: Object.freeze({
      version: PropertyKey.of(Publication, 'version'),
      deploymentUrl: PropertyKey.of(Publication, 'deploymentUrl'),
      releaseDigest: PropertyKey.of(Publication, 'releaseDigest'),
      buildDigest: PropertyKey.of(Publication, 'buildDigest'),
      schemaRevision: PropertyKey.of(Publication, 'schemaRevision'),
      dependencies: PropertyKey.of(Publication, 'dependencies'),
      commit: PropertyKey.of(Publication, 'commit'),
      dirty: PropertyKey.of(Publication, 'dirty'),
      bundle: PropertyKey.of(Publication, 'bundle'),
      yankedAt: PropertyKey.of(Publication, 'yankedAt'),
      createdAt: K.classes.Timestamped.properties.createdAt.key,
    }),
  }),
})

/** Invoke one stable Admin instance Method without schema discovery or reflection. */
export function callAdminMethod(
  session: Pick<ClientSession, 'call'>,
  receiver: Path,
  method: MethodKey,
  input: Input,
  options?: SessionRequestOptions,
): Promise<unknown> {
  return session.call(call(Path.instanceMethod(receiver, method), input), options)
}
