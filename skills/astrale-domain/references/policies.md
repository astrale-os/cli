# Policies

Read when declaring callable authentication or authorization, using a Schema Policy, or admitting an
external value.

## Authentication mode is not the authorization rule

The installed Schema declares each callable's authentication mode and optional callable Policy;
Kernel Runtime defines and evaluates those semantics against the pinned installation state:

- `anonymous` permits an absent credential. If a credential is supplied, Runtime authenticates it and
  propagates authentication failure instead of falling back to anonymous;
- `authenticated` requires an authenticated actor;
- `authorized` requires an authenticated actor. The principal of the active installed Kernel registration
  bypasses the remaining callable gate; every other caller requires the installed executor and complete
  caller Grant admission described below;
- only `authorized` may declare a callable Policy. `authenticated` does not add a `can_use` or Policy gate.

Do not recreate these gates inside an Action or Workflow, or use `authenticated` as a shortcut for
a protected operation merely because its handler can access Domain-owned data.

## Function admission: executor AND caller authority

The caller `principal` is the Identity directly established by authentication. The complete caller Grant
is the effective authority expression evaluated for the invocation, including its unions, intersections,
and restrictions. Runtime keeps both distinct from the installed executor; delegation does not turn the
caller into the Domain owner.

For a non-Root caller, an authorized Function requires both:

1. The installed executor owns the exact Function or has its direct `can_use` capability.
2. The complete caller Grant passes the Function-use branch (a carried Kernel Root Identity, exact Function
   owner, or direct `can_use`), OR the Function's declared Policy check passes over that complete Grant.
   Missing Policy supplies no alternative.

- The executor is not the human caller. For an inherited Method, ownership follows the resolved
  Function's accepted installation, not the receiver Class's Domain or a business `ownedBy` Edge.
- Direct Function use and callable Policy are alternatives, not successive checks. A failed Policy
  does not revoke an independently valid use Grant; test Policy refusals without that bypass authority.
- Evaluate each branch against the whole Grant: identities inside an intersection cannot satisfy
  half through `can_use` and half through Policy. A caller whose direct principal is the active installed
  Kernel Root is an explicit admission bypass; a Root Identity carried inside another principal's Grant
  remains part of the ordinary Function-use branch.

## Graph access is a separate decision

- Invoking `Project.rename` does not grant direct Query/Mutation access to Project nodes. Conversely,
  a permitted graph read is not proof that the caller may invoke a Function operating on that record.
- For an exact Class `read`/`traverse` operation with a Policy, the complete Grant can pass through
  capability, Class ownership, or Policy; the compiler does not also require a direct capability from the
  selected graph session's principal.
- Without that observation Policy, the selected graph session's principal still needs Class ownership or
  the exact operation capability; the Grant-side observation gate is neutral. No Policy does not mean
  globally public data.
- Current Class effects (`create`/`update`/`delete`) do not evaluate Class observation Policies. For a
  non-Root principal, effect closure requires principal capability/ownership and complete-Grant
  capability/ownership. If initiated through a callable, callable admission remains a separate outer gate.
- Read authority also permits traversal; traversal alone does not permit property reads. Test what
  the caller can observe, not just whether one isolated `traverse` Policy matches.

## Declare the business rule at its owner

- Project convention: give each match Policy a `description` stating the subject, protected object or
  endpoints, and condition, naming the business relation when one exists. Keep reusable graph predicates
  in the module's `policies/`, never `types/`; place a callable's check inline in its declaration.
- `policy.allOf(...)` / `policy.anyOf(...)` currently accept Policy operands, not description options.
  Describe the constituent match Policies; do not add unsupported metadata or duplicate patterns for a label.

Read `users.md` for Shell User subclasses, registration, and membership. Business graph ownership
does not justify a shadow User or manual writes to Shell's membership/authority pair.

Request an exact foreign Function when the Domain must invoke it through Domain-owned (`self`/`union`)
direct-use authority. Installation materializes `can_use` for the requesting installed Domain principal;
on the foreign invocation, that authority supplies the caller Function-use branch and is distinct from
the protected Function's executor gate. Do not request it for a caller-session Policy-admitted call merely
because the dependency is `authorized`: direct caller use bypasses Policy. Shell's user/group methods are one example.

For a non-Root caller, Kernel calls such as `auth.register(...)` require exact Function usability, and the
request must independently satisfy Register's credential, target, and graph/schema admission rules. Select
the caller/Domain session explicitly; the ordinary `client` is caller-only. A Schema dependency is not a
capability, and granting the human rights is not a substitute for Domain-owned execution.

```ts
import { method, policy } from '@astrale-os/sdk/schema'
import { z } from 'zod'

import { manages } from './relationships.js'

export const mayRenameProject = policy({
  description: 'The caller manages this Project.',
  match: ({ edge, subject, object }) =>
    edge({ source: subject, class: manages, target: object }),
})

export const rename = method({
  auth: 'authorized',
  input: z.object({ title: z.string() }),
  output: z.boolean(),
  policy: ({ check, self }) => check(mayRenameProject, self),
})
```

Runtime dispatches `Project.rename` as an Action or Workflow. Its SDK context includes the loaded Domain,
validated input, authenticated caller and `caller.authority`, caller-only Client, explicit Kernel and graph
authority partitions, configured Integration clients, execution controls, declared-error helpers, and `self`
for an instance Method. These are execution facilities, not a second authorization decision; handler code
must not replace Kernel admission with a role lookup.

## Reuse without changing what is checked

- Named `policy.allOf(...)` / `policy.anyOf(...)` composition and callable `check(...)` accept only exact local
  named Policy refs; cycles and foreign named Policy refs are rejected. A dependency's presence does not make
  its named Policy locally composable or callable-checkable.
