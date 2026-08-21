<!-- Kernel-v2 reference. -->

# Domains

Read when deciding whether a Domain should depend on an existing Astrale Domain instead of owning a
second version of the same concept.

## Discover the semantic owner first

Prefer reuse when an existing Domain already owns the vocabulary, lifecycle, or trust boundary. Verify
the current package, Schema origin, public facade, and installed availability from the workspace and
target catalog; do not copy a static package list or create local lookalike Classes.

## Declare graph-level Schema dependencies

When your Schema refers to a foreign Class or Interface, import the foreign Domain's public facade and
declare its exact Schema as a dependency. This makes the graph reference explicit; it does not grant
call authority.

```ts
import { Directory, DirectorySchema } from '@example/directory-domain'
import { defineSchema, nodeClass, path, property } from '@astrale-os/sdk/schema'

export const Workspace = nodeClass({
  properties: {
    owner: property(path(Directory.Person), { required: true }),
  },
})

export const WorkspacesSchema = defineSchema('workspaces.example', {
  dependencies: [DirectorySchema],
  classes: { Workspace },
})
```

Do not put `requires`, foreign origins, physical placement, or imported Schemas on
`defineDomain(...)`. Kernel-v2 Domain composition contains `schema`, `handlers`, optional `deps`,
and an exact `capabilities` plus `providers` pair.

## Invoke another Domain through a Capability

A Function or Workflow never directly imports and calls a foreign Domain. Define a consumer-owned
Capability, implement it in an Integration that binds the remote Domain's public Schema revision, and
translate remote results and delivery failures into the Capability's vocabulary. The handler receives
only the resulting invocation-scoped Capability client.

```ts
import { Directory, DirectorySchema } from '@example/directory-domain'
import type { DomainBinding } from '@astrale-os/shell'

import type { MemberDirectory } from '#capabilities/member-directory'

export function createDirectoryDomain(
  remote: DomainBinding<typeof DirectorySchema>,
): MemberDirectory {
  return {
    async resolve(request) {
      return remote.invoke(Directory.resolveMember, request)
    },
  }
}
```

Keep transport retries, remote revision binding, and failure translation in that Integration. If one
change must span several commits or service boundaries, own it as a Workflow; do not claim
cross-Domain atomicity.

## Origin and serving location are distinct

The Schema origin is the stable semantic namespace used by Classes, Policies, and callable identities.
The serving URL and installed placement are deployment and Kernel concerns. Moving a worker must not
rename semantic addresses, and changing an origin is a Schema migration. Do not add legacy `origin`
or `path` fields to `defineDomain`.

## Review questions

- Does another Domain already own this concept?
- Is the dependency a graph-level Schema reference or a callable Capability boundary?
- Is every foreign import through the Domain's public facade?
- Does the Integration bind one exact remote Schema and translate only declared failures?
- Does installation evidence prove the dependency exists on the actual target instance?
