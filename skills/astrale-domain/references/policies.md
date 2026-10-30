# Policies

- **Kernel-decided**: admission is decided by the Kernel on the pinned installation before the
  handler runs. A handler never re-decides it (no Role lookup, no ownership check in code).
- **Two independent decisions**: callable admission (may the caller invoke this Function or Method)
  and graph access (may the caller read, traverse or write this Node or Edge). Admission to
  `Project.rename` grants no Query or Mutation access to Project Nodes; a permitted read proves
  nothing about invoking a Function on the record.
- **Caller-centric**: a Policy's `subject` is the caller and its composition (Groups), never the
  executor (`authority.md`).

## Callable authentication

| `auth` | Credential | Caller rule |
| --- | --- | --- |
| `anonymous` | optional; a supplied one is authenticated and its failure propagates, never falling back to anonymous | none; without a credential the handler acts as the Domain alone (`authority.md`) |
| `authenticated` | required | none: every authenticated Identity passes |
| `authorized` | required | `policy`, required by the SDK: checks, `true` or `false` |

A protected operation is `authorized`, even when its handler only touches Domain-owned data.

## Callable admission

An `authorized` call is decided twice:

1. **Caller rule**, on the caller alone: Root, exact Function ownership, or the `policy`. `false`
   admits Root and the owner only; `true` admits every caller. A Role or scope the caller holds
   bypasses nothing: a Role admits only where a Policy checks it.
2. **Executor ceiling**, only when a non-Root executor acts for another caller: the executor holds
   `scope_call` toward the Function (Requirements), owns it exactly, or itself satisfies its
   `policy`. A `true` policy needs no ceiling. A group the executor extends may supply the scope.

The caller never raises the executor's ceiling; the executor's authority never enters the caller's
rule. An Identity acting for itself delegates nothing: its rule alone decides.

- The ceiling is the calling executor's, never that of the callee Domain running the handler.
- Exact Method ownership follows the Method's executable declaring installation, never a business
  `ownedBy` Edge. An instance Method's receiver is of its exact declaring Class.
- A Root executor acting for a caller meets no ceiling; its caller is still decided. A Root caller
  carried by a Domain session passes the caller rule, never the executor's ceiling.
- A Kernel syscall's Policy admits its Kernel Role's members (Requirements): under `caller`, the user
  needs the Role and so does the Domain, as its ceiling. Resource checks inside the syscall are
  separate.

## Class Policies

`policies: { read, traverse, create, update, delete }`, one rule per slot, local to a concrete Class
and never inherited; an abstract Class declares none. The SDK requires `read`, and `traverse`
whenever `read` is not `true`. `true` on `read`/`traverse` and `false` on `create`/`update`/`delete`
spell the absent slot. Checks are built from `({ check, self, ref, allOf, anyOf, sameNode })`, `self`
being the Node, or the Edge in an Edge Class rule.

| Slot | Accepts | Absent |
| --- | --- | --- |
| Node `read`, `traverse` | a Policy, `false`, or checks over `self` and `ref` members | every caller |
| Edge `read`, `traverse` | a Policy or `false` | every caller |
| `update`, `delete` | a Policy, `true`, or checks over `self` and `ref` members | the owning Domain only |
| Node `create` | `true`, or checks over `ref` members only (no `self` yet) | the owning Domain only |
| Edge `create` | a Policy, `true`, or checks over `self`, the Edge | the owning Domain only |

**Write slots stay absent.** Every write is a Function of the owning Domain writing
`{ as: 'executor' }`, which passes by installed ownership; the Function's `policy` decides the user.
Declare `create`, `update` or `delete` only for a cross-Domain write the developer explicitly asks
for: another Domain, or its users under `caller`, writing the Class directly.

- On a Class, the caller passes as Root, by installed ownership of the Class, or by the slot's rule,
  never by a scope. An executor acting for another caller also meets its ceiling: `scope_<op>`
  toward the Class, ownership, or the slot's rule itself. An open rule (`true`, or an absent
  `read`/`traverse`) admits every caller and executor without a ceiling.
- A scope bounds only what its holder does for others. "This group reads every Node" is a check on
  the group in the rule, never a scope.
- The syscall's Role still applies (`graph.reader` to query, `graph.writer` to mutate). The View
  boundary: `views.md`.
- A write slot does not evaluate observation: a guard on a target also needs the target's `read`.
- `read` permits traversal; `traverse` alone permits no Property read. A restricted `read` beside an
  open `traverse` leaves the Node reachable by every caller.

