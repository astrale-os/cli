# Roles

Which Role each operation needs, which Roles a Domain declares, and which a person holds. Whose
authority a call uses: `authority.md`. Scopes and the rest of a release's requirements:
`policies.md`, Requirements. The Domain's own Roles, Shell accounts and groups: `users.md`.

## Model

- A Role is an Identity. Its members extend it (`member -[extends_with]-> role`) and hold what it
  holds, at any depth: a group's members hold the group's Roles.
- A Kernel Role admits Kernel operations: an `authorized` Kernel callable's Policy admits its Role's
  members, and Root. A Domain's own Role admits only what its Policies check.
- A Role admits nothing by being held alone: a Policy, Kernel or Domain, must check it.
- `whoami`, `introspect` and `can` need authentication only, no Role.

## Kernel Roles

| Role | Admits | Included in |
| --- | --- | --- |
| `graph.reader` | `query` | `graph.manager`, `reader` |
| `graph.writer` | `mutate` | `graph.manager`, `writer` |
| `blob.reader` | `download` | `blob.manager`, `reader` |
| `blob.writer` | `upload` | `blob.manager`, `writer` |
| `domain.reader` | reading Class, Function and Policy Nodes, `extends` and `governed_by` Edges | `domain.manager`, `reader` |
| `domain.installer` | `install` | `domain.manager` |
| `domain.uninstaller` | `uninstall` | `domain.manager` |
| `view.reader` | reading View Nodes and `entrypoint` Edges; the deprecated `View.resolve` | `reader` |
| `authority.reader` | reading Role properties and every `extends_with`, `constrained_by`, `excluded_from`, scope and grant Edge | `admin` |
| `identity.resolver` | `Identity.whois`: an Identity from its issuer and subject | `identity.manager` |
| `identity.registrar` | `register`: Authentication on an existing Identity | `identity.manager` |
| `identity.impersonator` | `Identity.impersonate`: a credential bounded by another Identity | none: assigned by name only |
| `journal.reader` | `journal` | `admin` |
| `execution.reader` | following any Execution; reading Execution Nodes and `created_by` Edges | `execution.manager` |
| `execution.terminator` | force-cancelling or deleting any Execution | `execution.manager` |

Bundles, each a member of the Roles it lists:

| Bundle | Holds |
| --- | --- |
| `graph.manager` | `graph.reader`, `graph.writer` |
| `blob.manager` | `blob.reader`, `blob.writer` |
| `domain.manager` | `domain.reader`, `domain.installer`, `domain.uninstaller` |
| `identity.manager` | `identity.resolver`, `identity.registrar` |
| `execution.manager` | `execution.reader`, `execution.terminator` |
| `reader` | `graph.reader`, `blob.reader`, `domain.reader`, `view.reader` |
| `writer` | `reader`, `graph.writer`, `blob.writer` |
| `admin` | `writer`, `domain.manager`, `identity.manager`, `execution.manager`, `authority.reader`, `journal.reader` |

- The reader Roles restrict reading Kernel Nodes and Edges only; the Domain's own Classes are read
  under their own Policies (`policies.md`). A Role Node is traversed by every caller; its properties
  are read under `authority.reader`.
- An Identity reads its own `extends_with` Edges without `authority.reader`; other Identities'
  compositions need it.
- The initiator and the owner Domain follow their own Executions without a Role
  (`workflows.md`, the Execution table).

## What a Domain declares

The installed Domain needs a Kernel Role for each Kernel operation its handlers make, as
`executor` or `caller`:

| The Domain's handlers | Declare membership of |
| --- | --- |
| Run a Query | `graph.reader` |
| Run a Mutation | `graph.writer` |
| Upload a blob (a blob Property) | `blob.writer` |
| Download a blob | `blob.reader` |
| Register a person (`kernel.auth.register(...)`, `users.md`) | `identity.registrar` |
| Resolve an Identity from an issuer and subject | `identity.resolver` |
| Read installed Classes, Functions or Policies | `domain.reader` |
| Read Views | `view.reader` |
| Read other Identities' memberships, scopes or grants | `authority.reader` |
| Install or uninstall Domains | `domain.installer`, `domain.uninstaller` |
| Read the Kernel journal | `journal.reader` |
| Follow, force-cancel or delete Executions it did not start | `execution.reader`, `execution.terminator` |

Almost every Domain declares `graph.reader` and `graph.writer`, as the scaffold does:

```ts
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { K } from '@astrale-os/sdk/schema'

export const domain = defineDomain({
  schema,
  runtime,
  requirements: requirements({
    roles: [
      { role: K.core.nodes['graph.reader'], members: [requirements.domain] },
      { role: K.core.nodes['graph.writer'], members: [requirements.domain] },
    ],
  }),
})
```

- Declare the narrowest Role: `graph.reader`, never `reader` for a Domain that only queries; never a
  bundle or `admin` for convenience.
- Never declare a `call` scope on a Kernel callable. The Role admits the Domain's own call and
  also bounds a call it makes for a caller, since the Kernel admits a delegated call when the
  Domain itself passes the callable's Policy. A scope toward a Kernel target installs only under
  Root.
- Under `caller`, the user needs the same Role: a `caller` Query needs a user holding
  `graph.reader`. The Domain's requirements grant the user nothing.
- A holder is `requirements.domain` (the installed Domain) or one of the Domain's own Core
  Identities. `members` extend the Role; `granters` may grant and revoke its membership afterwards.

## Installing

- A membership of a Role the Domain does not own needs an installer that may grant it: Root, or a
  granter of that Role. A Kernel Role's granters are only those a release names, so a release asking
  for a Kernel Role installs under Root unless the installer is among its `granters`.
- A membership of the Domain's own Role installs ungated.
- Shell's release names `profile.admin` granter of `reader`, `writer`, the `graph` and `blob` Roles,
  `view.reader`, `domain.reader`, `execution.reader`, `journal.reader` and `authority.reader`: a
  Shell administrator installs a release asking for those. Any other Kernel Role
  (`identity.registrar`, for one) installs under Root.
- Install itself needs `domain.installer` (`deployment.md`). An installer Domain such as Admin must
  also be a granter of every Kernel Role the Domains it installs ask for.

## What a person holds

- A person holds Roles directly or through the groups they belong to, never through a Domain's
  requirements (`users.md`). Each Shell profile holds the Kernel profile of its rank:
  `profile.guest` holds `reader` (see the graph, blobs, Domain definitions and Views),
  `profile.member` holds `writer` (also write the graph and blobs), `profile.admin` holds `admin`
  (also manage Domains, Identities and Executions and read authority and the journal).
- Opening Views in the Shell needs `view.reader` (`views.md`).
- A person calling a Domain whose handler acts as `caller` needs the Kernel Role of each Kernel
  operation it makes for them.
- Give `identity.impersonator` by name, only to an operator who needs it: no bundle includes it.

## Granting and checking

- At runtime, a granter adds a member by writing `member -[extends_with]-> role` in a Mutation,
  and removes one by deleting that Edge. The Domain owning a Role's concrete Class writes its
  memberships without being a granter (`users.md`).
- A Domain Policy checks a Role with its own `hasRole` Policy, matching `sameNode(subject, object)`:
  `check(hasRole, ref(role))` (`users.md`, `policies.md` Groups). Never re-check the Kernel Role of
  an operation in a Domain Policy: the Kernel already checked it for that operation.
- Inspect the Domain's installed memberships and scopes, and the live composition of human callers
  (`debugging.md`).
