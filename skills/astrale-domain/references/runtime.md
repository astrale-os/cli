# Runtime

Read for Functions, Queries, Mutations, Rules, and optional native HTTP routes. Schema owns callable
input/output, receiver, auth, and Policy; runtime implements that admitted contract. The read
grammar itself (handles, verbs, conditions, relations, `.reachable()`, rows, errors) is `queries.md`.

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
- A Query and a defined Mutation name their authority on every call, with no default:
  `query(q, input, { as: 'executor' })` acts as the installed Domain and `{ as: 'caller' }` for the
  incoming caller; `mutate(m, input, { as })` likewise. `kernel` and `graph` default to the installed
  Domain authority (`self`); select `kernel.caller` or `graph.caller` to act for the incoming
  caller. Dependencies have no default `invoke`: choose `dependencies.alias.caller.invoke` or
  `.self.invoke`. In both modes the Domain signs the outgoing callback and remains its authenticated
  principal; `caller` carries the incoming caller Identity, `self` makes the Domain its own caller.
  There is no `union` mode: run Domain-owned work as the Domain and work on the user's behalf as the
  caller.
- `{ as: 'caller' }` answers only what both the caller and the Domain may observe, and leaves out
  the rest without saying so. A relation that crosses a dependency Class admitting only some callers
  needs that scope in the Domain's requirements (`queries.md`, Requirements).
- Protected callables receive authenticated `caller` evidence and bound `kernel` sessions.
- A public callable (`auth: 'anonymous'`) called without a credential has no caller
  (`caller.kind === 'anonymous'`): its handler acts as the installed Domain alone. `query`,
  `mutate`, `kernel`, `graph`, and `dependencies.alias.self` work as in any handler, its Queries and
  Mutations as `{ as: 'executor' }` only; the `caller` selections and a Provider's
  `execution.invoke` are absent, so reach them through the selection itself
  (`graph.caller?.query(...)`): a check on `caller.kind` does not narrow them. The input
  contract and the handler are the only gate: admit only what the public may submit and return only
  what it may read.
- Use the handler's `kernel` session for admitted Kernel capabilities outside graph operations;
  keep reusable graph operations on Queries and Mutations. `runQuery(client, domain, query, input)`
  and `executeMutation(client, domain, mutation, input)` remain lower-level APIs for consumers that
  already own a Client.
- `self` is the admitted receiver's `NodeId`; static/top-level callables have no receiver. The SDK validates
  callable input before the handler and output afterward; do not repeat parsing or implement role checks there.
- For business references, default to canonical record IDs in public inputs and outputs for simplicity.
  Pass `NodeId` directly to Queries/Mutations where accepted. Use `Path` only when the developer explicitly
  requests it or a called API contract requires it; convert at that call boundary, without maintaining
  parallel path/id APIs.
- A file arrives as an upload receipt at a `file()` input field, never as bytes: the handler gets a
  file object there, reads it (`text()`, `bytes()`, `stream()`) and attaches it to a blob property
  of its own Class as the Domain (`mutate(..., { as: 'executor' })`): a receipt serves whoever
  presents it until it expires. Read `files.md`.
- Use resolved definitions or their refs where accepted, not reconstructed locator strings. Position
  matters: a Class handle (`d.Issue`) reads the Class's instances, while a Class Path names the
  definition node.

## Queries: observe and project

Read `queries.md` before writing a read; this section owns only where a Query lives.

- Name the business observation, not an authorization promise: `listProjectServices`, not
  `listAuthorizedServices`. `listServicesByOwner` is valid for an explicit business filter, not implicit access control.
- Author `defineQuery<typeof schema>()(id, { build, output?, errors? })` from
  `@astrale-os/sdk/query`. `build(input, d)` reads through the Domain's typed handles (`d.Issue`,
  `d.assigned_to`, `d.directory.Person`) and every verb states its bound. Read once, carrying a
  row's relations with `.with`, rather than fetching every node again.
- Rows are typed from the Schema and need no second validator. `output` is pure and optional: keep it
  for a narrower business answer or a declared error, not to decode what the Kernel admitted.
- An ID alone does not prove existence, visibility, or Class. Use `find` for an id a caller sends and
  throw a declared error from `output`; `get` is for ids the Domain itself holds. Absence from a
  caller-visible read is not proof of global nonexistence.
- A list is complete only when its verb says so: `all({ max })`, or `query.all` over a page Query,
  raise `TOO_MANY` instead of answering a partial list. Never treat `first(n)` or one page as complete.
- Facets, steps and pages of one Query are separate reads, not a shared point-in-time snapshot.
- Follow a hierarchy (ancestors, a sub-tree) with `.reachable()` rather than a loop of reads.
- The closure form `defineQuery<Schema>()((domain) => …)` with `Query.from(…)` is the deprecated
  Query V6: write it only for a read in a maintenance or repair session, where v7 is not served.

## Mutations: preserve the atomic invariant

