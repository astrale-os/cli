# Runtime

Read for Functions, Queries, Mutations, Rules, and optional native HTTP routes. Schema owns callable
input/output, receiver, auth, and Policy; runtime implements that admitted contract.

## Owners and composition

- Put Actions and Workflows together in `functions/`; keep `defineAction` and `defineWorkflow` distinct.
  Register one exact `functions` collection; do not maintain parallel handler registries or path dispatch.
- One callable, Query, or Mutation per owner file; keep its projection helpers there unless reused.
  Use business submodules and curated layer facades, not a generic repository or decoder layer.
- Name files by intent: `read-project.ts`, `list-project-services.ts`, `archive-project.ts`, not
  `record.ts`, `get.ts`, or a catch-all `queries.ts`. A longer descriptive name beats an ambiguous one.
- Import the aggregate Schema as a type. Use the invocation's resolved `domain` for Classes/Properties;
  focused error, value, and StateMachine facades may supply runtime-safe values.
- An Action reads what it needs and performs at most one effect: a Mutation, or a state-changing
  Integration, dependency, or Kernel call. Queries and read-only calls are observations, not effects.
  Two or more effects that cannot commit together, or a wait, make a Workflow: read `workflows.md`.
  Pure Rules need neither steps nor dependency injection.

## Authority and inputs

- Use public SDK bindings/executors, not hand-built endpoints, tokens, or routing. Transport is
  transparent to business code; consult `debugging.md` only when diagnosing discovery or invocation.
- Default `query`, `mutate`, and `kernel` use the installed Domain authority (`self`) only where a
  call names none: `kernel`, `graph`, and deprecated V6 Query and closure Mutation definitions. A
  Query or Mutation recipe names its authority on every call, `{ as: 'executor' }` (`self`) or
  `{ as: 'caller' }`; a recipe call without `as` throws. Select `{ as: 'caller' }`, or
  `graph.caller` or `kernel.caller`, to act for the incoming caller. Dependencies have no default
  `invoke`: choose `dependencies.alias.caller.invoke` or `.self.invoke`. In both modes the Domain
  signs the outgoing callback and remains its authenticated principal; `caller` carries the
  incoming caller Identity, `self` makes the Domain its own caller. There is no `union` mode: run
  Domain-owned work as `self` and work on the user's behalf as `caller`.
- The Kernel decides what each mode may do (`policies.md`). As `self`, the Domain needs the
  syscall's Kernel Role (`graph.reader` to query, `graph.writer` to mutate) and is admitted like any
  caller: by ownership or the Class or callable Policy. Its writes on a foreign Class are decided by
  that Class's write slot; no scope widens them. As `caller`, the caller passes the syscall and the
  Policy, and the Domain must also meet its ceiling: the Role itself for a syscall, a scope for a
  dependency's callable or Class, ownership for its own Classes. A `caller` write on the Domain's
  own Class therefore needs that Class's `create`/`update`/`delete` slot to admit the caller: an
  absent slot admits the owning Domain only.
- Protected callables receive authenticated `caller` evidence and bound `kernel` sessions.
- A public callable (`auth: 'anonymous'`) called without a credential has no caller
  (`caller.kind === 'anonymous'`): its handler acts as the installed Domain alone. Recipes run
  `{ as: 'executor' }`; `kernel`, `graph`, and `dependencies.alias.self` work as in any handler;
  the `caller` selections and a Provider's `execution.invoke` are absent, so reach them through the
  selection itself (`graph.caller?.query(...)`): a check on `caller.kind` does not narrow them. The
  input contract and the handler are the only gate: admit only what the public may submit and return
  only what it may read.
- Use the handler's `kernel` session for admitted Kernel syscalls outside graph operations;
  keep reusable graph operations in Query/Mutation recipes. Consumers that already own a Client use
  `runQueryRecipe(client, domain, recipe, input)` and `executeMutation(client, domain, recipe, input)`.
- `self` is the admitted receiver's `NodeId`; static/top-level callables have no receiver. The SDK validates
  callable input before the handler and output afterward; do not repeat parsing or implement role checks there.
