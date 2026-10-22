# Policies

Read when declaring callable authentication or authorization, or using a Schema Policy.

## Authentication mode is not the authorization rule

The installed Schema declares each callable's authentication mode and optional callable Policy;
Kernel Runtime defines and evaluates those semantics against the pinned installation state:

- `anonymous` permits an absent credential. If a credential is supplied, Runtime authenticates it and
  propagates authentication failure instead of falling back to anonymous. Without a credential the
  handler still runs with the Domain's own authority (see `runtime.md`), so the caller is granted
  nothing but what the handler does for it;
- `authenticated` requires an authenticated actor;
- `authorized` requires an authenticated actor. The principal of the active installed Kernel registration
  bypasses the remaining callable gate; every other call requires the caller's admission and, for a
  delegation, the principal's effective authority, as described below;
- only `authorized` may declare a callable Policy. `authenticated` does not add a `can_use` or Policy gate.
- Do not recreate these gates inside an Action or Workflow, or use `authenticated` as a shortcut for
  a protected operation merely because its handler can access Domain-owned data.

## Function admission: the caller's rule, scoped by a delegation

Every authenticated call carries two Identities:

- the `principal`, established by authentication: the executor, its non-transferable ceiling, installed
  ownership, and Root;
- the `caller`, the one Identity whose authority the call exercises. A direct call has
  `caller = principal`. When a Domain acts for a user (`graph.caller`, `dependencies.<alias>.caller`,
  or the SDK Domain token exchange behind a Domain's Views, the Console and a callable command), the
  principal is the Domain and the caller is the user. CLI graph commands (`get`, `query`, `mutate`)
  on any Instance, the Admin included, and the Shell's own Views act for the user itself.

Both are evaluated through their live `extends_with`, `constrained_by`, and `excluded_from` composition
with deny-wins. A call carries no set of Identities: there is no union, intersection, or exclusion of
callers. The caller never raises the principal's ceiling, and principal authority never flows into the
caller's evaluation.

For a non-Root principal, an authorized Function requires:

1. The caller passes the intrinsic Root/Function-owner branch OR the declared callable Policy. Missing
   Policy supplies no alternative, and `true` admits every Identity. `can_use` is not an intrinsic
   bypass; giving the caller that capability does not defeat a business Policy.
2. When the principal acts for another caller, its own Identity profile also supplies `can_use` or
   exact Function ownership (the principal ceiling). A User may inherit `can_use` from a Group without
   an individual capability Edge. The caller carried by a Domain session cannot supply this ceiling.
   An Identity acting for itself delegates nothing and meets no ceiling: its rule alone decides.

This is the same rule as Class observation (Graph access below): the caller decides by its rule, and
the ceiling scopes only a delegation.

- The callee Domain that runs the handler never replaces the calling principal. Exact Method ownership
  follows its executable declaring installation, not a business `ownedBy` Edge; instance receivers must
  have the exact declaring Class.
- Only a Root principal, the authenticated installed Kernel Root, takes the outer shortcut. A Root caller
  carried by a Domain session stays in the caller branch: it can satisfy the intrinsic Root alternative,
  never the principal ceiling.
- A Policy `subject` is the caller, not necessarily the authenticated principal, and it already covers the
  caller's groups (see Groups below).
- Protected Kernel syscalls explicitly attach `canUseSyscall` to their exact Function or Method. That
  Policy checks the caller's `can_use`, so even a direct call needs it; resource checks inside the
  syscall remain independent. Capability-only callable admission must likewise be declared explicitly
  in the Policy, never inferred from `can_use`.

## Graph access is a separate decision

- Invoking `Project.rename` does not grant direct Query/Mutation access to Project nodes. Conversely,
  a permitted graph read is not proof that the caller may invoke a Function operating on that record.
- The Class rule decides observation (`read`/`traverse`) for the caller: the caller passes by
  ownership or by the rule, never by a Class capability it holds. A Class without a rule, or with
  `true`, admits every Identity of the instance; `false` admits its owning Domain only. Declare a rule
  on every Class whose nodes are not for everyone.
- A delegation is scoped by its principal. When a Domain acts for a caller, the Domain must also own
  the Class's installation or hold its exact Class capability (declare it in the requirements),
  whatever rule the Class declares. An Identity acting for itself delegates nothing and meets no such
  ceiling; Kernel Root bypasses both. The outer Query Function gate still applies. Choose the intended
  View boundary in `views.md`.
- A Class capability is therefore a scope, not a right: a Group's `can_read` bounds what its holders
  read for others and lets them read nothing the rule refuses. Put "this group reads every node" in
  the rule itself, as a check on the group.
- Current Class effects (`create`/`update`/`delete`) do not evaluate Class observation Policies. For a
  non-Root principal, effect closure requires principal capability/ownership and caller
  capability/ownership. A Domain's `self` session on Classes it owns closes by installed ownership
  (principal = caller = owner); a `caller` session does not. If initiated through a callable, callable
  admission remains a separate outer gate.
- Read authority also permits traversal; traversal alone does not permit property reads. Test what
  the caller can observe, not just whether one isolated `traverse` Policy matches.

## Declare the business rule at its owner

- Name a Policy as the sentence its subject completes, in the Domain's words: a verb, each business
  entity crossed in order, the object last (`managesProject`, `managesWorkspaceOfProject`). Say what
  a Kernel hop means, not how it walks: `extendsGroup` for `sameNode` against a group,
  `ownsClassOfDocument` for `of_domain` then `instance_of`. An Edge Policy names its endpoint by
  its `as` name (`ownsService`); a composition joins its operands (`managesProjectOrOwnsProject`) and
  splits into checks when too long to name. A long name is fine; an ambiguous one is not. Never name
  the permission granted (`can…`, `may…`: the slot or callable names it), use a graph mechanics word
  (`source`, `target`, `sub`, `super`, `subject`, `object`, `caller`), or drop a business hop. A check
  then reads as a sentence: `check(managesWorkspaceOfProject, self)`.
- Project convention: give each match Policy a `description` stating the subject, protected object or
  endpoints, and condition, naming the business relation when one exists. Keep reusable graph predicates
  in the module's `policies/`, never `types/`; place a callable's check inline in its declaration.
- `policy.allOf(...)` / `policy.anyOf(...)` currently accept Policy operands, not description options.
  Describe the constituent match Policies; do not add unsupported metadata or duplicate patterns for a label.
- Read `users.md` for Shell User subclasses, registration, and membership. Business graph ownership
  does not justify a shadow User or manual writes to Shell's membership/authority pair.
- Declare the exact protected foreign Function in the Domain definition's requirements when calling as the Domain,
  including Policy-admitted Shell methods. Installation supplies the Domain principal's capability;
  the caller (the Domain itself in a `self` session, the user in a `caller` session) must still satisfy
  the callable's intrinsic or Policy branch.
- For a human-principal session, inspect the human's effective group profile instead. Domain requirements
  do not grant that human authority, and a missing direct User capability is not a reason to duplicate
  rights already supplied through `extends_with`.
- `kernel.auth.register(...)` requires `K.functions.register` and must independently satisfy
  its credential, target, and graph/Schema admission. Select the `caller` or `self` session explicitly; a Schema
  dependency is not a capability, and granting the human rights is not Domain-owned execution.

```ts
import { method, policy } from '@astrale-os/sdk/schema'
import { z } from 'zod'

import { manages } from './relationships.js'

export const managesProject = policy({
  description: 'The caller manages this Project.',
  match: ({ edge, subject, object }) =>
    edge({ source: subject, class: manages, target: object }),
})

export const rename = method({
  auth: 'authorized',
  input: z.object({ title: z.string() }),
  output: z.boolean(),
  policy: ({ check, self }) => check(managesProject, self),
})
```

- Runtime dispatches `Project.rename` as an Action or Workflow. Its context facilities are not a second
  authorization decision; handler code must not replace Kernel admission with a role lookup.

## Groups: `subject` is the caller's composition

The caller's composition is the caller and every Identity it reaches through `extends_with` (group
membership; Shell `Group.assignMember` writes it, see `users.md`), at any depth. `constrained_by` caps
an Identity: its constraint must satisfy the Policy too. `excluded_from` vetoes: whatever the excluded
Identity satisfies is refused to the caller, even when the caller holds it itself or through another
group. Kernel decides each Policy for every Identity of that composition, so `subject` already means
"the caller or any of its groups".

