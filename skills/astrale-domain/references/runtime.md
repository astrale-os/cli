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
  A Workflow coordinates two or more effects that cannot commit together, each effect in its own
  stable `step.run`. A step may make several reads; the reads an effect depends on go in an earlier
  step. Pure Rules need neither steps nor dependency injection.
- The inline Workflow runner is not durable replay, retry, compensation, or exactly-once execution;
  a durable callable is (see Durable Workflows below). Steps need portable results; do not return
  Clients, responses, or other live capabilities between steps.

## Authority and inputs

- Use public SDK bindings/executors, not hand-built endpoints, tokens, or routing. Transport is
  transparent to business code; consult `debugging.md` only when diagnosing discovery or invocation.
- Default `query`, `mutate`, and `kernel` use the installed Domain authority (`self`). Select
  `graph.caller` or `kernel.caller` to act for the incoming caller. Dependencies have no default
  `invoke`: choose `dependencies.alias.caller.invoke` or `.self.invoke`. In both modes the Domain signs
  the outgoing callback and remains its authenticated principal; `caller` carries the incoming caller
  Identity, `self` makes the Domain its own caller. There is no `union` mode: run Domain-owned work as
  `self` and work on the user's behalf as `caller`.
- Protected callables receive authenticated `caller` evidence and bound `kernel` sessions.
- A public callable (`auth: 'anonymous'`) called without a credential has no caller
  (`caller.kind === 'anonymous'`): its handler acts as the installed Domain alone. `query`,
  `mutate`, `kernel`, `graph`, and `dependencies.alias.self` work as in any handler; the `caller`
  selections and a Provider's `execution.invoke` are absent, so reach them through the selection
  itself (`graph.caller?.query(...)`): a check on `caller.kind` does not narrow them. The input
  contract and the handler are the only gate: admit only what the public may submit and return only
  what it may read.
- Use the handler's `kernel` session for admitted Kernel capabilities outside graph operations;
  keep reusable graph operations on Query/Mutation executors. `executeQuery(client, ...)` and
  `executeMutation(client, ...)` remain lower-level APIs for consumers that already own a Client.
- `self` is the admitted receiver's `NodeId`; static/top-level callables have no receiver. The SDK validates
  callable input before the handler and output afterward; do not repeat parsing or implement role checks there.
- For business references, default to canonical record IDs in public inputs and outputs for simplicity.
  Pass `NodeId` directly to Queries/Mutations where accepted. Use `Path` only when the developer explicitly
  requests it or a called API contract requires it; convert at that call boundary, without maintaining
  parallel path/id APIs.
- Use resolved definitions or their refs where accepted, not reconstructed locator strings. Position
  matters: a Query Class source selects instances, while a projected Class Path names the definition node.

## Queries: observe and project

- Name the business observation, not an authorization promise: `listProjectServices`, not
  `listAuthorizedServices`. `listServicesByOwner` is valid for an explicit business filter, not implicit access control.
- Author `defineQuery<typeof schema>()((domain) => ({ build, project, ... }))` with canonical `Query`
  builders from `@astrale-os/sdk/query`. Read once and project that result rather than fetching every node again.
- Schema-admitted properties need no second validator. If projection is not inferred, use a narrow
  Schema-derived type; do not build a decoder, use `any`, or invent defaults for required values.
- An ID alone does not prove existence, visibility, or Class. Keep checks for supplied references that
  the admitted contract or observation does not already establish. Absence from a caller-visible query
  is not proof of global nonexistence.
- A plain `defineQuery` executes one page. For a complete collection, declare `pagination.maximumPages`
  and project the completed pages, or use `defineCollectionQuery`; never treat the first page as complete.
- The SDK rejects a repeated cursor or exhausted page bound instead of returning a partial collection.
  Continuations and composite leaves are separate reads, not a shared point-in-time snapshot.

### Query mistakes that change the answer

- `Query.from({ nodes: [A, B] })` is a union, not an intersection. Class sources include concrete
  descendants; use an exact-Class filter when subclasses must not qualify.
- After `expand`, the default node binding is the reached node. Retain the earlier binding and select
  it explicitly to return the original records filtered by related facts; incoming traversal does not swap Edge endpoints.
