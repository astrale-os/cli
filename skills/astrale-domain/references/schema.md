# Schema

Model the business world and its invariants, not a storage layout or anticipated UI. Every Class,
Edge, Policy, callable, View, and Core value has one semantic owner.

## Current language boundary

Kernel DSL V1 Domains expose Classes, Functions, Policies, Views, and Core data. Object definitions
belong to one Class hierarchy rather than parallel object-definition kinds. Domain code imports
language builders only from `@astrale-os/sdk/schema`; do not import Kernel DSL/Core directly or
recreate resolved Definition shapes.

## Classes

Use a node Class for an independently identifiable thing with properties and behavior. Use an edge
Class for a meaningful relationship between typed endpoints.

Shared object contracts use abstract Classes (`nodeClass({ abstract: true, ... })`), not a separate
interface declaration kind. Create concrete descendants, not instances of the abstract Class.

`inheritance` decides who may extend a Class: omitted, `'internal'`, only Classes of its own Domain;
`'open'`, also Classes of every Domain that depends on it; `'final'`, none. Extend another Domain's
Class, such as Shell `User` or `Group`, only when it is `'open'`; authoring and install refuse any
other foreign parent. Open a Class only as a deliberate extension point: closing or finalizing an
`'open'` Class is a major change, and any other inheritance change is a patch.

SDK-authored node Classes declare an icon: prefer `classIcon.lucide` with data from
`@astrale-os/sdk/schema/icons`, or `classIcon.svg` for custom SVG. `classIcon.neutral` explicitly shows
no glyph. Do not import React icons into Schema.

- Put a fact on a node when it describes that thing regardless of a relationship.
- Put a fact on an Edge when it describes the relationship: role, confidence, applicability,
  effective date, ordering, or coverage.
- Reify a relationship as a node only when it needs independent identity, lifecycle, permissions,
  provenance, or relationships of its own.

State endpoint direction and cardinality explicitly. Do not hide relationships in string IDs,
paths, generic JSON, or a catch-all relation Class. An Edge is identified by its source, target, and
exact Class, so a Class holds at most one Edge per endpoint pair; its slug is optional locator
metadata, never identity.

Declare uniqueness as a key, never as a guard or a pre-read. A Node Class lists Property tuples,
`unique: [['email'], ['country', 'siret']]`; a directed Edge Class lists tuples over `'source'`,
`'target'`, `'slug'`, and `{ property }`, so `unique: [['source', 'slug']]` makes a slug unique under
its source. A key Property is a string, number, boolean, or instant without `auto`; a tuple binds
only while all its fields are present and covers descendants without restating it. A Node key is
global to its Class: for uniqueness under a parent, key the parent's Edge. A duplicate write fails
`MUTATION_POST_STATE_INVALID` with rule `duplicate-key`. Adding or removing a key is a major change.

Each Edge endpoint declares or derives what deleting its Node does: `onDelete: 'restrict'` requires
the transition to delete the Edge explicitly; `'detach'` deletes the Edge with the Node. Omitted, an
endpoint that can hold another Domain's Node (it accepts a foreign Class, an own `'open'` Class, or
an own Class that an own `'open'` Class extends) detaches, and every other endpoint restricts. Such an
endpoint cannot declare `restrict`. An Edge Class with an endpoint that requires an Edge (`'1'`,
`'1..*'`) declares no `detach` and no endpoint that can hold another Domain's Node. A subclass keeps
its parent's lifetimes. Uninstalls and Schema transitions follow them: a restricting Edge at a
leaving Node refuses with `DATA_MIGRATION_REQUIRED` (`restricted-deletion`).

## Properties

Choose required versus optional from the business invariant, not fixture convenience. Reuse inherited
native node properties rather than redeclaring them. Preserve timestamps and identities through
SDK-owned canonical types.

Declare `immutable` when the business invariant forbids rewriting a value, for example a contract
file or a source digest: `property(schema, { immutable: 'create' })` accepts the value only when the
node or edge is created; `property(schema, { required: false, immutable: 'once' })` also accepts one
later write while the value is absent, such as a blob attached after creation. Neither can be changed
or unset afterwards; deleting the element is the only way to drop it. A rewrite is refused with
`MUTATION_PROPERTY_IMMUTABLE`, and a second or concurrent write of a `once` value fails its absence
precondition with `MUTATION_PRECONDITION_FAILED`. Do not combine it with `auto(...)` or
`stateProperty(...)`, and do not mark a `once` property required. Changing the option on an existing
property is a breaking schema change for dependents.

One exported `stateMachine` is the authority for a finite lifecycle. Persist it with
`stateProperty(machine)` and reuse `machine.stateSchema` or `machine.eventSchema` in callable values;
do not copy its states or events into sibling enums or transition Rules.

