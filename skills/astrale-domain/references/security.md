# Security

Read when declaring callable authentication or authorization, using a Schema Policy, or admitting an
external value.

## Keep the three gates distinct

The Schema owns all callable admission intent:

- `anonymous` permits a call without an authenticated identity;
- `authenticated` requires a verified identity;
- `authorized` requires both authentication and Kernel callable authority;
- an `authorized` callable may additionally declare a Policy over the subject, receiver, input
  references, Core values, and graph facts.

Authentication is not callable authority, and callable authority is not Policy satisfaction. Do not
recreate any of these gates inside an Action or Workflow.

Humans authenticate as distinct identities and gain application access through Schema Policy over
business graph facts. When Shell owns the human-facing User, observe that exact User and write only
the application Domain's membership or business facts. Do not provision a shadow User or grant a
human dynamic `can_*` authority to make acceptance pass.

Dependency Function authority is installation-owned. The calling Domain's Application explicitly
declares each exact protected foreign or Kernel Function in `requirements({ functions: [...] })`;
Kernel installation then owns materializing authority for the installed Domain principal. Do not
grant the invoking human direct `can_*` authority as a substitute, and do not confuse a Schema
dependency with capability. An Action that uses `client.auth.provision(...)`, for example, requires
the exact resolved Kernel `provision` callable.

```ts
import { method, policy } from '@astrale-os/sdk/schema'
import { z } from 'zod'

import { ownedBy } from './relationships.js'

export const mayRenameProject = policy({
  description: 'The caller manages this Project.',
  match: ({ edge, subject, object }) =>
    edge({ source: subject, class: ownedBy, target: object }),
})

export const rename = method({
  auth: 'authorized',
  input: z.object({ title: z.string() }),
  output: z.boolean(),
  policy: ({ check, self }) => check(mayRenameProject, self),
})
```

The Runtime implements `Project.rename` as an Action or Workflow. The implementation receives only
the caller, authority, Client, and receiver admitted for that callable. It must not query a role and
then treat the observation as authorization.

## Scope existential Node witnesses deliberately

Policy Node selectors are authorization scope, not a typing convenience. `node()` can be witnessed by
any active concrete Node Class that satisfies the Policy topology. `node(Class)` can be witnessed by
the Class and any active concrete descendant, including descendants supplied by other installed
Domains. `node.exact(Class)` can be witnessed only by that exact concrete Class; an abstract exact
selector is empty.

Prefer `node.exact(Class)` when authorization depends on exact identity, `node(Class)` when concrete
descendants must inherit the path, and `node()` only when the connected Edge constraints fully express
the intended boundary. Test each intentionally broad selector with an allowed witness and a connected
but unauthorized witness from outside the intended family. For polymorphic selectors, include a
concrete descendant in the success evidence.

## Use Policy probes only as observations

The bound Client authentication API may evaluate a Policy for presentation or diagnostics:

```ts
const allowed = await client.auth.can({
  policy: Work.policies.mayRenameProject.ref,
  object: projectId,
})
```

This boolean neither grants `can_use` nor reserves a future decision. The protected callable remains
the authoritative gate because graph and authority state can change after the observation.

## Admit each trust boundary once

- The Kernel verifies credentials and establishes the caller.
- The Kernel admits callable authority and evaluates the pinned Schema Policy.
- The SDK validates callable input and output against the pinned Domain.
- An Integration owns structural admission of an external provider response.
- Runtime `initialize` owns environment admission and Provider construction.

Do not catch an unknown provider, transport, or programmer defect merely to report invalid caller
input. Preserve the stable error family owned by the boundary that rejected the value.

## Security evidence

For protected behavior, test anonymous rejection, authenticated-but-unauthorized rejection, Policy
rejection, and success as separate cases. Denials must prove the Action, Workflow steps, Providers,
and graph effects did not run. Use a real Kernel admission path for this evidence; a handler-local
conditional or permissive fake cannot prove authorization.

For a cross-Domain success, independently inspect installation evidence and require the exact foreign
callable under both requested and materialized capabilities before attributing the result to the
installed Domain edge.

Keep each denial criterion proportional to its claim. A mutating denial needs an independent no-effect
observation; a read-only denial does not need invented graph assertions. When testing revocation,
remove the business fact, repeat the same protected operation while the Domain remains installed, and
observe the denial independently.