- Inside a match or callable object expression, `ref(...)` may name a projected Class, Function, Policy, View,
  or Core node from the local Domain or an exact direct dependency. Referencing a dependency Policy this way
  compares or traverses its projected graph node; it does not evaluate that Policy.
- Every normalized branch must use exactly one target mode. A Node-Policy branch references `object`; an
  Edge-Policy branch references `source`, `target`, or both. The `subject`, every referenced protected term,
  and every scoped existential variable must form one connected proof graph. A branch saying only “caller
  belongs to a group” is not resource-scoped and rejects.
- Query admission separately verifies the candidate's exact Edge Class, then evaluates its Policy against
  the admitted `source` and `target`. Constrain whichever endpoint owns access. A Policy Edge predicate is an
  existence test; do not use it as a surrogate identity check for the candidate Edge.

Each `check(policy, object)` evaluates one named Policy against one protected object. Combining checks on
`self` and input references expresses independent requirements, not a joint relationship between those
objects. Use callable `sameNode(left, right)` when exact Node equality is intended; separate Policy checks
do not express an arbitrary joint relationship.

## Composition consumes a budget

- Budgets apply after named-policy expansion and branch normalization, not per helper file.
  AND multiplies alternatives: `(A OR B OR C) AND (D OR E OR F)` creates 9 branches, over the current limit of 8.
- Current DSL limits include expanded pattern depth 4, 6 Edge-or-`sameNode` predicate leaves per normalized
  branch, 4 variables per `exists`, integral repetition bounds `0 <= min <= max <= 3`, and 4 distinct Domain
  origins including the Policy's own Domain. Callable checks also cap depth at 4 and leaves/branches at 8.
- Refactoring into named helpers does not reset those budgets. Simplify the actual proof topology
  when `PL_BUDGET` rejects; do not move authorization into a handler or drop an alternative to compile.
- These are Schema admission ceilings, not guaranteed runtime scan capacity. Verify the installed
  DSL's limits before relying on a boundary value; a bounded repeat is not unbounded group ancestry.

## Scope existential Node witnesses deliberately

Policy Node selectors are authorization scope, not a typing convenience. `node()` can be witnessed by
any active concrete Node Class that satisfies the Policy topology. `node(Class)` ranges over all active
concrete Classes satisfying `Class`: the Class itself when concrete, plus active concrete descendants,
including descendants supplied by other installed Domains. `node.exact(Class)` can be witnessed only by
that exact concrete Class; an abstract exact selector is empty.

`node.exact(Class)` restricts exact Class membership; it does not test Node identity. Use `sameNode(...)`
for Node identity equality. Prefer `node.exact(Class)` when authorization depends on exact Class membership,
`node(Class)` when concrete descendants must inherit the path, and `node()` only when the connected Edge
constraints fully express the intended boundary. Test each intentionally broad selector with an allowed
witness and a connected but unauthorized witness from outside the intended family. For polymorphic
selectors, include a concrete descendant in the success evidence.

## Use Policy probes only as observations

The bound authenticated Client API may evaluate a Policy for presentation or diagnostics:

```ts
const allowed = await client.auth.can({
  policy: Work.policies.mayRenameProject.ref,
  object: projectId,
})
```

This boolean is a factual snapshot only: it neither changes nor grants authority nor reserves a future
decision. The protected callable remains the authoritative gate because graph and authority state can
change after the observation.

## Keep trust-boundary ownership explicit

- The Kernel verifies credentials and establishes the caller.
- The Kernel closes callable admission against its pinned Registry snapshot and independently validates
  invocation input/output against the resolved callable contract.
- The serving SDK independently validates handler input/output against the callable loaded from its pinned Release.
- Provider implementations must structurally admit unknown external responses before returning Integration
  output values; Integration generics are not automatically runtime-validated.
- The Domain Runtime's `initialize(environment, ...)` callback must validate its unknown environment and
  construct Providers; the SDK then validates the exact Provider envelope and declared Integration coverage.

Do not catch an unknown provider, transport, or programmer defect merely to report invalid caller
input. Preserve the stable error family owned by the boundary that rejected the value.

## Policy and admission evidence

Successful root invocation proves the operation can execute, not that an application user's Policy
works. Test with distinct registered principals and the actual role/membership facts the product
uses. Listing a local CLI identity does not prove it is registered or authorized on the target Kernel.
When a native Domain owns identity or group lifecycle, use its current public registration and role
operations; verify the installed dependency version instead of copying an old bootstrap recipe.

For protected behavior, test absent and invalid credentials as applicable, executor-gate denial, caller
denial where the complete caller Function-use branch and Policy are both false, Policy refusal with no
caller Function-use alternative (carried Kernel Root, exact Function ownership, or direct `can_use`), and
success. For each denial, prove that every downstream boundary reachable by that operation—handler
dispatch, Workflow steps, Integration/Provider operations, and graph mutations as applicable—did not run.
Runtime initialization that occurred before invocation is outside this assertion. Use a real Kernel admission
path for this evidence; a handler-local conditional or permissive fake cannot prove authorization.

For Domain-owned direct-capability success, inspect the exact requested and materialized Function capability
for the installed Domain principal. For Policy-admitted success, verify the intended caller Grant and that
the complete caller Function-use branch is false. Inspect the executor gate separately against the exact
Function's installed ownership or direct executor use.

Keep each denial criterion proportional to its claim. A mutating denial needs an independent no-effect
observation through a separately authorized read path; a read-only denial does not need invented graph
assertions. When testing revocation, remove the business fact, repeat the same protected operation while
the Domain remains installed, and observe the denial independently.