```ts
import { classIcon, nodeClass } from '@astrale-os/sdk/schema'
import { Folder } from '@astrale-os/sdk/schema/icons'

export const Project = nodeClass({
  icon: classIcon.lucide(Folder),
  policies: { read: managesProject, traverse: managesProject },
  // `create`, `update`, `delete` absent: users write through Project's Methods
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

- A Role is an Identity: Kernel-owned, a dependency's, or the Domain's own. Its `members` extend it
  and hold what it holds; its `granters` may grant and revoke its membership. A holder is `'domain'`
  or one of the Domain's own Core Identities. Joining a Role the Domain does not own requires Root
  or a granter.
- Syscall → Role: `query` `graph.reader`, `mutate` `graph.writer`, `download` `blob.reader`,
  `upload` `blob.writer`, `install` `domain.installer`, `uninstall` `domain.uninstaller`, `journal`
  `journal.reader`, `register` `identity.registrar`, `Identity.whois` `identity.resolver`,
  `Identity.impersonate` `identity.impersonator`.
- Kernel definition reads by Role: Class, Function, Policy, `extends`, `governed_by` by
  `domain.reader`; View, `entrypoint` by `view.reader`; Execution, `created_by` by
  `execution.reader`; Roles and composition, scope and meta-authority Edges by `authority.reader`.
- Bundles hold one family (`graph.manager`, `blob.manager`, `domain.manager`, `identity.manager`,
  `execution.manager`); profiles nest `reader` ⊂ `writer` ⊂ `admin`. `identity.impersonator` is in
  no bundle. Ask for the narrowest Role.
- A scope names a direct dependency's callable (`['call']`) or Class (`create`, `read`, `traverse`,
  `update`, `delete`). It never admits a caller; the Domain's own write on a foreign Class is
  decided by that Class's write rule. A Core Identity holds no scope. Installation poses a scope
  toward another installed Domain's target; a scope toward a Kernel target requires Root.
- Each foreign Function or Method the Domain invokes, Shell's included, needs a `call` scope. It is
  only the Domain's ceiling: the caller (the Domain under `self`, the user under `caller`) still
  passes the callable's rule. Requirements grant a human caller nothing; a right a group supplies
  through `extends_with` needs no direct copy.
- `kernel.auth.register(...)` admits a caller that extends `identity.registrar`, directly or through
  `identity.manager` or `admin`: declare that membership for the Domain; under `caller` the user
  needs it too. Register then verifies the credential evidence and needs `update` authority on each
  target's exact Class. Select the session explicitly; a Schema dependency grants nothing.
- Users, registration and membership: `users.md`. Business graph ownership never justifies a shadow
  User or a manual write to Shell's membership/authority pair.

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

## Writing a Policy

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

- Name a Policy as the sentence its subject completes, in the Domain's words: a verb, each business
  entity crossed in order, the object last (`managesProject`, `managesWorkspaceOfProject`). Name
  what a Kernel hop means, not how it walks: `extendsGroup` for `sameNode` against a group,
  `ownsClassOfDocument` for `of_domain` then `instance_of`. An Edge Policy names its endpoint by its
  `as` name (`ownsService`); a composition joins its operands (`managesProjectOrOwnsProject`) or
  splits into checks. Never the permission granted (`can…`, `may…`), a graph mechanics word
  (`source`, `target`, `sub`, `super`, `subject`, `object`, `caller`), or a dropped business hop. A
  check reads as a sentence: `check(managesWorkspaceOfProject, self)`.
- Each match Policy has a `description` stating the subject, the protected object or endpoints and
  the condition, naming the business relation. Reusable predicates live in the module's
  `policies/`, never `types/`; a callable's check is inline in its declaration.
- `policy.allOf(...)` / `policy.anyOf(...)` take Policy operands only, no `description`: describe
  the operands.

## Groups

`subject` is the caller's composition: the caller and every Identity it reaches through
`extends_with`, at any depth (group membership, written by Shell `Group.assignMember`: `users.md`).
The Kernel decides each Policy for every Identity of it. Domains author `extends_with` only
(`authority.md`, Composition).

- A fact a group holds is one Edge from or to `subject`. Never walk `extends_with` (one hop or a
  `repeat`) or Shell's `member_of_group` from `subject`: the walk reads raw Edges, bypasses the
  composition the Kernel decides, and spends a leaf and a variable of the budget.
- Membership in a fixed group: `check(extendsGroup, ref(group))`. Keep the group a fixed `ref`: the
  composition includes the caller, so an input object admits any caller passing its own id.
- One Identity satisfies a whole branch. Two facts that may come from different groups (edit rights
  from one Team, management of the Project from another) are two checks; each tries the whole
  composition.
- An open rule (`true`, an absent `read`/`traverse`) reads no composition. Freezing an Identity
  refuses its new invocations.

```ts
// Wrong: re-walks the composition by hand.
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

