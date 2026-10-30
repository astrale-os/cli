# Schema

A Domain exposes Classes, Functions, Policies, Views and Core data (Kernel DSL V1), authored with
the builders of `@astrale-os/sdk/schema`, never Kernel DSL/Core imports or rebuilt resolved
Definition shapes. Each declaration has one semantic owner; it models business invariants, not a
storage layout or an anticipated UI.

## Classes

- Shared object contracts are abstract Classes (`nodeClass({ abstract: true, ... })`); there is no
  interface kind. Only concrete descendants have instances.
- `inheritance` decides who may extend a Class: omitted or `'internal'`, Classes of its own Domain;
  `'open'`, also Classes of every Domain depending on it; `'final'`, none. A foreign parent (Shell
  `User`, `Group`) must be `'open'`; authoring and install refuse any other. Closing or finalizing an
  `'open'` Class is a major change; any other inheritance change is a patch. Open a Class only as a
  deliberate extension point.
- A Node Class declares an icon: `classIcon.lucide` with data from `@astrale-os/sdk/schema/icons`,
  `classIcon.svg` for custom SVG, `classIcon.neutral` for no glyph. No React icons in a Schema.
- A fact describing a relationship (role, confidence, applicability, effective date, ordering,
  coverage) is an Edge Property. Reify a relationship as a Node only for its own identity,
  lifecycle, permissions, provenance or relationships. Never a relationship hidden in string ids,
  Paths, generic JSON or a catch-all relation Class; endpoint direction and cardinality are
  explicit.
- An Edge is identified by its source, target and exact Class: a Class holds at most one Edge per
  endpoint pair. Its slug is optional locator metadata, never identity.

## Keys

Uniqueness is a key, never a guard or a pre-read:

- A Node Class lists Property tuples: `unique: [['email'], ['country', 'siret']]`.
- A directed Edge Class lists tuples over `'source'`, `'target'`, `'slug'` and `{ property }`:
  `unique: [['source', 'slug']]` makes a slug unique under its source.
- A key Property is a string, number, boolean or instant without `auto`. A tuple binds only while
  all its fields are present, and covers descendants.
- A Node key is global to its Class: uniqueness under a parent keys the parent's Edge.
- A duplicate write fails `MUTATION_POST_STATE_INVALID`, rule `duplicate-key`. Adding or removing a
  key is a major change.

## Edge lifetimes

Each Edge endpoint declares or derives what deleting its Node does:

| `onDelete` | Deleting the endpoint's Node |
| --- | --- |
| `'restrict'` | requires the same transition to delete the Edge explicitly |
| `'detach'` | deletes the Edge with the Node |
| omitted | `'detach'` when the endpoint can hold another Domain's Node (it accepts a foreign Class, an own `'open'` Class, or an own Class an own `'open'` Class extends); `'restrict'` otherwise |

- An endpoint that can hold another Domain's Node cannot declare `'restrict'`.
- An Edge Class with an endpoint requiring an Edge (`'1'`, `'1..*'`) declares no `'detach'` and no
  endpoint that can hold another Domain's Node.
- A subclass keeps its parent's lifetimes.
- Uninstalls and Schema transitions follow them: a restricting Edge at a leaving Node refuses with
  `DATA_MIGRATION_REQUIRED` (`restricted-deletion`).

## Properties

- Inherited native Node Properties are reused, never redeclared; timestamps and identities use the
  SDK's canonical types.
- `property(schema, { immutable: 'create' })` accepts a value only at creation;
  `property(schema, { required: false, immutable: 'once' })` also accepts one later write while the
  value is absent (a blob attached after creation). Neither is changed or unset afterwards: only
  deleting the element drops it. A rewrite is refused `MUTATION_PROPERTY_IMMUTABLE`; a second or
  concurrent `once` write fails its absence precondition, `MUTATION_PRECONDITION_FAILED`. Never with
  `auto(...)` or `stateProperty(...)`; a `once` Property is never required. Changing the option on an
  existing Property breaks dependents.
- One exported `stateMachine` owns a finite lifecycle: persisted with `stateProperty(machine)`,
  reused through `machine.stateSchema` and `machine.eventSchema` in callable values, never copied
  into sibling enums or transition Rules.
