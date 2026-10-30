# Users and groups

For a Domain owning people who sign in, inviting existing business users, or assigning group access.
Shell owns the shared User/Group contract and is installed on the target instance; the business
Domain owns its concrete users and their lifecycle. Shell surface used here: static `User.invite`,
`Group.assignMember`/`unassignMember`, registration of existing nodes; check the installed contracts
with `astrale introspect` and upgrade dependencies per `migration.md`.

## One business user, three separate transitions

```text
create Employee extends Shell.User → same node, without Authentication
  ├─ invite through Shell → invitee signs in → Admin registers their own proof → assures Core member
  └─ register directly with user proof → explicitly assign the intended groups
```

- Extend `Shell.User` for a sign-in-capable person; never a second Shell User beside Employee.
  Contacts need not be identities. Business properties go on the concrete subclass.
- Create through the Domain's ordinary Mutation, without `iss`/`sub`. Register only attaches
  Authentication to that node: it creates no person, changes no profile, assigns no group.
- Shell.User declares no `displayName` or `email`. Profile email is not authentication evidence;
  editing it changes no bound identity; the invitation destination is a separate argument.

## Allow Shell to traverse the membership endpoints

Shell maintains membership with its own authority. Grant `traverse` (not `read`) on each concrete
User and Group Class. Keep `read` your business rule: an absent or `true` `read` admits every
caller, traversal included. An inaccessible endpoint must not look like absent membership. Covers
direct subclasses of Shell.User/Group only; deeper inheritance needs a verified pattern.

```ts
import { ShellSchema, S } from '@astrale-domains/shell'
import { K, KernelSchema, classIcon, defineSchema, nodeClass, policy } from '@astrale-os/sdk/schema'
import { UserRound, Users } from '@astrale-os/sdk/schema/icons'
import { z } from 'zod'

// schema/policies/owns-user-or-group-class.ts
export const ownsUserOrGroupClass = policy({
  description: 'Shell may traverse instances of our direct User/Group subclasses to maintain membership.',
  match: ({ allOf, anyOf, edge, exists, object, ref, sameNode, subject }) =>
    exists(({ node }) => {
      const memberClass = node()
      const userOrGroupClass = node()
      return allOf(
        edge(K.classes.instance_of, { instance: object, class: memberClass }),
        edge(K.classes.extends, { sub: memberClass, super: userOrGroupClass }),
        edge(K.classes.of_domain, { member: userOrGroupClass, domain: subject }),
        anyOf(
          sameNode(userOrGroupClass, ref(S.classes.User.ref)),
          sameNode(userOrGroupClass, ref(S.classes.Group.ref)),
        ),
      )
    }),
})

// schema/modules/employee/classes/employee.ts
export const Employee = nodeClass({
  icon: classIcon.lucide(UserRound),
  extends: [S.classes.User],
  properties: { employeeNumber: z.string().min(1) },
  policies: { read: readsEmployee, traverse: ownsUserOrGroupClass },
})

// schema/modules/team/classes/team.ts
export const Team = nodeClass({
  icon: classIcon.lucide(Users),
  extends: [S.classes.Group],
  policies: { read: readsTeam, traverse: ownsUserOrGroupClass },
})

// schema/schema.ts
export const schema = defineSchema('work.example', {
  name: 'Work',
  dependencies: { kernel: KernelSchema, shell: ShellSchema },
  classes: { Employee, Team },
  policies: { ownsUserOrGroupClass, readsEmployee, readsTeam },
})
```

- The Policy identifies Shell by protected Schema ownership, never a configured NodeId.
  Parent-Class Policies do not replace the concrete foreign Class's traversal agreement.
- Keep existing traversal: `policy.anyOf(existingTraverse, ownsUserOrGroupClass)`; never broaden
  `read`.

## Invite or register, without substituting the identity

| Path | Consumer does | Completion |
| --- | --- | --- |
| Invitation | static `Shell.User.invite({ user, email })` on the existing User | at the invitee's sign-in, Admin registers their own proof and assures Core member |
| Direct register | submit valid self or external user proof for the existing node | Authentication only; group assignment is separate |

- Register needs real user proof valid for the target Kernel; never an email, a freely supplied
  `(iss, sub)` or an administrator's credential. Never pass private keys into a Function.
- Authentication is write-once; `(iss, sub)` is unique per Kernel. Never self-register a node as a
  temporary step before WorkOS registration.