- For business references, default to canonical record IDs in public inputs and outputs for simplicity.
  Pass `NodeId` directly to Queries/Mutations where accepted. Use `Path` only when the developer explicitly
  requests it or a called API contract requires it; convert at that call boundary, without maintaining
  parallel path/id APIs.
- Use resolved definitions or their refs where accepted, not reconstructed locator strings. Position
  matters: a Query Class handle selects instances, while a projected Class Path names the definition node.

## Queries: observe and project

- Name the business observation, not an authorization promise: `listProjectServices`, not
  `listAuthorizedServices`. `listServicesByOwner` is valid for an explicit business filter, not implicit access control.
- Author a recipe, `defineQuery<typeof schema>()(id, { build, output?, errors? })` from
  `@astrale-os/sdk/query`. `build(input, d)` returns one read over the Domain's handles (`d.Issue`,
  `d.<alias>.<Class>`, `d.kernel.<Class>`) or a record of facets; `output` is a pure, synchronous
  projection to portable JSON. Read once and project that result rather than fetching every node
  again. V6 definitions (`Query.from`, `defineCollectionQuery`) are deprecated; only a maintenance
  or repair session, which does not serve Query v7, still reads with them.
- Schema-admitted properties need no second validator: rows are typed from the Schema. Do not build
  a decoder, use `any`, or invent defaults for required values.
- An ID alone does not prove existence, visibility, or Class. Keep checks for supplied references that
  the admitted contract or observation does not already establish: `find` a caller-sent id and raise a
  declared error from `output`; `get` asserts existence. Absence from a caller-visible read is not
  proof of global nonexistence.
- Every read ends with the verb that bounds it: `get`, `find`, `first(n)`, `page({ max })`,
  `all({ max })`, `exists`, `count({ upTo })`. `all` past its `max` raises `TOO_MANY` instead of
  truncating; a `page` recipe takes `size` and `after` at the call and answers `{ rows, next? }`. A
  recipe makes at most 32 reads and 100,000 rows.
- Each read is one Kernel invocation at its own snapshot: facets, `steps`, and pages share none.

### Query mistakes that change the answer

- `d.A.union(d.B)` reads the Nodes of both Classes, not an intersection. A Class handle includes
  concrete descendants; use `isExactly(Class)` when subclasses must not qualify.
- A relation (`a.author`, `.via(edge, { direction })`) reads per parent row; `direction` is required
  when both ends accept the Edge Class. Filter the root by a related fact with a relation condition
  (`rel.is`, `rel.some`, `rel.none`) instead of reading the relation and dropping rows.
- Equality does not coerce: `eq(null)` matches a stored null, and `isMissing()` an absent value. `in`
  takes at most 16 values.
- A filter in `output` runs after the Kernel applied the verb's bound: it is not a complete server-side
  search. If a condition cannot be expressed, use a bounded complete read or change the
  product/query design; report the cost honestly.
- `orderBy` takes one key or a list; rows missing the value sort last unless `asc({ missing: 'first' })`.
- A list leaves out rows the reader may not read; `.includeWithheld()` keeps them as
  `{ id, $class, $withheld }`, and `get`/`find` raise `NOT_READABLE` on one. Changing the reading
  authority can change the result set.

## Mutations: preserve the atomic invariant

- Author one recipe per atomic change: `defineMutation<typeof schema>()(id, { build, output?, reject?,
  errors? })` from `@astrale-os/sdk/mutation`. `build(input, d, mutation)` is synchronous and names
  each write's Class by its handle. Related node/edge writes share that builder; never split a
  transaction automatically. The closure form, `defineMutation<S>()((domain) => ({ ... }))`, is
  deprecated.
- Guards protect independently raceable facts: `mutation.expect.none`, `exists`, `count`, or
  `unchanged` over a handle range, plus `expect.node`/`expect.edge`, each named with `{ name }`. What
  the Schema declares is never a guard: keys, cardinalities, Edge endpoints, StateMachine transitions.
  The Kernel checks those on every write; a duplicate key is `MUTATION_POST_STATE_INVALID`.
