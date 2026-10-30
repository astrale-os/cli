# Authority

Read to choose whose authority a handler's call uses (`{ as: 'executor' }` or `{ as: 'caller' }`,
`.self` or `.caller`), or to reason about who a call acts as. `policies.md` owns the rules that
decide each Identity: callable Policies, Class slots, Kernel Roles and scopes.

## Identities

Every party to a call is an Identity: a user, a group, a Role, a Domain, a Function, a View.

A Function is an Identity too. Who its handler executes as depends on who declares it:

- **A Function a Domain declares** (every Function and Method of a Schema) runs as that Domain. Its
  handler's executor is the Domain's installed Identity, the same for all its Functions.
- **A standalone Function**, a Function Node a Mutation creates as an instance of a Domain Class
  extending `Function`, registers its own credential and runs as itself, never as the Domain of
  its Class.

## Executor and caller

Every authenticated call carries two Identities:

- the **executor**, whose credential makes the call. Its Kernel Roles, scopes and ownership bound
  what the call may do;
- the **caller**, the one Identity whose authority the call exercises. Policies decide the caller:
  it is the Policy `subject`.

A direct call has `caller = executor`: a user calling from the CLI, or a Domain acting as itself. A
delegation has `executor = Domain` and `caller = user`. A call carries exactly one caller: there is
no union, intersection or exclusion of callers.

`principal` is the Kernel's name for the executor: Kernel errors, Journal records and the
handler's `caller.principal` use it. Both words name the same Identity. Say executor in code,
names and docs.

In a handler, every outgoing call is made by the handler's Domain, its executor. The selection
names the caller:

| Selection | Caller of the outgoing call | Executor |
| --- | --- | --- |
| `{ as: 'executor' }`, `graph.self`, `kernel.self`, `dependencies.<alias>.self` | the Domain itself | the Domain |
| `{ as: 'caller' }`, `graph.caller`, `kernel.caller`, `dependencies.<alias>.caller` | the incoming caller | the Domain |

The handler's `caller` describes the incoming call: `caller.identity` is its caller,
`caller.principal` its executor. Across U → A → B, A's `caller` call to B carries caller U with
executor A; in B, a `caller` call forwards U with executor B.

## Choose the authority

The callable's Policy already admitted the caller before the handler runs. Each call then names
the authority that fits its business meaning:

| The call | Authority |
| --- | --- |
| Reads or writes the Domain's own records as the business operation the callable exposes | `executor`: the callable Policy is the gate, and absent write slots admit the owning Domain only |
| Guards an invariant over records the caller may not see: an absence, a count | `executor`: a guard sees only what its authority reads (`mutations.md`) |
| Must answer what the caller may see, or write only where the caller may write | `caller`: Class rules judge the user |
| Calls another Domain on the user's behalf, so that its Policy decides the user | `dependencies.<alias>.caller` |
| Calls another Domain as a step of the Domain's own business, such as assigning to its own Team | `dependencies.<alias>.self` |

- A `caller` write on the Domain's own Class needs that Class's write slot to admit the caller. An
  absent `create`, `update` or `delete` admits the owning Domain only, so the write is refused.
  Write as `executor`, or give the slot a rule when users may also write directly.
- An `executor` read returns what the Domain reads, not what the caller may read. Returning it to
  the caller discloses it; do that only deliberately (`actions.md`, Read-only Actions).
- One handler may mix authorities: read as `caller` to answer for the user, write as `executor`
  for the Domain's bookkeeping. Name each call's authority by its own meaning.
- Handlers never re-check the caller's rights in code: the Kernel decides each call under the
  authority it names.

## Defaults

| Surface | Without a selection |
| --- | --- |
| `query(definedQuery, …)`, `mutate(definedMutation, …)` | None: a call without `as` throws |
| `kernel`, `graph` | The executor: `kernel.invoke(...)` acts as the Domain |
| deprecated V6 Query definitions and closure Mutations | The executor |
| `dependencies.<alias>` | None: choose `.caller.invoke` or `.self.invoke` |

- A durable Workflow acts as its executor only: its Steps have no `caller` and no
  `{ as: 'caller' }` (`workflows.md`). The callable's Policy is checked once, at the call.
- A public callable (`auth: 'anonymous'`) called without a credential has no caller
  (`caller.kind === 'anonymous'`): its handler acts as the Domain alone. Queries and Mutations run
  `{ as: 'executor' }`; `kernel`, `graph` and `dependencies.<alias>.self` work as in any handler.
  The `caller` selections and a Provider's `execution.invoke` are absent: reach them through the
  selection itself (`graph.caller?.query(...)`), since a check on `caller.kind` does not narrow
  them. The input contract and the handler are the only gate: admit only what the public may
  submit and return only what it may read.

## What the Kernel checks

- As `executor`, the Domain needs the syscall's Kernel Role (`graph.reader` to query,
  `graph.writer` to mutate) and is admitted like any caller: by ownership, or by the Class or
  callable Policy. Its writes on a foreign Class are decided by that Class's write slot; no scope
  widens them.
- As `caller`, the caller needs the syscall's Role and passes the Policy, and the executor meets
  its ceiling: the Role itself for a syscall, a scope for a dependency's callable or Class,
  ownership for its own Classes.
- `policies.md` details both decisions and the requirements a release declares to meet them.

## Composition

An Identity's authority includes what it reaches through `extends_with`, at any depth:

- `extends_with` makes an Identity a member of another and gives it what that one holds. Groups
  (Shell `Group.assignMember` writes it, `users.md`) and Role memberships (the release's
  `requirements`, `policies.md`) are both `extends_with`.
- Policies decide `subject` as the caller and every Identity it extends: write a group's fact as
  one Edge from `subject`, never walk `extends_with` (`policies.md`, Groups).
- Use `extends_with` alone. The Kernel also evaluates `constrained_by` (a cap: the constraint must
  satisfy the Policy too) and `excluded_from` (a veto), but Domains do not author them: never
  write them or design access around them. Express a restriction as a narrower Policy or a
  separate group.