```ts
import { classIcon, nodeClass, stateProperty } from '@astrale-os/sdk/schema'
import { CircleAlert } from '@astrale-os/sdk/schema/icons'
import { stateMachine } from '@astrale-os/sdk/state'

export const lifecycle = stateMachine({
  initial: 'open',
  transitions: { open: { close: 'closed' }, closed: {} },
})

export const Issue = nodeClass({
  icon: classIcon.lucide(CircleAlert),
  properties: { status: stateProperty(lifecycle) },
  policies: { read: true },
})
```

Mutable presentation text is not a stable identity. Node identity is canonical and opaque; serving
URLs and caller-assigned paths are not semantic node identifiers.

## Behavior ownership

- Group declarations under `schema/modules/<module>/`, with applicable `classes/`, `policies/`,
  `functions/`, `errors/`, `types/`, `states/`, `core/`, and `views/`. Do not manufacture empty directories.
- `classes/` includes node and edge Classes; `functions/` includes Methods and top-level Functions.
  Keep one declaration per file and curated facades; reserve root kinds for genuinely shared declarations.
- `types/` owns portable values, not Policies. Keep `policy: ({ check, self }) => check(managesProject, self)`
  inline with its callable; reusable graph predicates belong in `policies/`.
- Infer composition types from authored values where possible, rather than maintaining an interface
  that repeats Schema fields. Do not cast away a genuine published-declaration or admission problem.

Put behavior on the Class whose invariant changes. A receiver-bound callable is appropriate when an
existing node is the subject of the change. Use a top-level callable for a Domain operation without a
receiver. Staticness belongs to Schema metadata; Runtime still implements the callable uniformly as an
Action or Workflow.

Only abstract Method obligations are inherited. `abstract: true` on a Method requires every concrete
descendant to declare a matching Method locally. A concrete Class can declare `abstract: true` and
must provide its own Action or Workflow; that Method may have its own Policy. On an abstract Class,
an abstract Method is a contract only, with no handler or Policy. An intermediate implementation
using `abstract: false` does not remove the obligation for later concrete descendants.

Instance Methods require an instance of their exact declaring Class; static Methods also stay on
that Class. Parent handlers and Policies are never inherited. Resolved `methods` collections contain
local declarations; inspect `extends` for ancestor contracts. Use `method.executable` to identify
local callables, independently of `method.abstract`. Properties and structural Class relationships
remain inherited. Share handler logic through ordinary functions and declare each exposed Method
and its Policy on its Class. Prefer composition when the relationship is not an “is-a” relation.

## Policies

Schema Policy owns authorization predicates. Keep authentication mode, the Roles and scopes the
release requests, and Policy as distinct concerns. Policy may refer to the caller as its subject,
receiver, Core Groups, and graph facts supported by the language. Do not move caller admission into
Action/Workflow code.

A concrete Class has five local Policy slots, never inherited: `policies: { read, traverse, create,
update, delete }`. An omitted `read` or `traverse` admits every caller, as `true` does; `false` admits
only the owning Domain acting as itself. An omitted `create`, `update`, or `delete` admits only the
owning Domain acting as itself, as `false` does; `true` admits every caller. A slot takes a named
Policy, a constant, or checks built from `({ check, self, ref, allOf, anyOf, sameNode })`, where
`self` is the Node, or the Edge in an Edge Class rule. Node `create` takes only a constant or checks
over fixed `ref` members: the Node does not exist yet. The SDK requires a concrete Class to declare
`read`, and `traverse` whenever `read` is not `true`; Edge observation takes a named Policy or a
constant. An abstract Class declares no slot. An executable `authorized` callable declares its
`policy`. Read `policies.md` for admission, Roles, and scopes.

`node(Class)` includes active concrete descendants within the Policy owner's pinned dependency
closure; a Domain that depends on the owner never joins it. It is not an exact-Class check. Use
`node.exact(Class)` to retain exact matching. Read `policies.md` for connected proofs,
direct-dependency references, and expanded-expression budgets.

## Core data

Use Core for stable Domain-owned reference facts needed immediately after installation, such as one
well-known Group. Do not use Core as demo data, mutable product state, a post-install hook, or a hidden
migration mechanism.

Reinstalling does not turn a Core declaration into an application-data migration. A projected Core
node keeps its ID only while its projected Path and Class stay unchanged; changing its Class can
allocate a new ID, so consumers should resolve the ref rather than cache an installation's ID forever.

## Views

Schema Views declare semantic view identities of the Domain: `view({ description? })`. Every View
belongs to its own Domain and opens on it; a View declaration names no Class or node. A screen about
one node is an internal route of the Domain frontend. Frontend
routing and Shell handshake belong to the SDK frontend composition, not to Class properties or
callable handlers.