- A prior Query is not an atomic guard. Use `mutation.transition` for StateMachine changes; it derives
  the target state and emits the stale-state precondition, so do not duplicate either.
- Omit `output` when the canonical `MutationResult` suffices; otherwise return the needed created IDs
  or committed outcome. `reject(failure, input, { error })` maps an expected refusal, by `failure.code`
  and the guard's `failure.precondition`, to output or a declared error; rethrow anything else. Do not
  claim success before the commit resolves.
- Operations are an effect set, not a program: updating the same node twice rejects instead of applying
  sequential updates. Merge its property changes into one update; sibling effects cannot see each other's writes.
- All conditions observe the common pre-state. An Edge created in the Mutation cannot satisfy a sibling
  precondition or grant authority for another effect; use create bindings to reference new nodes, not future Paths.
- A guard is decided in the view of the authority the Mutation runs as, over the facts it can see.
  Run a Mutation whose guard protects a global invariant, such as an absence, `{ as: 'executor' }`.
- Creates are not upserts, and deleting a missing target is not a successful no-op. After an uncertain
  network outcome, observe the result before retrying; a thrown request alone does not prove rollback.
- Structural precondition limits are available through `MutationAST.limits`; backend execution limits
  are separate. Never auto-chunk a rejected Mutation: that changes one atomic invariant into partial commits.

## One composed example

Assume Schema declares `Issue.close` returning boolean, an `open → closed` StateMachine on `status`,
and its callable Policy. These are separate owner files; imports of sibling owners are abbreviated.

```ts
// queries/issue/read-issue.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineQuery } from '@astrale-os/sdk/query'
import type { schema } from '#schema'

export const readIssue = defineQuery<typeof schema>()('issue.read', {
  build: (issue: NodeId, d) => d.Issue.find(issue),
  output: (row) =>
    row === undefined ? { kind: 'missing' as const } : { kind: 'found' as const, status: row.status },
})

// mutations/issue/close-issue.ts
import { defineMutation } from '@astrale-os/sdk/mutation'

export const closeIssueMutation = defineMutation<typeof schema>()('issue.close', {
  build: (issue: NodeId, { Issue }, mutation) => {
    mutation.transition({ node: issue, class: Issue, property: 'status', from: 'open', event: 'close' })
  },
  output: () => true,
})

// rules/issue/can-close-issue.ts — pure eligibility over admitted observations, not authorization.
import type { OutputOf } from '@astrale-os/sdk/query'

export function canCloseIssue(issue: OutputOf<typeof readIssue>): boolean {
  return issue.kind === 'found' && issue.status === 'open'
}

// functions/issue/close-issue.ts — a read and one Mutation: an Action, not a Workflow.
import { defineAction } from '@astrale-os/sdk/action'
import { canCloseIssue } from '#rules/issue'
import { issueNotClosable } from '#schema/modules/issue/errors'

export const closeIssue = defineAction<typeof schema>()(
  'Issue.close',
  { errors: { ISSUE_NOT_CLOSABLE: issueNotClosable } },
  async ({ self, query, mutate, error }) => {
    const issue = await query(readIssue, self, { as: 'executor' })
    if (!canCloseIssue(issue)) throw error('ISSUE_NOT_CLOSABLE', { issueId: self })
    return mutate(closeIssueMutation, self, { as: 'executor' })
  },
)
```

The Query projects, the imported Rule decides eligibility, and the Action maps refusal to its
declared error. The callable Policy admits the caller; the Domain then reads and writes its own
Issue as `executor`, which an absent `update` slot on `Issue` admits. The Mutation still guards
state changes after the read.

## Expected errors

- Declare reusable errors with `error` from `@astrale-os/sdk/schema/errors` under the owning Schema
  module's `errors/`. Each callable imports that focused facade and registers only its applicable
  alternatives.

```ts
// schema/modules/issue/errors/issue-not-closable.ts
import { error } from '@astrale-os/sdk/schema/errors'
import { z } from 'zod'

export const issueNotClosable = error({
  family: 'CONFLICT',
  message: 'The issue is unavailable or cannot be closed.',
  details: z.strictObject({ issueId: z.string() }),
})
```

