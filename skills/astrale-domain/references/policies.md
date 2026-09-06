# Policies

Read when declaring callable authentication or authorization, using a Schema Policy, or admitting an
external value.

## Authentication mode is not the authorization rule

The Schema owns all callable admission intent:

- `anonymous` permits no credential, but does not downgrade an invalid supplied credential to anonymous;
- `authenticated` requires a verified identity;
- `authorized` requires the installed executor and complete caller Grant admission described below;
- only `authorized` may declare a callable Policy. `authenticated` does not add a `can_use` or Policy gate.

Do not recreate these gates inside an Action or Workflow, or use `authenticated` as a shortcut for
a protected operation merely because its handler can access Domain-owned data.

## Function admission: executor AND caller authority

The principal identifies who is calling; the Grant expresses whose authority is exercised, including
its unions, intersections, and restrictions. Delegation does not turn the caller into the Domain owner.

For a non-Root caller, an authorized Function requires both:

1. The installed executor owns the exact Function or has its direct `can_use` capability.
2. The complete caller Grant passes the Function-use branch (Root, exact owner, or direct `can_use`),
   OR the Function's declared Policy check passes over that complete Grant. Missing Policy supplies no alternative.

- The executor is not the human caller. For an inherited Method, ownership follows the resolved
  Function's accepted installation, not the receiver Class's Domain or a business `ownedBy` Edge.
- Direct Function use and callable Policy are alternatives, not successive checks. A failed Policy
  does not revoke an independently valid use Grant; test Policy refusals without that bypass authority.
- Evaluate each branch against the whole Grant: identities inside an intersection cannot satisfy
  half through `can_use` and half through Policy. A Kernel Root caller is an explicit admission bypass.

## Graph access is a separate decision

- Invoking `Project.rename` does not grant direct Query/Mutation access to Project nodes. Conversely,
  a permitted graph read is not proof that the caller may invoke a Function operating on that record.
- For an exact Class `read`/`traverse` operation with a Policy, the complete Grant can pass through
  capability, Class ownership, or Policy; the compiler does not also require a direct principal capability.
- Without that observation Policy, the principal still needs Class ownership or the exact operation
  capability; the Grant-side observation gate is neutral. No Policy does not mean globally public data.
- Current Class effects (`create`/`update`/`delete`) use principal authority and the complete Grant's
  capability/owner branch, not callable Policy matching. Domain-owned writes still need correct callable admission.
- Read authority also permits traversal; traversal alone does not permit property reads. Test what
  the caller can observe, not just whether one isolated `traverse` Policy matches.

## Declare the business rule at its owner

- Give each match Policy a `description` stating who may do what and through which business relation.
  Keep it in the module's `policies/`, never `types/`; place its callable check inline in that callable declaration.
- `policy.allOf(...)` / `policy.anyOf(...)` currently accept Policy operands, not description options.
  Describe the constituent match Policies; do not add unsupported metadata or duplicate patterns for a label.

Humans authenticate as distinct identities and gain application access through Schema Policy over
business graph facts. When Shell owns the human-facing User, observe that exact User and write only
the application Domain's membership or business facts. Do not create a shadow User or grant a
human dynamic `can_*` authority to make acceptance pass.

Dependency Function authority is installation-owned. The calling Domain's Application explicitly
declares each exact protected foreign or Kernel Function in `requirements({ functions: [...] })`;
Kernel installation then owns materializing authority for the installed Domain principal. Do not
grant the invoking human direct `can_*` authority as a substitute, and do not confuse a Schema
dependency with capability. An Action that uses `client.auth.register(...)`, for example, requires
the exact resolved Kernel `register` callable. Select the intended caller/Domain Kernel session
explicitly; the ordinary `client` is caller-only.

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

## Reuse without changing what is checked

- Named `policy.allOf(...)` / `policy.anyOf(...)` composition reuses local Policies; cycles and foreign named
  Policy refs are rejected. A dependency's presence does not make its named Policy locally composable.
- A local Policy may traverse Classes/Edges or use projected objects from exact direct dependencies.
  A foreign Policy ref used as an object names that Policy's graph node; it does not execute that Policy.
- Every normalized alternative must connect the subject and the protected object/endpoints. An OR
  branch saying only “caller belongs to a group” is not a resource-scoped proof; disconnected branches reject.
- Edge Policies receive the admitted `source`/`target`. Constrain whichever endpoint owns access;
  do not re-match the candidate Edge just to repeat its Class and endpoint guarantees.

The checked public DSL (`kernel-dsl` `0.2.0-beta.30`) exposes `check(policy, object)`, not arbitrary
named `parameters`. Several checks on `self`/input references can express independent requirements,
but are not a substitute for a joint multi-object predicate; verify a newer API before authoring one.

## Composition consumes a budget

- Budgets apply after named-policy expansion and branch normalization, not per helper file.
  AND multiplies alternatives: `(A OR B OR C) AND (D OR E OR F)` creates 9 branches, over the current limit of 8.
- Current DSL limits include expanded depth 4, 6 graph predicates per branch, 4 variables per `exists`,
  repetition maximum 3, and 4 referenced Domains. Callable checks also cap depth at 4 and leaves/branches at 8.
- Refactoring into named helpers does not reset those budgets. Simplify the actual proof topology
  when `PL_BUDGET` rejects; do not move authorization into a handler or drop an alternative to compile.
- These are Schema admission ceilings, not guaranteed runtime scan capacity. Verify the installed
  DSL's limits before relying on a boundary value; a bounded repeat is not unbounded group ancestry.

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
- The Kernel admits callable authority using the pinned Schema and complete Grant branches.
- The SDK validates callable input and output against the pinned Domain.
- An Integration owns structural admission of an external provider response.
- Runtime `initialize` owns environment admission and Provider construction.

Do not catch an unknown provider, transport, or programmer defect merely to report invalid caller
input. Preserve the stable error family owned by the boundary that rejected the value.

## Policy and admission evidence

Successful root invocation proves the operation can execute, not that an application user's Policy
works. Test with distinct registered principals and the actual role/membership facts the product
uses. Listing a local CLI identity does not prove it is registered or authorized on the target Kernel.
When a native Domain owns identity or group lifecycle, use its current public registration and role
operations; verify the installed dependency version instead of copying an old bootstrap recipe.

For protected behavior, test missing identity, no caller-authority branch, Policy refusal without
direct-use bypass, and success as applicable. Denials must prove the Action, Workflow steps, Providers,
and graph effects did not run. Use a real Kernel admission path for this evidence; a handler-local
conditional or permissive fake cannot prove authorization.

For a cross-Domain success, independently inspect installation evidence and require the exact foreign
callable under both requested and materialized capabilities before attributing the result to the
installed Domain edge.

Keep each denial criterion proportional to its claim. A mutating denial needs an independent no-effect
observation; a read-only denial does not need invented graph assertions. When testing revocation,
remove the business fact, repeat the same protected operation while the Domain remains installed, and
observe the denial independently.
