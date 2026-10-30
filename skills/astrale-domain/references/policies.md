# Policies

Read when declaring callable authentication or authorization, Class rules, Roles and scopes, or using
a Schema Policy.

## Authentication mode is not the authorization rule

The installed Schema declares each callable's authentication mode and optional caller rule; Kernel
Runtime evaluates them against the pinned installation state:

- `anonymous` permits an absent credential. If a credential is supplied, Runtime authenticates it and
  propagates authentication failure instead of falling back to anonymous. Without a credential the
  handler still runs with the Domain's own authority (see `runtime.md`), so the caller is granted
  nothing but what the handler does for it;
- `authenticated` requires an authenticated actor and adds no callable Policy;
- `authorized` requires an authenticated actor and is the only mode with a caller rule (`policy`), which
  the SDK requires: Policy checks, `true`, or `false`. Kernel Root acting as itself passes; every other
  call requires the caller's admission and, for a delegation, the principal ceiling, as described below.
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
caller's evaluation. An authorized Function makes two decisions:

1. The caller rule. The caller passes as Root, by exact Function ownership, or by the declared
   callable Policy. `false` leaves Root and the owner only; `true` admits every caller, excluded ones
   included. Holding a Role or a scope bypasses nothing: a Role admits only where a Policy checks it.
2. The principal ceiling, only when a non-Root principal acts for another caller. The principal holds
   `scope_call` toward the Function (see Requirements), owns it exactly, or itself satisfies its
   Policy; a `true` Policy needs no ceiling. A group the principal extends may supply the scope; the
   caller never does. An Identity acting for itself delegates nothing: its rule alone decides.

Class operations make the same two decisions (Graph access below): a delegation never exceeds what
the caller may do alone, nor what the principal's scope, ownership, or rule allows.

- The callee Domain that runs the handler never replaces the calling principal. Exact Method ownership
  follows its executable declaring installation, not a business `ownedBy` Edge; instance receivers must
  have the exact declaring Class.
- A Root principal acting for a caller meets no ceiling, but its caller is still decided. A Root caller
  carried by a Domain session passes the caller rule, never the principal ceiling.
- A Policy `subject` is the caller, not necessarily the authenticated principal, and it already covers the
  caller's groups (see Groups below).
- A Kernel syscall's Policy admits the members of its Kernel Role (see Requirements): a `caller` session
  needs it for the user and for the Domain's ceiling. Resource checks inside the syscall stay independent.

## Graph access is a separate decision

- Invoking `Project.rename` does not grant direct Query/Mutation access to Project nodes. Conversely,
  a permitted graph read is not proof that the caller may invoke a Function operating on that record.
- A Class declares one rule per operation. `true` on an observation slot and `false` on a write slot
  spell the absent slot. The SDK requires `read` on every concrete Class and `traverse` whenever `read`
  is not `true`; an abstract Class declares no Class Policies.

| Slot | Accepts | Absent |
| --- | --- | --- |
| `read`, `traverse` | a Policy, `false`, or checks over `self` and `ref` members | every caller |
| `update`, `delete` | a Policy, `true`, or checks over `self` and `ref` members | the owning Domain only |
| Node Class `create` | `true`, or checks over `ref` members only: the Node is not yet | the owning Domain only |
| Edge Class `create` | a Policy, `true`, or checks over `self`, the Edge | the owning Domain only |

- The caller passes as Root, by installed ownership of the Class, or by the slot's rule, never by a
  scope it holds. When a principal acts for another caller, it also meets its ceiling: it holds
  `scope_<op>` toward the Class, owns it, or itself satisfies the slot's rule. An open rule (`true`,
  or an absent observation) admits every caller and principal without a ceiling. The outer Query or
  Mutation gate still applies; choose the intended View boundary in `views.md`.
- A scope bounds what its holder does for others. Put "this group reads every node" in the rule
  itself, as a check on the group.
- A write slot does not evaluate observation; a Mutation condition on a target also needs that
  target's `read` rule. A Domain's `self` session on Classes it owns passes by installed ownership; a
  `caller` session decides the user by the rule. A callable initiating the write is a separate gate.
- Read also permits traversal; traversal alone does not permit property reads. A `read` other than
  `true` leaves every caller able to reach the Node until `traverse` is restricted too. Test what the
  caller can observe, not just whether one isolated `traverse` Policy matches.

```ts
import { classIcon, nodeClass } from '@astrale-os/sdk/schema'
import { Folder } from '@astrale-os/sdk/schema/icons'

export const Project = nodeClass({
  icon: classIcon.lucide(Folder),
  policies: {
    read: managesProject,
    traverse: managesProject,
    create: ({ check, ref }) => check(extendsGroup, ref(editors)), // no `self` yet
    update: managesProject, // `delete` absent: the owning Domain only
  },
})
```

