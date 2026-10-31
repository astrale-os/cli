# Accounts, groups and roles

Read when a Domain has people who sign in, creates or invites their accounts, groups them into teams,
or decides what they may do. Shell owns every person's account and the shared groups; the Kernel owns
composition and Roles; your Domain owns its business record, its Roles and its business groupings.

## The model

- **One account per person.** Shell `User` is the account and Shell `Group` a set of accounts and
  groups. Both are Shell Classes your Domain does not extend; only Shell methods write them.
- **Authority comes only from Roles.** A Role is a Kernel Identity (`K.classes.Role`): whoever
  extends it, directly or through groups at any depth, holds what it holds. `extends_with` is the
  only composition: account → group, group → group, account or group → Role.
- **Your Domain links, it does not inherit.** Its record of a person (an Employee) is an ordinary
  Class linked to the account by its own Edge, and its Policies test its own Roles.
- **Profiles.** Shell gives each person one of `profile.guest` (reads what Domains let it read,
  lands on its Views), `profile.member` (the workspace, sees accounts and groups) or
  `profile.admin` (manages accounts, groups, Roles and Domains, and grants Roles). The atomic Shell
  Roles a Domain may ask for are `user.reader`, `user.writer`, `group.reader` and `group.writer`.
- **Directory.** An external directory (Entra ID through WorkOS) may provide accounts and groups.
  It writes no Role and no business record, and your Domain code is the same with or without it.

## Prerequisites

A Shell release that declares the Shell `Role` Class and the `profile.*` Core Roles, and an SDK whose
`requirements` from `@astrale-os/sdk/domain` accepts `roles` and `scopes` (its
`docs/requirements.md` describes them). Naming a dependency's Core Identity as a holder (K1 below)
also needs a Host Kernel with K1 and an SDK on that Kernel cohort. Check the installed Shell
callables with `astrale introspect` before calling them.

## Wire a Domain

| Rule | What your Domain does |
| --- | --- |
| P1 | The business record is a Class of the Domain, not an Identity. A Domain Edge links it to `S.classes.User`. |
| P2 | "It is me": the record points to the subject through that Edge. |
| P3 | Its Roles are Core nodes of its own final `Role` Class, which declares its read (R7). Policies test them with `check(hasRole, ref(role))`, at any depth. |
| P4 | It creates accounts with `S.User.create`, invites with `S.User.invite`, deactivates with `S.User.deactivate`. Its release asks for `user.writer`. |
| P5 | A business grouping that confers rights (a Team) is an Identity of the Domain. Its members are Shell accounts or groups; it holds Roles and carries business Edges. |
| P6 | Every composition the Domain ships (a Team holding a Role, the Domain or a dependency's Identity holding one of its Roles, its Team holding a dependency's Role) is a binding of its release, never a Core Edge and never a bootstrap function. |
| P7 | Its release names Shell `profile.admin` granter of each of its Roles (K1): an admin grants them from the Shell Roles screen and installs Domains that ask for them. |

Each Domain declares its own `hasRole`: `check()` accepts only local Policies, so Shell's `hasRole`
cannot be checked from your Schema. A Core Edge toward a Role is refused too (`DV_CORE_EDGE_CLASS`:
`extends_with` is a Kernel Class), which is why P6 compositions are release bindings: the Kernel
projects the same `extends_with` at install.

This combined example stands for separate Schema owner files; imports between them are abbreviated.