- Retry with the same node and registration key; never create another person after an uncertain
  result. A new equivalent proof refreshes credentials without changing the identity.
- Invitation `accepted` is not access: `completed` follows registration and member assignment. A
  login never recreates revoked membership; invitation implies no admin or Fleet access.

## Use Shell's group operations

- `Group.assignMember({ member, group })` maintains both `member_of_group` and Kernel
  `extends_with`; `unassignMember` removes both. `member`: a Shell.User or Shell.Group, concrete
  descendants included; a Class extending only Kernel.Identity is not a membership endpoint. Never
  write one Edge alone or a parallel membership system.
- Both group methods share one Policy: the caller administers a concrete Shell-owned Group, or owns
  the concrete Class of the target Group (so the Group-Class owner assigns its Teams). Owning the
  member's User Class grants no assignment to Core `member` or `admin`.
- `User.invite` checks the User: its Class owner, or Shell administrators for concrete Shell-owned
  Users. Instance administration alone does not authorize foreign Classes.
- Core `admin` and `member` are independent groups, no hierarchy. Registration grants neither; an
  admin assignment is privileged, never default onboarding.
- A Team holds no Role by default. Installation makes only the Domain and its own Core Identities
  members of Roles, never dynamic groups or users.
- Unassigning removes that direct pair only, not Authentication or other access paths. Memberships
  may precede registration; removing `member` is not a ban on owner-authorized readmission.

Shell's three methods decide their caller by their Policy. Declare a `call` scope on each one the
Domain invokes (`{ on: S.classes.Group.static.methods.assignMember, operations: ['call'] }`): it
meets only a delegation's ceiling and bypasses no Policy. Hold the Kernel Roles your handlers need
(`graph.reader`, `graph.writer`, `identity.registrar`); protect the business callable before it
invokes Shell (`policies.md`).

`dependencies.shell.caller.invoke(...)` acts for the incoming caller;
`dependencies.shell.self.invoke(...)` acts as the Domain (e.g. assigning to its own Team: Shell's
Policy then decides the Domain, as owner of the Team's Class). No default `invoke`, no mode
combining both.

## Inspect and exercise the installed surface

Static Shell methods, not `@user::invite` or instance Group methods. Inputs are exact `@NodeId`
references; group methods return `{}`. Resolve Core `member`/`admin` on the target instance (an
administrator finds both among their own memberships); never send labels or IDs from another
Kernel.

```sh
astrale introspect /:shell.astrale.ai:class.User:invite -i staging --as operator
astrale introspect /:shell.astrale.ai:class.Group:assignMember -i staging --as operator
astrale call /:shell.astrale.ai:class.User:invite \
  user=@employee-id email=alice@example.com -i staging --as operator
astrale call /:shell.astrale.ai:class.Group:assignMember \
  member=@employee-id group=@team-id -i staging --as operator
```

Instance administrator: an existing administrator assigns the user to Core `admin` once the
Invitation is `completed`; invitation never does. `astrale instance invitation status` reports
`user`, the Shell User Admin reserved on the Instance that the accepting account registers onto.
`unassignMember` with the same input revokes it; the user keeps Core `member`.

```sh
astrale instance invitation status @invitation-id --json
astrale query @self --edge /:shell.astrale.ai:class.member_of_group -i staging --as operator
astrale call /:shell.astrale.ai:class.Group:assignMember \
  member=@user-id group=@administrators-id -i staging --as operator
```

Local-key testing registers the existing Employee node; never create another node for credentials:

```sh
astrale identity create alice
astrale identity register alice --node @employee-id -i staging \
  --via /:work.example:function.registerEmployee
astrale get @self -i staging --as alice --json
```

- Register through the Domain's registration Function (`--via`): it owns the authorization, and its
  Domain holds `identity.registrar`. Without `--via`, the CLI caller registers directly and needs
  `identity.registrar` plus admission of the Authentication `node.update` on the node, for executor
  and caller; an absent `update` slot admits the owning Domain only. Never add an `update` rule to
  admit registration; no public registration wrapper, no enrollment callback for invitation.
- Verify the same User ID before and after activation, both membership Edges, and one allowed and
  one refused business call. Shell traversal must work without exposing private profile properties.
  Mocks and local identities prove no WorkOS acceptance or installed access.