## Requirements: Kernel Roles and scopes

A Domain asks its instance for authority in its Domain definition; installation poses it, and nobody
grants it by hand. `directory` is a direct dependency's resolved Schema:

```ts
import { requirements } from '@astrale-os/sdk/domain'
import { K } from '@astrale-os/sdk/schema'

requirements({
  roles: [
    { role: K.core.nodes['graph.reader'], members: ['domain'] },
    { role: K.core.nodes['graph.writer'], members: ['domain'] },
  ],
  scopes: [
    { on: directory.functions.lookup, operations: ['call'] },
    { on: directory.classes.Person, operations: ['read', 'traverse'] },
  ],
})
```

- A Role is an Identity: Kernel-owned, a dependency's, or the Domain's own. Its `members` extend it and
  hold what it holds; its `granters` may grant and revoke its membership. A holder is `'domain'` or one
  of the Domain's own Core Identities. Joining a Role the Domain does not own requires Root or a granter.
- Kernel syscalls admit their Role's members: `query` `graph.reader`, `mutate` `graph.writer`,
  `download` `blob.reader`, `upload` `blob.writer`, `install` `domain.installer`, `uninstall`
  `domain.uninstaller`, `journal` `journal.reader`, `register` `identity.registrar`, `Identity.whois`
  `identity.resolver`, `Identity.impersonate` `identity.impersonator`.
- Kernel definitions are read by Role: Class, Function, Policy, `extends`, `governed_by` by `domain.reader`;
  View, `entrypoint` by `view.reader`; Execution, `created_by` by `execution.reader`; Roles and
  composition, scope, and meta-authority Edges by `authority.reader`.
- Bundles hold one family (`graph.manager`, `blob.manager`, `domain.manager`, `identity.manager`,
  `execution.manager`); profiles nest `reader` ⊂ `writer` ⊂ `admin`. `identity.impersonator` is in no
  bundle. Ask for the narrowest Role.
- A scope names a direct dependency's callable (`['call']`) or Class (`create`, `read`, `traverse`,
  `update`, `delete`). It never admits a caller; the Domain's own write on a foreign Class is decided by
  that Class's write rule. A Core Identity holds no scope. Installation poses a scope toward another
  installed Domain's target; a scope toward a Kernel target requires Root.

| Legacy entry | Declare instead |
| --- | --- |
| `functions: [K.functions.<syscall>]` | the syscall's Role; Kernel definition reads need the reader Roles above |
| `functions: [<dependency callable>]` | `scopes: [{ on, operations: ['call'] }]` |
| `classes: [{ class, operations }]` | the same Class scope; the Domain's own write needs the Class's write rule |
| `authority: { grant, revoke }` | the Role's `granters` |
| `core: [{ subject, ... }]` | the Core Identity in the Role's `members` |

Deprecated: `can_use`, `can_read`, `can_traverse`, `can_create`, `can_update`, `can_delete`,
`canUseSyscall`, the legacy `requirements` keys above, which the SDK refuses, and `View.resolve`
(read a Domain's View Nodes instead).

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
- `policy.allOf(...)` / `policy.anyOf(...)` accept Policy operands, not description options.
  Describe the constituent match Policies; do not add unsupported metadata or duplicate patterns for a label.
- Read `users.md` for Shell User subclasses, registration, and membership. Business graph ownership
  does not justify a shadow User or manual writes to Shell's membership/authority pair.
- Declare a `call` scope on each foreign Function or Method the Domain invokes, Shell methods included.
  It meets only the Domain's ceiling: the caller (the Domain itself in a `self` session, the user in a
  `caller` session) must still pass the callable's rule. For a human principal, inspect the human's
  live group composition: Domain requirements grant the human nothing, and a right a group supplies
  through `extends_with` needs no direct copy.
- `kernel.auth.register(...)` admits a caller that extends `identity.registrar`, directly or through
  `identity.manager` or `admin`: declare that membership for the Domain, and in a `caller` session the
  user needs it too. Register then verifies the credential evidence and needs `update` authority on each
  target's exact Class. Select the `caller` or `self` session explicitly; a Schema dependency grants nothing.