```ts
import { S, ShellSchema } from '@astrale-domains/shell'
import type { NodeClass } from '@astrale-os/sdk/schema'
import {
  K,
  KernelSchema,
  classIcon,
  core,
  defineSchema,
  edgeClass,
  method,
  nodeClass,
  policy,
} from '@astrale-os/sdk/schema'
import { IdCard, ShieldCheck, Users } from '@astrale-os/sdk/schema/icons'
import { z } from 'zod'

// schema/policies/has-role.ts: the Kernel meaning, declared locally.
export const hasRole = policy({
  description: 'The caller holds this Role: it is the Role or extends it, at any depth.',
  match: ({ object, sameNode, subject }) => sameNode(subject, object),
})

// schema/modules/role/classes/role.ts: final; a Class inherits no Policy, so it declares its read.
export const Role = nodeClass({
  icon: classIcon.lucide(ShieldCheck),
  inheritance: 'final',
  abstract: false,
  description: 'A Role the Employees Domain declares.',
  extends: [K.classes.Role],
  policies: {
    read: ({ anyOf, check, ref, self }) =>
      anyOf(check(hasRole, ref(K.core.nodes['authority.reader'].ref)), check(hasRole, self)),
    traverse: true,
  },
})

const role = (name: string) =>
  core.node((): NodeClass => Role, { [K.classes.Named.properties.name.key]: name })

export const roles = {
  administrator: role('administrator'),
  reader: role('reader'),
  worker_operator: role('worker_operator'),
}

// schema/modules/employee/classes/employee.ts: the business record, not an Identity.
export const Employee = nodeClass({
  icon: classIcon.lucide(IdCard),
  extends: [K.classes.Named, K.classes.Timestamped],
  properties: { email: z.string().email(), employeeNumber: z.string().min(1) },
  policies: {
    read: ({ anyOf, check, ref, self }) =>
      anyOf(check(hasRole, ref(roles.reader)), check(signsInAsEmployee, self)),
    traverse: true,
  },
})

// schema/modules/employee/edges/holds-account.ts: deleting the account keeps the record.
export const holds_account = edgeClass.directed({
  inheritance: 'final',
  abstract: false,
  description: 'The Shell account this Employee signs in with.',
  source: { as: 'employee', accepts: [Employee], outgoing: '0..1', onDelete: 'detach' },
  target: { as: 'account', accepts: [S.classes.User], incoming: '0..1', onDelete: 'detach' },
})

// schema/modules/employee/policies/signs-in-as-employee.ts: "it is me".
export const signsInAsEmployee = policy({
  description: 'The caller is the Shell account this Employee holds.',
  match: ({ edge, object, subject }) =>
    edge({ source: object, class: () => holds_account, target: subject }),
})

// schema/modules/team/classes/team.ts: a business grouping that holds Roles.
export const Team = nodeClass({
  icon: classIcon.lucide(Users),
  extends: [K.classes.Identity, K.classes.Named, K.classes.Descriptable, K.classes.Timestamped],
  policies: { read: ({ check, ref }) => check(hasRole, ref(roles.reader)), traverse: true },
  methods: {
    setMembership: method({
      description: 'Add a Shell account or group to this Team, or remove it.',
      auth: 'authorized',
      input: z.strictObject({ member: z.string().min(1), held: z.boolean() }), // NodeId
      output: z.object({}),
      policy: ({ check, ref }) => check(hasRole, ref(S.core.nodes['profile.admin'].ref)),
    }),
  },
})

const team = (name: string) =>
  core.node((): NodeClass => Team, { [K.classes.Named.properties.name.key]: name })

export const teams = { it: team('it'), sales: team('sales'), workers: team('workers') }

// schema/schema.ts
export const schema = defineSchema('employees.example', {
  name: 'Employees',
  dependencies: { kernel: KernelSchema, shell: ShellSchema },
  classes: { Employee, holds_account, Team, Role },
  policies: { hasRole, signsInAsEmployee },
  core: { nodes: { ...roles, ...teams } },
})
```

- Test a Role with a fixed `ref`: the composition includes the caller itself, so an input Role would
  admit anyone who passes their own id. Combine a Role with a business fact as two checks:
  `allOf(check(hasRole, ref(roles.worker_operator)), check(coversAgency, input.agency))`, where
  `coversAgency` is one Edge from `subject`. The subject already covers its Teams and groups; never
  walk `extends_with` by hand (see `policies.md`).
- `Team.setMembership` writes or deletes `member -[extends_with]-> team` with a `self` Mutation: the
  Domain owns the Team Class. Guard it with an administrator check, since the Kernel admits any write
  the Team's owner makes. An admin adds a provided Shell group (`1Pact Sales`) to a Team this way,
  and its members follow the directory.
- A Shell administrator reads your data only through your Roles (R6): declare `read` on every Class
  whose nodes are not for every guest.

## Release

