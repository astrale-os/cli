# Policies

Read when declaring callable authentication or authorization, or using a Schema Policy.

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
- Do not recreate these gates inside an Action or Workflow, or use `authenticated` as a shortcut for
  a protected operation merely because its handler can access Domain-owned data.

## Function admission: executor AND caller authority

- The caller `principal` is the Identity directly established by authentication. Its complete Grant is the
  authority expression evaluated for the invocation, including unions, intersections, and restrictions.
  Both remain distinct from the installed executor; delegation does not turn the caller into the Domain owner.

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
- Every Class graph operation admits two independent authority planes. The selected session principal must
  be Kernel Root, own the Class, or hold its exact operation capability; the complete Grant must separately
  pass by capability, ownership, or a declared `read`/`traverse` Policy.
- A Class Policy affects only the Grant plane; it never gives the selected principal Class authority. No
  Policy makes the Grant plane neutral, not data public. Choose the intended View boundary in `views.md`.
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
- Read `users.md` for Shell User subclasses, registration, and membership. Business graph ownership
  does not justify a shadow User or manual writes to Shell's membership/authority pair.
- Request an exact foreign Function when the Domain invokes it through Domain-owned (`self`/`union`)
  direct-use authority. Installation materializes `can_use` for that Domain principal; this is distinct
  from the protected Function's executor gate.
- Do not request direct use for a caller-session Policy-admitted call merely because the dependency is
  `authorized`: that capability bypasses Policy. Shell's user/group methods are one example.
- Kernel calls such as `auth.register(...)` require exact Function usability and must independently satisfy
  their credential, target, and graph/Schema admission. Select the caller/Domain session explicitly; a Schema
  dependency is not a capability, and granting the human rights is not Domain-owned execution.

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

- Runtime dispatches `Project.rename` as an Action or Workflow. Its context facilities are not a second
  authorization decision; handler code must not replace Kernel admission with a role lookup.

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

- Each `check(policy, object)` evaluates one Policy against one protected object. Checks on `self` and input
  refs are independent requirements, not a relationship between those objects; use callable `sameNode(...)`
  for exact Node equality.

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

- Policy Node selectors define authorization scope, not types. `node()` accepts any matching active concrete
  Node Class; `node(Class)` also accepts its active concrete descendants, including foreign ones;
  `node.exact(Class)` accepts only that exact concrete Class and is empty for an abstract Class.
- `node.exact(Class)` does not test Node identity; use `sameNode(...)`. Test every intentionally broad selector
  with an allowed witness and a connected unauthorized witness; include a descendant for polymorphic success.

## Policy and admission evidence

- Root success proves executability, not an application user's Policy. Test distinct registered principals
  with real business facts; a local CLI identity need not be registered or authorized on the target Kernel.
- Test applicable credential failure, executor denial, caller/Policy denial without a direct-use alternative,
  and success through the real Kernel path. For denials, prove reachable handlers, steps, Providers, and graph
  effects did not run; earlier Runtime initialization is outside that assertion.
- For direct-capability success, inspect requested and materialized Function capability for the Domain principal.
  For Policy success, prove the intended caller Grant and absence of a bypass branch; inspect executor separately.
- Keep evidence proportional: mutating denial needs an independent no-effect read, read-only denial does not.
  Test revocation by removing the business fact and repeating the same operation while the Domain stays installed.