```ts
import { method, policy } from '@astrale-os/sdk/schema'
import { z } from 'zod'

import { manages } from './relationships.js' // ends `manager` and `project`

export const managesProject = policy({
  description: 'The caller manages this Project.',
  match: ({ edge, subject, object }) => edge(manages, { manager: subject, project: object }),
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
  editing rights from one Team and the management of a Project from another, write one check per fact:
  each check tries the whole composition on its own.
- An open rule (`true`, or an absent observation slot) reads no composition, so no exclusion refuses it.
  Freeze an Identity to refuse its new invocations.

```ts
// Wrong: re-walks the composition by hand and skips its constraints and exclusions.
export const extendsGroupManagingProject = policy({
  match: ({ allOf, edge, exists, object, subject }) =>
    exists(({ node }) => {
      const holder = node()
      return allOf(
        edge(K.classes.extends_with, { subject, extension: holder }, { repeat: { min: 0, max: 2 } }),
        edge(manages, { manager: holder, project: object }),
      )
    }),
})

// Right: `managesProject` above; the caller or any group it belongs to manages the Project.

// The caller is the group or a member of it, at any depth.
export const extendsGroup = policy({
  match: ({ object, sameNode, subject }) => sameNode(subject, object),
})

// Two facts, possibly from two groups: one check each, in a callable as in a Class rule.
policy: ({ allOf, check, input, ref }) =>
  allOf(check(extendsGroup, ref(editors)), check(managesProject, input.project)),
```

## Reuse without changing what is checked

- Named `policy.allOf(...)` / `policy.anyOf(...)` composition and callable `check(...)` accept only exact local
  named Policy refs; cycles and foreign named Policy refs are rejected. A dependency's presence does not make
  its named Policy locally composable or callable-checkable.
- Inside a match or callable object expression, `ref(...)` may name a projected Class, Function, Policy, View,
  or Core node from the local Domain or an exact direct dependency. Referencing a dependency Policy this way
  compares or traverses its projected graph node; it does not evaluate that Policy.
- Method refs: `ref(methodHandle)` or `ref(() => methodHandle)` names an exact executable declaring Method,
  static or instance, including `abstract: true` on a concrete Class. Contract-only Methods on abstract
  Classes and inherited aliases are not Function projections; reference the executable declaration from
  the local or direct-dependency owner.
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
  AND multiplies alternatives: `(A OR B OR C) AND (D OR E OR F)` creates 9 branches, over the limit of 8.
- The DSL limits a Policy to expanded pattern depth 4, 6 Edge-or-`sameNode` predicate leaves per normalized
  branch, 4 variables per `exists`, integral repetition bounds `0 <= min <= max <= 3`, and 4 distinct Domain
  origins including the Policy's own Domain. Callable checks and Node Class rules cap depth at 4 and
  leaves and branches at 8.
- Refactoring into named helpers does not reset those budgets. Simplify the actual proof topology
  when `PL_BUDGET` rejects; do not move authorization into a handler or drop an alternative to compile.
- These are Schema admission ceilings, not guaranteed runtime scan capacity. Verify the installed
  DSL's limits before relying on a boundary value. The caller's group ancestry needs no repeat (see
  Groups); a repeat from any other term still stops at its bound.

## Scope existential Node witnesses deliberately

- Policy Node selectors define authorization scope, not types. `node()` accepts any matching active concrete
  Node Class; `node(Class)` also accepts its active concrete descendants; `node.exact(Class)` accepts only
  that exact concrete Class and is empty for an abstract Class.
- Every Node family and Edge relation closes over the Policy owner's pinned Domain closure: a Domain
  installed independently never joins it, and another Domain's subclass exists only under an
  `inheritance: 'open'` Class.
- `node.exact(Class)` does not test Node identity; use `sameNode(...)`. Test every intentionally broad selector
  with an allowed witness and a connected unauthorized witness; include a descendant for polymorphic success.

## Policy and admission evidence

- Root success proves executability, not an application user's Policy. Test distinct registered principals
  with real business facts; a local CLI identity need not be registered or authorized on the target Kernel.
- Test credential failure, a delegation refused for want of the principal's scope, a fact inherited
  from a Group, a direct caller admitted by the Policy alone, and a business Policy denial despite
  the principal's valid scope. Keep Root/owner alternatives out of a test claiming Policy enforcement.
  For denials, prove reachable handlers, steps, Providers, and graph effects did not run; earlier Runtime
  initialization is outside that assertion.
- Inspect the Domain's installed Role memberships and scopes, and the live group composition of human
  callers. Prove the caller's authority independently, including relevant constraints, exclusions, and
  revocation.
- Keep evidence proportional: mutating denial needs an independent no-effect read, read-only denial does not.
  Test revocation by removing the business fact and repeating the same operation while the Domain stays installed.