```ts
// domain.ts
import { S } from '@astrale-domains/shell'
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { K, schema as language } from '@astrale-os/sdk/schema'

import { schema } from '#schema'
import runtime from './runtime.js'

const own = language.resolve(schema).core.nodes
const admin = S.core.nodes['profile.admin']
const User = S.classes.User

export const domain = defineDomain({
  schema,
  runtime,
  requirements: requirements({
    roles: [
      // The installed Domain: its own Queries and Mutations, and the Shell account methods (P4).
      { role: K.core.nodes['graph.reader'], members: [requirements.domain] },
      { role: K.core.nodes['graph.writer'], members: [requirements.domain] },
      { role: S.core.nodes['user.writer'], members: [requirements.domain] },
      // Its Roles: the Team matrix (P6) and Shell admin as granter (P7, K1).
      { role: own.administrator, members: [own.it], granters: [admin] },
      { role: own.reader, members: [own.it, own.sales], granters: [admin] },
      { role: own.worker_operator, members: [own.sales], granters: [admin] },
    ],
    scopes: [
      { on: K.functions.query, operations: ['call'] },
      { on: K.functions.mutate, operations: ['call'] },
      { on: User.static.methods.create, operations: ['call'] },
      { on: User.static.methods.invite, operations: ['call'] },
      { on: User.methods.deactivate, operations: ['call'] },
      { on: User.methods.reactivate, operations: ['call'] },
    ],
  }),
})
```

- `user.writer` is installable because Shell `profile.admin` is its granter: the installer must be
  able to grant every Role the release asks for (R3). Ask `user.reader` only if the Domain reads
  accounts.
- Your Team may hold a dependency's Role (`{ role: agencies.core.nodes.reader, members: [own.it] }`),
  and a dependent Domain may name your Team member of its own Roles
  (`{ role: own.reader, members: [employees.core.nodes.it] }`). A holder is the Domain, one of its
  own Core Identities, or (K1) a Core Identity of a Domain in its dependency closure — the last only
  toward your own Roles (`A Core Identity of a dependency holds only the Domain's own Roles.`), so no
  two Domains ever declare the same membership; anything else refuses the release.
- **K1 is not everywhere yet.** `granters: [S.core.nodes['profile.admin']]` and a dependency's Team as
  member need a Host Kernel with K1, and an SDK on that Kernel cohort; an earlier SDK refuses them at
  Build with `A holder is the Domain or one of its own Core Identities.` Until both are available,
  omit those holders and grant your Roles through an admin-guarded method like `Team.setMembership`.
- Release bindings are projected again at each install: a membership removed by hand comes back.

## Processes

Creating an account, linking the record and inviting are three effects: write them as a durable
Workflow (`execution: { durable: true }` on the method, see `workflows.md`).

```ts
// functions/employee/activate.ts
export const activate = defineWorkflow<typeof schema>()(
  'Employee.activate',
  async ({ self, step }) => {
    const employee = await step.query('read-employee', employeeContact, { employee: self })
    // Idempotent on the email (U1): returns the existing account, invited or directory-provided.
    const { user } = await step.run('create-account', ({ dependencies }) =>
      dependencies.shell.self.invoke((s) => s.classes.User.static.methods.create, {
        email: employee.email,
        name: employee.name,
      }),
    )
    await step.mutate('link-account', linkAccount, { employee: self, account: user })
    await step.mutate('join-workers', joinWorkersTeam, { account: user }) // extends_with → Team workers
    await step.run('invite', ({ dependencies }) =>
      dependencies.shell.self.invoke((s) => s.classes.User.static.methods.invite, {
        user,
        profile: 'guest',
      }),
    )
    return { user }
  },
)
```

- `User.create({ email, name, givenName?, familyName? })` answers `{ user, created }`; `user` is the
  account's `@<NodeId>` Path, accepted as is by `invite`. Convert it where a Mutation takes a NodeId.
- `User.invite({ user, profile? })` grants the profile (`member` by default) and has Admin send the
  invitation to the account's email. A Domain grants `guest` or `member`; `admin` needs a caller
  holding `profile.admin` (`PROFILE_NOT_HELD`). A deactivated account is refused (`USER_SUSPENDED`):
  reactivate it first. At the first sign-in, Admin binds the verified login to the account of that
  email (U8); the Domain registers nothing.
- Deactivate on archive and reactivate on return:
  `dependencies.shell.self.invoke((s) => s.classes.User.methods.deactivate, accountId, {})`, and
  `methods.reactivate` the same way. A frozen account can no longer sign in. Shell refuses an
  account holding an administration Role (`USER_ADMINISTRATOR_PROTECTED`) and the last active
  administrator (`USER_LAST_ADMINISTRATOR`). Teams and the record stay.