- State a fact a group holds as one Edge from or to `subject`. Never walk `extends_with` (one hop or a
  `repeat`) or Shell's `member_of_group` from `subject`: the walk reads raw Edges, skips the constraints
  and exclusions of the groups it crosses, and spends a leaf and a variable of the branch budget.
- Check membership in a fixed group against that group: `check(extendsGroup, ref(group))`, with
  `extendsGroup` matching `sameNode(subject, object)`. Keep the group a fixed `ref`: the composition
  includes the caller itself, so an input object admits any caller passing its own id.
- One Identity satisfies a whole Policy branch. When two facts may come from different groups, such as
  a Role from one Team and the management of a Project from another, write one check per fact: each check
  tries the whole composition on its own.

```ts
// Wrong: re-walks the composition by hand and skips its constraints and exclusions.
export const extendsGroupManagingProject = policy({
  match: ({ allOf, edge, exists, object, subject }) =>
    exists(({ node }) => {
      const holder = node()
      return allOf(
        {
          source: subject,
          class: K.classes.extends_with.ref,
          target: holder,
          repeat: { min: 0, max: 2 },
        },
        edge({ source: holder, class: manages, target: object }),
      )
    }),
})

// Right: the caller or any group it belongs to manages the Project.
export const managesProject = policy({
  match: ({ edge, object, subject }) => edge({ source: subject, class: manages, target: object }),
})

// The caller is the group or a member of it, at any depth.
export const extendsGroup = policy({
  match: ({ object, sameNode, subject }) => sameNode(subject, object),
})

// Only members of a Core Group (`superadmins`) observe the Class; a read that is not `true` also
// needs `traverse`.
policies: {
  read: ({ check, ref }) => check(extendsGroup, ref(superadmins)),
  traverse: ({ check, ref }) => check(extendsGroup, ref(superadmins)),
},

// Two facts, possibly from two groups: one check each.
// In an authorized Function or Method:
policy: ({ allOf, check, input, ref }) =>
  allOf(check(extendsGroup, ref(editors)), check(managesProject, input.project)),
// In a Node Class:
policies: {
  read: ({ allOf, check, ref, self }) =>
    allOf(check(extendsGroup, ref(editors)), check(managesProject, self)),
},
```