- Node identity is canonical and opaque: presentation text, serving URLs and caller-assigned Paths
  are not identifiers.

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

## Layout

- `schema/modules/<module>/` with the applicable `classes/` (Node and Edge), `policies/`,
  `functions/` (Methods and top-level Functions), `errors/`, `types/`, `states/`, `core/`, `views/`;
  no empty directories. One declaration per file, curated facades; root kinds only for genuinely
  shared declarations.
- `types/` owns portable values, never Policies. A callable's
  `policy: ({ check, self }) => check(managesProject, self)` stays inline; reusable graph predicates
  live in `policies/`.
- Composition types are inferred from authored values, not an interface repeating Schema fields.
  Never cast away a published-declaration or admission problem.

## Methods

- Behavior lives on the Class whose invariant changes: a Method when an existing Node is the
  subject of the change, a top-level Function for a Domain operation without a receiver.
  Staticness is Schema metadata; Runtime implements every callable as an Action or a Workflow.
- Only abstract Method obligations are inherited. `abstract: true` on a Method requires every
  concrete descendant to declare a matching Method locally.
  A concrete Class can declare `abstract: true` and must provide its own Action or Workflow; that
  Method may have its own Policy. On an abstract Class, an abstract Method is a contract only, with no handler or Policy.
  An intermediate `abstract: false` implementation keeps the obligation for later concrete
  descendants.
- Instance Methods require an instance of their exact declaring Class; static Methods also stay on
  that Class. Parent handlers and Policies are never inherited; Properties and structural Class
  relationships are. Resolved `methods` collections hold local declarations: inspect `extends` for
  ancestor contracts. Use `method.executable` to identify local callables, independently of
  `method.abstract`.
- Shared handler logic is an ordinary function; each exposed Method and its Policy are declared on
  their Class. Composition over inheritance when the relation is not "is-a".
- A callable answers a value (a schema), a value stream (`output.stream(item)`) or bytes
  (`output.binary()`). Only a Function takes bytes: `input.binary(metadata, { maximumBytes })`,
  `metadata` a value schema and `maximumBytes` an integer ≥ 1, within the target blob Property's
  `maxBytes` and the Kernel's 100 MiB blob limit when the bytes go to the Kernel. A Method takes a
  value, so a Function receiving a file names its target Node in the metadata. A durable callable
  takes and answers values only. Handler shapes: `actions.md`.

## Policies

- Authentication mode, Policies, and the Roles and scopes a release requests are distinct
  concerns; caller admission never moves into Action or Workflow code.
- A concrete Class declares `policies: { read, traverse }`; `create`, `update` and `delete` stay
  absent (the owning Domain only), writes going through the Domain's callables. An executable
  `authorized` callable declares its `policy`. Slots, admission, Roles, scopes, the Policy language
  and its budgets: `policies.md`.

## Core data

- Core holds stable Domain-owned reference facts needed right after installation, such as one
  well-known Group. Never demo data, mutable product state, a post-install hook or a migration.
- `core.node(Class, properties)` declares a Node; `core.edge(source, EdgeClass, target, properties)`
  an Edge whose endpoints are `core.domain`, a Core Node or another local Definition (a handle, a
  lazy `() => X` or its ref). The Schema lists them under `core`:

  ```ts
  import { core, defineSchema } from '@astrale-os/sdk/schema'

  export const schema = defineSchema('issues.example', {
    name: 'Issues',
    classes: { Project, Issue },
    core: { nodes: { inbox: core.node(Project, { name: 'Inbox', archived: false }) } },
  })
  ```

- A Query names it `d.core.inbox` (`queries.md`), a Dataset `ref(domain.core.nodes.inbox)`
  (`datasets.md`). A release that stops declaring a Core Node deletes it, within the bounds of
  `migration.md` (Uninstalling a Domain with data).
- A projected Core node keeps its id only while its projected Path and Class stay unchanged; a Class
  change can allocate a new id. Consumers resolve the ref instead of caching an installation's id.

## Views

`view({ description? })` declares a semantic View identity of the Domain. Every View belongs to its
own Domain and opens on it; a View declaration names no Class or Node: a screen about one Node is an
internal route of the Domain frontend. Routing and the Shell handshake belong to the SDK frontend
composition (`views.md`).