- A record that never signs in (a client organization) has no account, no Role and no Identity.

## With or without a directory

A Domain does not know whether a directory runs (A5). `User.create` returns the account the
directory already provided, and the directory adopts a local account of the same email (A2): the
same activation works in both cases. The directory decides no business record: the Domain's process
creates it. To follow the directory's organization, an admin makes a provided Shell group a member of
a Team. The name and email of a provided account change only in the directory
(`USER_DIRECTORY_MANAGED`); keep business facts on your record.

## Do not

- Extend `S.classes.User` or `S.classes.Group`, or create a second account for a person.
- Make the business record, or a record that never signs in, an Identity or a Role holder.
- Write memberships from a bootstrap, `initialize` or migration function, or as Core Edges: declare
  them in the release (P6).
- Write `extends_with` toward Shell Roles or Shell groups yourself: you neither own nor grant them
  (R1). Shell groups change only through `Group.assignMember`/`unassignMember`, by `group.writer`, and
  a group that holds a Role only by an admin (G3).
- Check Shell's `hasRole`, or walk `extends_with` by hand: `subject` is already the composition.
- Register a login onto an account, or treat your record's email as the login.

## Limits

- `user.writer` covers the whole instance: a compromised Domain could deactivate any ordinary
  account. Administration Roles are protected (U4).
- A guest reads every Class that declares no `read` Policy, and every profile opens every View: a
  View is a door, its Domain's Policies still guard its data.
- The Kernel admits a membership on the owner's word alone: whoever writes into your Team gets its
  Roles. Keep Team writes behind an admin check.
- A holder of a Role's revocation can delete a membership the release projected; it returns at the
  next install.

## Inspect and exercise the installed surface

Use an authorized operator and IDs from the same instance:

```sh
astrale introspect /:shell.astrale.ai:class.User:create -i staging --as operator
astrale call /:shell.astrale.ai:class.User:create \
  email=alice@example.com name="Alice Martin" -i staging --as operator
astrale call /:shell.astrale.ai:class.User:invite \
  user=@user-id profile=member -i staging --as operator
```

Verify the same account before and after sign-in, its `holds_account` Edge, and a real allowed and
refused business call for a holder and a non-holder of each Role. Root success proves nothing about a
user's access.

## Migrating from the subclass model

Domains written before Shell Roles extend `Shell.User` and `Shell.Group`, maintain `member_of_group`
and write memberships from bootstrap functions. The previous guide is kept, deprecated, at
[legacy/users.md](legacy/users.md); do not start new work from it.

| Before | Now |
| --- | --- |
| `User`/`Group` subclasses in the Domain | Business record + `holds_account`; a Team Identity; a Domain `Role` |
| `member_of_group` | `extends_with` |
| Core groups "Administrators", "Members", "View only" | `profile.admin`, `profile.member`, `profile.guest` |
| Core group "Applications" | The Domain's Roles, by release |
| `creationKey`, `claimedEmail`, `claimedName` | Unique `email`, `name` |
| `User.recordProfile` at each sign-in | `User.updateProfile` by the account holder |
| `listEntrypoints`, `assignViews` | A Query of the visitor's composition; a Mutation on `view_access` |
| `belongsToGroup`, `administersShellClass`, `ownsClass`, `usesFunction` | `check(hasRole, ref(role))` on Shell or Domain Roles |
| `holdsIdentity` (`extends_with` walks), `administrates`/`reads`/`operates` Edges | `check(hasRole, ref(role))` |
| Self Policy on the subclass, Shell traversal Policies, registration Functions | Removed: `signsInAsEmployee`, Shell `traverse: true` |
| Bootstrap membership matrix, `Role.setMembership`, `assignMember` calls | Release bindings (P6, P7, K1); `extends_with` written by its owner |
| `requirements({ functions, classes, authority, core })` | `requirements({ roles, scopes })` |

Move a Domain in this order: declare `Role`, `hasRole` and the Core Roles and Teams; switch the
release to Roles and scopes; add the record Class and `holds_account`; migrate each person (create or
find the account, link it, delete the old Identity so the next sign-in binds the login to the account
by email, U8); then drop the subclasses. Switching a release to Roles and scopes revokes every
capability of its legacy shape, so declare everything the Domain still uses.