- Property predicates currently offer `equals` and `isPresent`, not SQL ranges, substring search, or
  arbitrary callbacks. Equality does not coerce; `null` is present, and missing is not equal to `null`.
- Filtering one page in JavaScript is not a complete server-side search. If a predicate cannot be
  expressed, use a bounded complete read or change the product/query design; report the cost honestly.
- `page.size` and cursor are delivery options, not fields in `.select()` or the QueryAST. Ordering is
  one terminal Property order with explicit unranked placement and identity tie-breaks, not arbitrary multi-sort.
- A value projection can omit records whose properties the caller cannot read. Reference-only results
  prove identity visibility, not permission to fetch properties; changing projection can change the result set.

## Mutations: preserve the atomic invariant

- Author one `defineMutation<typeof schema>()((domain) => ({ build(input, mutation), ... }))`
  per atomic change. Related node/edge writes share that builder; never split a transaction automatically.
- Preconditions protect independently raceable facts: an observed version, lifecycle, or relationship.
  Do not add `expect` checks for endpoint Classes, property codecs, or cardinalities Schema already enforces.
- A prior Query is not an atomic guard. Use `mutation.transition` for StateMachine changes; it derives
  the target state and emits the stale-state precondition, so do not duplicate either.
- Omit `project` when the canonical Mutation result suffices; otherwise return the needed created IDs or
  committed outcome. Do not revalidate MutationResult or claim success before the commit resolves.
- Operations are an effect set, not a program: updating the same node twice rejects instead of applying
  sequential updates. Merge its property changes into one update; sibling effects cannot see each other's writes.
- All conditions observe the common pre-state. An Edge created in the Mutation cannot satisfy a sibling
  precondition or grant authority for another effect; use create bindings to reference new nodes, not future Paths.
- `expect.query` compares the complete ordered identity selection, not “contains” or a page. Truncated
  evidence cannot prove that no other related nodes exist; condition reads also need their own authority.
- Creates are not upserts, and deleting a missing target is not a successful no-op. After an uncertain
  network outcome, observe the result before retrying; a thrown request alone does not prove rollback.
- Structural precondition limits are available through `MutationAST.limits`; backend execution limits
  are separate. Never auto-chunk a rejected Mutation: that changes one atomic invariant into partial commits.

## One composed example

Assume Schema declares `Issue.close` returning boolean, an `open → closed` StateMachine on `status`,
and its callable Policy. These are separate owner files; imports of sibling owners are abbreviated.

```ts
// queries/issue/read-issue.ts
import { defineQuery, Query, queryResult, type QueryResult } from '@astrale-os/sdk/query'
import type { NodeId } from '@astrale-os/sdk/graph/node'
import type { StateOf } from '@astrale-os/sdk/state'
import type { schema } from '#schema'
import type { lifecycle } from '#schema/modules/issue/states'

export const readIssue = defineQuery<typeof schema>()((domain) => ({
  id: 'issue.read',
  build: ({ self }: { self: NodeId }) =>
    Query.from({ nodes: [self] }).select({ kind: 'nodes', projection: { kind: 'value' } }),
  project: (result: QueryResult) => {
    const node = queryResult.optionalNode(result, 'issue.read')
    return node === undefined ? undefined : {
      id: node.id,
      status: node.props[domain.classes.Issue.properties.status.key] as StateOf<typeof lifecycle>,
    }
  },
}))

// mutations/issue/close-issue.ts
import { defineMutation } from '@astrale-os/sdk/mutation'

export const closeIssueMutation = defineMutation<typeof schema>()((domain) => ({
  id: 'issue.close',
  build({ self }: { self: NodeId }, mutation) {
    mutation.transition({
      node: self, class: domain.classes.Issue, property: 'status', from: 'open', event: 'close',
    })
  },
  project: () => true,
}))

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
    const issue = await query(readIssue, { self })
    if (!canCloseIssue(issue)) throw error('ISSUE_NOT_CLOSABLE', { issueId: self })
    return mutate(closeIssueMutation, { self })
  },
)
```

The Query projects, the imported Rule decides eligibility, and the Action maps refusal to its
declared error. Policy owns authorization; the Mutation still guards state changes after the read.

## Durable Workflows