- Author one `defineMutation<typeof schema>()(id, { build, output?, reject?, errors? })` per atomic
  change. `build(input, d, mutation)` is synchronous and names each Class by its handle. Related
  node/edge writes share that builder; never split a transaction automatically. The closure form
  `defineMutation<Schema>()((domain) => …)` is deprecated.
- Guards protect independently raceable facts: an observed version, lifecycle, or relationship.
  `mutation.expect.none(range)`, `expect.exists(range)`,
  `expect.count(range, n | { atLeast?, atMost? })` and `expect.unchanged(range, ids)` take a range (a
  Class handle after `where`, `union` and `orderBy`) and `{ name }` last. A read, a rendered set and
  a range that walks with `.reachable()` are refused (`queries.md`, Guard ranges).
- Never guard what Schema declares: a key (`unique`), a cardinality, the endpoints an Edge accepts, a
  property codec, a StateMachine's transitions. The Kernel checks those on every write.
- A prior Query is not an atomic guard. Use `mutation.transition` for StateMachine changes; it derives
  the target state and emits the stale-state precondition, so do not duplicate either.
- Omit `output` when the canonical Mutation result suffices; otherwise return the needed created IDs or
  committed outcome. Do not revalidate MutationResult or claim success before the commit resolves.
- `reject(failure, input, { error, is })` maps an expected refusal to an output or a declared error:
  a duplicate key (`MUTATION_POST_STATE_INVALID`, rule `duplicate-key`), or a failed guard
  (`MUTATION_PRECONDITION_FAILED`, its name in `failure.precondition`). Rethrow any other failure.
- Operations are an effect set, not a program: updating the same node twice rejects instead of applying
  sequential updates. Merge its property changes into one update; sibling effects cannot see each other's writes.
- All conditions observe the common pre-state. An Edge created in the Mutation cannot satisfy a sibling
  precondition or grant authority for another effect; use create bindings to reference new nodes, not future Paths.
- `expect.unchanged(range, ids)` holds the range's complete ordered list, not “contains” or a page.
  Truncated evidence cannot prove that no other related nodes exist; a guard's read also needs its own
  authority. A Mutation holds v7 guards or the deprecated `expect.query` preconditions, never both.
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

// The row, or `undefined`: an Issue the reader cannot find is not closable.
export const readIssue = defineQuery<typeof schema>()('issue.read', {
  build: (issue: NodeId, d) => d.Issue.find(issue),
})

// mutations/issue/close-issue.ts
import { defineMutation } from '@astrale-os/sdk/mutation'

export const closeIssueMutation = defineMutation<typeof schema>()('issue.close', {
  build: (issue: NodeId, { Issue }, mutation) => {
    mutation.transition({
      node: issue, class: Issue, property: 'status', from: 'open', event: 'close',
    })
  },
  output: () => true,
})

// rules/issue/can-close-issue.ts — pure eligibility over admitted observations, not authorization.
export function canCloseIssue(issue: { status: StateOf<typeof lifecycle> } | undefined): boolean {
  return issue?.status === 'open'
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

The Query reads, the imported Rule decides eligibility, and the Action maps refusal to its
declared error. Policy owns authorization; the Mutation's transition still refuses a stale state
after the read.

## Expected errors

- Declare reusable errors with `error` from `@astrale-os/sdk/schema` under the owning Schema module's
  `errors/`. Each callable imports that focused facade and registers only its applicable alternatives.

```ts
// schema/modules/issue/errors/issue-not-closable.ts
import { error } from '@astrale-os/sdk/schema'
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

- A Schema dependency pins definitions, not capability. Declare the exact protected Kernel/foreign
  Functions the Domain calls for its callers: `can_use` supplies the principal ceiling of that
  delegation, while the caller must independently pass admission. A call the Domain makes as itself
  is decided by the callable's Policy alone; a Kernel syscall's `canUseSyscall` Policy still asks it
  for `can_use`, so declare those too. See `policies.md` and `users.md`.

```ts
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { K, schema as language } from '@astrale-os/sdk/schema'
import { schema } from '#schema'

// Schema declares dependencies: { kernel: KernelSchema, messaging: MessagingSchema }.
// Resolve that exact declared dependency, not a separately chosen foreign version.
// This supplies Domain-principal usability; Messaging.send still checks its caller.
const Messaging = language.resolve(schema).dependencies.messaging

export const domain = defineDomain({
  schema, runtime,
  requirements: requirements({
    functions: [K.functions.query, K.functions.mutate, Messaging.functions.send],
  }),
})
```

- Add `K.functions.register` when using an admitted `auth.register(...)` capability. Inspect requested
  and materialized authority for the Domain principal; do not grant the human rights to conceal a gap.
- Call an exact dependency with
  `dependencies.messaging.caller.invoke((messaging) => messaging.functions.send, input)` to act for
  the incoming caller; an instance Method
  also takes its NodeId before input. Providers use their invocation-scoped typed `invoke` capability.
  Read `integrations.md` for consumer-owned Integrations/Providers; do not import a foreign handler
  or claim atomicity across Domains.
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