## Reuse without changing what is checked

- Named `policy.allOf(...)` / `policy.anyOf(...)` composition and callable `check(...)` accept only exact local
  named Policy refs; cycles and foreign named Policy refs are rejected. A dependency's presence does not make
  its named Policy locally composable or callable-checkable.
- Inside a match or callable object expression, `ref(...)` may name a projected Class, Function, Policy, View,
  or Core node from the local Domain or an exact direct dependency. Referencing a dependency Policy this way
  compares or traverses its projected graph node; it does not evaluate that Policy.
- Method refs require a compatible SDK/DSL: `ref(methodHandle)` or `ref(() => methodHandle)` names an
  exact executable declaring Method, static or instance, including `abstract: true` on a concrete
  Class. Contract-only Methods on abstract Classes and inherited aliases are not Function projections; reference the executable declaration from the local or direct-dependency owner.
- Every normalized branch must use exactly one target mode. A Node-Policy branch references `object`; an
  Edge-Policy branch references `source`, `target`, or both. The `subject`, every referenced protected term,
  and every scoped existential variable must form one connected proof graph. A branch saying only “caller
  belongs to a group” is not resource-scoped and rejects; check membership instead (see Groups).
- Query admission separately verifies the candidate's exact Edge Class, then evaluates its Policy against
  the admitted `source` and `target`. Constrain whichever endpoint owns access. A Policy Edge predicate is an
  existence test; do not use it as a surrogate identity check for the candidate Edge.

- Each `check(policy, object)` evaluates one Policy against one protected object. Checks on `self` and input
  refs are independent requirements, not a relationship between those objects; use callable `sameNode(...)`
  for exact Node equality.
- Every way callable checks or a Class rule can hold must pass through a `check`: `sameNode` compares two
  objects and names no caller. `sameNode(self, input.target)` alone, or as one `anyOf` branch, is refused
  (`PL_CONNECTIVITY`); put it in an `allOf` beside a `check`. An Identity acting for itself is decided by these
  checks alone, so a branch that names no caller would admit everyone.

## Composition consumes a budget

- Budgets apply after named-policy expansion and branch normalization, not per helper file.
  AND multiplies alternatives: `(A OR B OR C) AND (D OR E OR F)` creates 9 branches, over the current limit of 8.
- Current DSL limits include expanded pattern depth 4, 6 Edge-or-`sameNode` predicate leaves per normalized
  branch, 4 variables per `exists`, integral repetition bounds `0 <= min <= max <= 3`, and 4 distinct Domain
  origins including the Policy's own Domain. Callable checks also cap depth at 4 and leaves/branches at 8.
- Refactoring into named helpers does not reset those budgets. Simplify the actual proof topology
  when `PL_BUDGET` rejects; do not move authorization into a handler or drop an alternative to compile.
- These are Schema admission ceilings, not guaranteed runtime scan capacity. Verify the installed
  DSL's limits before relying on a boundary value. The caller's group ancestry needs no repeat (see
  Groups); a repeat from any other term still stops at its bound.

## Scope existential Node witnesses deliberately

- Policy Node selectors define authorization scope, not types. `node()` accepts any matching active concrete
  Node Class; `node(Class)` also accepts its active concrete descendants, including foreign ones;
  `node.exact(Class)` accepts only that exact concrete Class and is empty for an abstract Class.
- `node.exact(Class)` does not test Node identity; use `sameNode(...)`. Test every intentionally broad selector
  with an allowed witness and a connected unauthorized witness; include a descendant for polymorphic success.

## Policy and admission evidence

- Root success proves executability, not an application user's Policy. Test distinct registered principals
  with real business facts; a local CLI identity need not be registered or authorized on the target Kernel.
- Test credential failure, principal-profile denial of a delegation, inherited Group capability
  success, a direct caller admitted by the Policy alone, and business Policy denial despite valid
  principal `can_use`. Keep Root/owner alternatives out of a test claiming Policy enforcement.
  For denials, prove reachable handlers, steps, Providers, and graph effects did not run; earlier Runtime
  initialization is outside that assertion.
- Inspect requested/materialized capabilities for Domain principals and live group composition for human
  callers. Prove the caller's authority independently, including relevant constraints, exclusions, and
  revocation.
- Keep evidence proportional: mutating denial needs an independent no-effect read, read-only denial does not.
  Test revocation by removing the business fact and repeating the same operation while the Domain stays installed.