A callable whose Schema declares `execution: { durable: true }` runs on the Kernel's workflow engine;
implement it with `defineWorkflow`. The `@astrale-os/sdk` package's `docs/durable-workflows.md`
documents its context, retry budgets and serving. A run started on one release ends on it, under
four rules:

- Serve each release at its own URL, as the shipped adapters do. Code served in place at the same
  URL replays the journals of runs in flight: a renamed, reordered or removed Step pauses them, and
  no Workflow option declares such a change.
- Keep the Schema additive while runs are in flight. A Step calls the Kernel as installed when it
  calls: a Class, Function or Edge a later install removed or narrowed refuses it until the Step
  spends its budget.
- Do not retire a release, or drop a durable callable, while runs are in flight. A retired release
  strands its runs: signals time out and only a forced cancel ends them. The Kernel cancels the runs
  of a callable a new install no longer declares, without compensation.
- After an issuer change, a run in flight calls the Kernel for at most the Host drain bound (7 days
  by default); its later calls are refused. Keep runs that call the Kernel shorter.

A Step that spends its budget ends the Execution `failed` with `STEP_EXHAUSTED`, unless the Workflow
catches it (`exhausted(error)`). The outcome names the Step, and the Kernel refusal of its last
attempt by codes alone: `details: { step, refusal?: { code, reason? } }`, never a message.

### From an inline Workflow

The Schema chooses, not the Workflow: `execution: { durable: true }` gives the same `defineWorkflow`
the durable context, and only that callable and its callers change.

- The context keeps `domain`, `input`, `self` and `error`. It has no `query`, `mutate`, `kernel`,
  `graph`, `dependencies`, `integrations` or `caller`: the Kernel is reachable only inside a Step, as
  the Domain alone. A read becomes `step.query(id, query, input)`, a Mutation
  `step.mutate(id, mutation, input)`, and any other call goes in
  `step.run(id, ({ query, mutate, kernel, graph, dependencies, integrations }) => …)`, whose
  `integrations` lack every operation that may be `unsafe`.
- `execution` holds attested facts (`id`, `function`, `kernel`, `initiator`, `receiver`), not the
  Action lifetime. `sleep`, `awaitSignal`, `awaitExecution`, `exhausted`, `cancelled` and `retryAfter`
  are members of the context.
- A helper that receives `query` or `mutate` runs inside a Step, with that Step's capabilities. A
  helper that opens Steps receives the durable `step` and reads through `step.query`; Steps never
  nest.
- Steps and waits run one after another. Never await Steps or waits together through
  `Promise.all`, `allSettled`, `race` or `any`: the SDK refuses a Step started while another runs.
  Run independent Steps together with `step.parallel((s) => [s.query(...), s.run(...)])`: `s`
  declares Steps with the arguments of `step.*`, and the group costs one engine round trip. It
  waits for every Step, then resolves their outputs in order or throws the first failure in
  declaration order, after the other Steps' effects committed: keep in sequence the effects a
  failure would make you compensate. Independent reads also fit in one Step, whose Kernel calls
  `Promise.all` may combine.
- Each Step awaited alone costs one round trip to the engine. Give a Step to each effect, not to
  each item: a loop that opens a Step per element grows the run's latency with the element count,
  so write the elements in one Mutation, run them with `step.parallel`, or hand them to a durable
  callable.
- The Workflow still returns its output; callers receive `ExecutionRef<Output>`. A View follows it
  with `useExecution` from `@astrale-os/shell-react`, which refreshes every Query once it ends.
- The typecheck reports each member the durable context lacks and each caller that reads the output.
  Three changes compile unchanged; check them in every converted Workflow:
  - Throw a business refusal a Step detects as its declared `error(...)`, inside that Step. Any other
    error is retried until the Step spends its budget, and the Execution ends `STEP_EXHAUSTED`
    instead of the refusal: translating the error around the Step comes too late.
  - Read the clock, randomness and generated ids inside a Step. Code between Steps runs again on
    every replay and must take the same path; `astrale-domain lint` warns on the clock and randomness
    read there.
  - A caller that ignores the output, such as a View that refreshes right after the call, refreshes
    before the Execution ends. Follow the Execution and refresh when it ends.
- Test each converted Workflow with `createTestEngine` (see `testing.md`).

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