// Right: `managesProject` above holds when the caller or any of its groups manages the Project.

// The caller is the group or a member of it, at any depth.
export const extendsGroup = policy({
  match: ({ object, sameNode, subject }) => sameNode(subject, object),
})

// Two facts, possibly from two groups: one check each.
policy: ({ allOf, check, input, ref }) =>
  allOf(check(extendsGroup, ref(editors)), check(managesProject, input.project)),
```

## Composition rules

- Named `policy.allOf`/`policy.anyOf` and callable `check(...)` take only exact local named Policy
  refs; cycles and a dependency's named Policies are refused.
- `ref(...)` in a match or callable expression names a projected Class, Function, Policy, View or
  Core node of the local Domain or an exact direct dependency. `ref(dependencyPolicy)` compares or
  traverses that Policy's graph node; it never evaluates it.
- `ref(method)` / `ref(() => method)` names an exact executable declaring Method, static or
  instance, including `abstract: true` on a concrete Class. Contract-only Methods of abstract Classes
  and inherited aliases are not Function projections: reference the executable declaration of the
  local or direct-dependency owner.
- Each normalized branch uses one target mode: a Node Policy references `object`; an Edge Policy
  `source`, `target` or both. `subject`, every referenced protected term and every existential
  variable form one connected proof graph. A branch saying only "the caller belongs to a group" is
  not resource-scoped and is refused: check membership instead (Groups).
- Query admission verifies a candidate Edge's exact Class, then evaluates its Policy on the admitted
  `source` and `target`. An Edge predicate in a Policy is an existence test, never an identity test
  of the candidate Edge.
- `check(policy, object)` evaluates one Policy on one object; checks on `self` and on an input are
  independent requirements, not a relation between them. Node equality is `sameNode(...)`.
- Every branch of a callable rule or Class rule passes through a `check`: `sameNode` names no
  caller, and a branch naming none admits everyone. `sameNode(self, input.target)` alone or as an
  `anyOf` branch is refused (`PL_CONNECTIVITY`); put it in an `allOf` beside a `check`.

## Limits

Counted after named-Policy expansion and branch normalization; named helpers reset nothing.

- A Policy: ≤ 8 normalized branches, expanded pattern depth ≤ 4, ≤ 6 Edge-or-`sameNode` leaves per
  branch, ≤ 4 variables per `exists`, integral repeat bounds `0 ≤ min ≤ max ≤ 3`, ≤ 4 Domain origins,
  its own included.
- Callable checks and Node Class rules: depth ≤ 4, ≤ 8 leaves, ≤ 8 branches.
- AND distributes: `(A ∨ B ∨ C) ∧ (D ∨ E ∨ F)` is 9 branches.
- `PL_BUDGET`: simplify the proof topology. Never move authorization into a handler or drop an
  alternative to compile.
- These are Schema admission ceilings, not runtime scan capacity; check the installed DSL's limits
  before relying on a boundary value. The caller's group ancestry needs no repeat (Groups); any
  other repeat stops at its bound.

## Node selectors

- `node()`: any matching active concrete Node Class. `node(Class)`: that Class and its active
  concrete descendants. `node.exact(Class)`: that exact concrete Class; empty for an abstract one,
  and never an identity test (`sameNode`).
- Node families and Edge relations close over the Policy owner's pinned Domain closure: an
  independently installed Domain never joins it; another Domain's subclass exists only under an
  `inheritance: 'open'` Class.
- Test a broad selector with an allowed witness, a connected unauthorized witness and, for
  polymorphic success, a descendant.

## Evidence

- Root success proves executability, not a user's Policy; a local CLI Identity need not be
  registered or authorized on the target Kernel. Test distinct registered Identities with real
  business facts, and keep Root/owner alternatives out of a test claiming Policy enforcement.
- Cover: credential failure; a delegation refused for want of the executor's scope; a fact inherited
  from a group; a direct caller admitted by the Policy alone; a business denial despite the
  executor's valid scope.
- A denial proves that no reachable handler, Step, Provider or graph effect ran (earlier Runtime
  initialization excepted). A mutating denial needs an independent no-effect read; a read-only one
  does not.
- Inspect the Domain's installed Role memberships and scopes, and the live group composition of
  human callers.
- Revocation: remove the business fact and repeat the same operation, the Domain still installed.
