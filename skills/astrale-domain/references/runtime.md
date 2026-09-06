# Runtime

Read for Functions, Queries, Mutations, Rules, and optional native HTTP routes. Schema owns callable
input/output, receiver, auth, and Policy; runtime implements that admitted contract.

## Owners and composition

- Put Actions and Workflows together in `functions/`; keep `defineAction` and `defineWorkflow` distinct.
  Register one exact `functions` collection; do not maintain parallel handler registries or path dispatch.
- One callable, Query, or Mutation per owner file; keep its projection helpers there unless reused.
  Use business submodules and curated layer facades, not a generic repository or decoder layer.
- Import the aggregate Schema as a type. Use the invocation's resolved `domain` for Classes/Properties;
  focused error, value, and StateMachine facades may supply runtime-safe values.
- An Action owns one semantic asynchronous operation. A Workflow owns multiple observations/effects,
  each in a stable `step.run`; pure Rules need neither steps nor dependency injection.
- The inline Workflow runner is not durable replay, retry, compensation, or exactly-once execution.
  Steps need portable results; do not return Clients, responses, or other live capabilities between steps.

## Authority and inputs

- Prefer direct `query`/`mutate`: they use Domain authority (`graph.self`). Use `graph.caller` or
  `graph.union` only for their deliberately different authority semantics, not for style.
- The ordinary `client` is caller-only; select `kernel.self` explicitly for Domain-owned platform calls.
  Anonymous invocations without a bound Client have no graph executors.
- `self` is the admitted receiver's `NodeId`; static/top-level callables have no receiver. Input and
  caller admission already happened; do not repeat input parsing or implement role checks in handlers.
- Public inputs may accept `Path` for convenient locators; return canonical record IDs. Internally pass
  `NodeId` directly where accepted, without `Path.id(id)`, and do not maintain parallel path/id APIs.
- Use resolved definitions or their refs where the API accepts them, not reconstructed locator strings.
  A Class ref names its definition node, not its instances; a callable ref is not a Method receiver.

## Queries: observe and project

- Author `defineQuery<typeof schema>()((domain) => ({ build, project, ... }))` with canonical `Query`
  builders from `@astrale-os/sdk/query`. Read once and project that result rather than fetching every node again.
- Schema-admitted properties need no second validator. If projection is not inferred, use a narrow
  Schema-derived type; do not build a decoder, use `any`, or invent defaults for required values.
- Keep checks the observation does not establish: missing/hidden nodes and unexpected Classes for
  arbitrary Path lookups. Absence from a caller-visible query is not proof of global nonexistence.
- Let the SDK executor own response admission and pagination. A composite Query groups dependent
  observations, not a transaction; use `executeQuery` only when a script/test already owns the Client.

## Mutations: preserve the atomic invariant

- Author one `defineMutation<typeof schema>()((domain) => ({ build(input, mutation), ... }))`
  per atomic change. Related node/edge writes share that builder; never split a transaction automatically.
- Preconditions protect independently raceable facts: an observed version, lifecycle, or relationship.
  Do not add `expect` checks for endpoint Classes, property codecs, or cardinalities Schema already enforces.
- A prior Query is not an atomic guard. Use `mutation.transition` for StateMachine changes; it derives
  the target state and emits the stale-state precondition, so do not duplicate either.
- Omit `project` when the canonical Mutation result suffices; otherwise return the needed created IDs or
  committed outcome. Do not revalidate MutationResult or claim success before the commit resolves.

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

// functions/issue/close-issue.ts
import { defineWorkflow } from '@astrale-os/sdk/workflow'
import { canCloseIssue } from '#rules/issue'
import { issueNotClosable } from '#schema/modules/issue/errors'

export const closeIssue = defineWorkflow<typeof schema>()(
  'Issue.close',
  { errors: { ISSUE_NOT_CLOSABLE: issueNotClosable } },
  async ({ self, query, mutate, step, error }) => {
    const issue = await step.run('read-issue', () => query(readIssue, { self }))
    if (!canCloseIssue(issue)) throw error('ISSUE_NOT_CLOSABLE', { issueId: self })
    return step.run('close-issue', () => mutate(closeIssueMutation, { self }))
  },
)
```

The Query projects, the imported Rule decides eligibility, and the Workflow maps refusal to its
declared error. Policy owns authorization; the Mutation still guards state changes after the read.

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
  They live under Schema source, but are not yet installed Schema members or generated-client alternatives.
- Preserve structured dependency failures; map only recognized expected errors. Unexpected exceptions
  remain defects, not invalid input or successful error-shaped output.

## Installation requirements

- A Schema dependency pins definitions; it does not grant capability. Declare exact protected Kernel
  and foreign Functions in Application `requirements`; nested calls can otherwise fail after outer admission.

```ts
import { defineApplication, requirements } from '@astrale-os/sdk/application'
import { K, schema as language } from '@astrale-os/sdk/schema'
import { schema } from '#schema'

// Schema declares dependencies: { kernel: KernelSchema, messaging: MessagingSchema }.
// Resolve that exact declared dependency, not a separately chosen foreign version.
const Messaging = language.resolve(schema).dependencies.messaging

export const application = defineApplication({
  schema, runtime,
  requirements: requirements({
    functions: [K.functions.query, K.functions.mutate, Messaging.functions.send],
  }),
})
```

- Add `K.functions.register` when using an admitted `auth.register(...)` capability. Inspect requested
  and materialized authority for the Domain principal; do not grant the human rights to conceal a gap.
- Foreign calls use a consumer-owned Integration/Provider and the exact dependency callable.
  Read `integrations.md`; do not import a foreign handler or claim atomicity across Domains.

## Optional native HTTP routes

- Use top-level `routes/` only for a needed native wire surface: webhook, passthrough, or compatibility API.
  Ordinary SDK Functions and frontend navigation do not need this layer.
- A route maps HTTP method/path, receiver, headers/body, and credentials to an admitted callable.
  Keep behavior in `functions/`, not the route; compose the route collection in `application.ts`.

```ts
// routes/document/download-document-route.ts
import { route } from '@astrale-os/sdk/application'
import { downloadDocument } from '#functions/document'

export const downloadDocumentRoute = route(downloadDocument, {
  name: 'download-document',
  path: '/documents/{documentId}/download',
  method: 'GET',
  receiver: 'documentId',
})
```