- Registration keys supply stable codes; declarations own fixed safe messages and details contracts.
  Keeping them under Schema source does not make them installed Schema members or generated-client alternatives.
- Preserve structured dependency failures; map only recognized expected errors. Unexpected exceptions
  remain defects, not invalid input or successful error-shaped output.

## Installation requirements

- A Schema dependency pins definitions, not authority. Declare what the Domain needs in the Domain
  definition's `requirements({ roles, scopes })`; `policies.md` owns the model:
  - a Kernel Role per syscall the Domain makes, held by `'domain'`: `graph.reader` for `query`,
    `graph.writer` for `mutate`, `identity.registrar` for `kernel.auth.register(...)`. As `caller`,
    the caller needs that Role too;
  - a scope per dependency callable the Domain invokes (`call`), in either mode, and per dependency
    Class operation (`read`, `traverse`, `create`, `update`, `delete`) it uses. The SDK linter
    reports a missing `call` scope, and the SDK refuses a recipe relation across a dependency Class
    without `read` and `traverse` on it. The Kernel uses a scope only to bound what the Domain does
    for a caller: it never admits the caller, who still passes the Policy, and a `self` call is
    decided by the Policy alone.
- Deprecated: the `functions`, `classes`, `authority`, and `core` keys (`can_use` capabilities); the
  SDK refuses them. `policies.md` maps each to Roles and scopes.

```ts
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { K, schema as language } from '@astrale-os/sdk/schema'
import { schema } from '#schema'

// Schema declares dependencies: { kernel: KernelSchema, messaging: MessagingSchema }.
// Resolve that exact declared dependency, not a separately chosen foreign version.
const Messaging = language.resolve(schema).dependencies.messaging

export const domain = defineDomain({
  schema, runtime,
  requirements: requirements({
    roles: [
      { role: K.core.nodes['graph.reader'], members: ['domain'] },
      { role: K.core.nodes['graph.writer'], members: ['domain'] },
    ],
    // Bounds Messaging.send called for a caller; Messaging.send still checks that caller.
    scopes: [{ on: Messaging.functions.send, operations: ['call'] }],
  }),
})
```

- Compare requested and materialized Roles and scopes with `astrale introspect <origin>`
  (`capabilities`). Do not grant the human a Role to conceal a Domain's gap.
- Call an exact dependency with
  `dependencies.messaging.caller.invoke((messaging) => messaging.functions.send, input)` to act for
  the incoming caller; an instance Method also takes its NodeId before input. Providers use their
  invocation-scoped typed `invoke` capability. Read `integrations.md` for consumer-owned
  Integrations/Providers; do not import a foreign handler or claim atomicity across Domains.
- For explicit authority selection, use `kernel.caller.invoke(reference(domain, declaration), input)`.
  References retain the full callable key and declaring revision; no `expect` or `schemaExpectation` option
  is needed. An instance reference requires the exact declaring Class, not a descendant. Raw instance
  paths use the entire key, such as `@id::files.example:class.Resource.method.rename`; raw revision is optional.

## Optional native HTTP routes

- Use top-level `routes/` only for a needed native wire surface: webhook, passthrough, or compatibility API.
  Ordinary SDK Functions and frontend navigation do not need this layer.
- A route maps HTTP method/path, receiver, headers/body, and credentials to an admitted callable.
  Keep behavior in `functions/`, not the route; compose the route collection in `domain.ts`.

```ts
// routes/document/download-document-route.ts
import { route } from '@astrale-os/sdk/domain'
import { downloadDocument } from '#functions/document'

export const downloadDocumentRoute = route(downloadDocument, {
  name: 'download-document',
  path: '/documents/{documentId}/download',
  method: 'GET',
  receiver: 'documentId',
})
```

A locally declared Method with `abstract: true` on a concrete Class requires an Action or Workflow
just like any other executable Method. Its descendants must declare their own implementations;
there is no handler fallback. A missing handler rejects the Runtime before it can serve calls.
