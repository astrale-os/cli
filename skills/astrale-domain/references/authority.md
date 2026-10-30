# Authority

Whose authority each call exercises. The rules deciding an Identity are in `policies.md`.

## Model

- Every party is an Identity: a user, a group, a Role, a Domain, a Function, a View.
- A call carries two Identities. The **executor**'s credential makes the call; its Kernel Roles,
  scopes and ownership are the call's ceiling. The **caller** is the one Identity whose authority
  the call exercises, a Policy's `subject`. There is no union, intersection or exclusion of callers.
- Direct call: caller = executor. Delegation: the executor is a Domain, the caller a user.
- `principal` is the executor in Kernel errors, Journal records and the handler's
  `caller.principal`. Say executor.
- A Function or Method a Domain declares executes as that Domain's installed Identity, the same for
  all its Functions. A standalone Function (a Function Node a Mutation creates as an instance of a
  Domain Class extending `Function`) registers its own credential and executes as itself.

| Surface | Executor | Caller |
| --- | --- | --- |
| CLI `get`/`query`/`mutate` on any Instance (Admin included), the Shell's own Views | the user | the user |
| A Domain's Views, the Console, a callable command (SDK Domain token exchange) | the Domain | the user |

## Selection

Every outgoing call of a handler is made by the handler's Domain; the selection names its caller:

| Selection | Caller of the outgoing call | Executor |
| --- | --- | --- |
| `{ as: 'executor' }`, `graph.self`, `kernel.self`, `dependencies.<alias>.self` | the Domain itself | the Domain |
| `{ as: 'caller' }`, `graph.caller`, `kernel.caller`, `dependencies.<alias>.caller` | the incoming caller | the Domain |

`caller.identity` is the incoming caller, `caller.principal` its executor. U → A → B: A's `caller`
call to B carries (caller U, executor A); B's `caller` call carries (U, B).

| Surface | Without a selection |
| --- | --- |
| `query(definedQuery, …)`, `mutate(definedMutation, …)` | None: a call without `as` throws |
| `kernel`, `graph` | The executor: `kernel.invoke(...)` acts as the Domain |
| deprecated V6 Query definitions and closure Mutations | The executor |
| `dependencies.<alias>` | None: `.caller.invoke` or `.self.invoke` |

## Choosing

The callable's `policy` decided the caller before the handler runs.

| The call | Selection |
| --- | --- |
| Writes the Domain's own records | `executor`: absent write slots admit the owning Domain only |
| Reads the Domain's records for the operation itself | `executor` |
| Guards an invariant over records the caller may not see (absence, count) | `executor`: a guard sees only what its authority reads |
| Answers with what the caller may see | `caller` |
| Calls a dependency so that its `policy` decides the user | `dependencies.<alias>.caller` |
| Calls a dependency as a step of the Domain's own business | `dependencies.<alias>.self` |

- A `caller` write on the Domain's own Class is refused: no write slot admits the user
  (`policies.md`, Class Policies).
- An `executor` read returns what the Domain reads. Returning it to the caller discloses it:
  deliberately only (`actions.md`, Read-only Actions).
- One handler mixes authorities per call: read as `caller` to answer, write as `executor`.
- A durable Workflow acts as its executor only: Steps have no `caller` and no `{ as: 'caller' }`
  (`workflows.md`). The `policy` is checked once, at the call.
- `auth: 'anonymous'` without a credential: no caller (`caller.kind === 'anonymous'`); the handler
  acts as the Domain alone. Queries and Mutations run `{ as: 'executor' }`; `kernel`, `graph` and
  `dependencies.<alias>.self` work as usual. The `caller` selections and a Provider's
  `execution.invoke` are absent; `caller.kind` does not narrow them, so reach them through the
  selection (`graph.caller?.query(...)`). The input contract and the handler are the only gate.

## What the Kernel checks

- Under `executor`, the Domain needs the syscall's Kernel Role (`graph.reader` to query,
  `graph.writer` to mutate) and passes like any caller: by ownership, or by the Class or callable
  Policy. Its writes on a foreign Class are decided by that Class's write slot; no scope widens
  them.
- Under `caller`, the user needs the syscall's Role and passes the Policy; the Domain meets its
  ceiling: the Role for a syscall, a scope for a dependency's callable or Class, ownership for its
  own Classes.

## Composition

- `extends_with` makes an Identity a member of another, holding what it holds, at any depth. Groups
  (Shell `Group.assignMember`, `users.md`) and Role memberships (`requirements`, `policies.md`) are
  both `extends_with`.
- `subject` already covers the caller's composition: a group's fact is one Edge from `subject`,
  never a walk of `extends_with` (`policies.md`, Groups).
- Use `extends_with` alone. The Kernel also evaluates `constrained_by` (the constraint must satisfy
  the Policy too) and `excluded_from` (a veto); Domains never author them. A restriction is a
  narrower Policy or a separate group.
