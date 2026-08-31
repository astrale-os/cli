# Implementing

The Schema declares callable identity, input/output, receiver, authentication mode, and Policy. SDK
Runtime authoring implements that contract as either an Action or a Workflow. Authors do not maintain
separate Function and Method handler registries.

## Action

Use an Action for one semantic asynchronous operation. Its context deliberately has no Workflow Step
API.

```ts
import { defineAction } from '@astrale-os/sdk/action'
import type { integrations } from '#integrations'
import type { schema } from '#schema'

export const renameVisit = defineAction<typeof schema, typeof integrations>()(
  'FieldVisit.rename',
  async ({ domain, self, input, graph }) => {
    const Visit = domain.classes.FieldVisit
    const visit = await graph.self.query(readVisit, { self })
    return graph.self.mutate(renameVisitMutation, {
      self,
      class: Visit,
      title: input.title,
      expectedVersion: visit.version,
    })
  },
)
```

- A receiver-bound Action receives `self` as a canonical `NodeId`.
- A top-level or static callable has no `self`.
- Protected callables receive an authenticated caller and non-null bound Client session.
- Anonymous callables may receive an anonymous caller and null Client.
- Default `query` and `mutate` use the admitted union authority. Select `graph.self` for Domain-owned facts,
  `graph.caller` for caller-only authority, and `graph.union` only deliberately. They are absent when
  an anonymous invocation has no bound Client.
- `execution` owns cancellation, deadline, background work, and request-body access.
- `domain` is the exact resolved Domain loaded from the deployed Build; it is not the authored
  Schema and must not be reconstructed at module scope.

Do not check roles or permissions in the Action. Kernel admission has already evaluated callable
authority and the Schema Policy.

## Workflow

Use a Workflow when the operation has several explicit effects or observations:

```ts
import { defineWorkflow } from '@astrale-os/sdk/workflow'
import type { integrations } from '#integrations'
import type { schema } from '#schema'

export const refreshForecast = defineWorkflow<typeof schema, typeof integrations>()(
  'FieldVisit.refreshForecast',
  async ({ self, graph, integrations, step }) => {
    const visit = await step.run('read-visit', () => graph.self.query(readVisit, { self }))
    const forecast = await step.run('fetch-forecast', () =>
      integrations.openMeteo.forecast(visit.coordinates),
    )
    await step.run('record-forecast', () =>
      graph.self.mutate(recordForecast, { self, forecast }),
    )
    return { visitId: self, forecast, steps: ['read-visit', 'fetch-forecast', 'record-forecast'] }
  },
)
```

Only Workflow effects belong in `step.run`. Step identifiers are stable and results must be
JSON-serializable. The current inline runner supplies explicit step structure, not durable replay,
exactly-once execution, compensation, or crash recovery.

## Runtime exhaustiveness

Compose exact definitions as collections; Runtime resolves Action addresses to the corresponding
top-level or receiver-bound callable:

```ts
export const actions = [providerProbe, planVisit, renameVisit] as const
export const workflows = [refreshForecast] as const
```

Missing, duplicate, foreign-Schema, and Action/Workflow-conflicting registrations must fail SDK
admission or typecheck. Do not reconstruct callable keys or dispatch by parsing graph paths.

Every semantic production owner lives in its own submodule with focused evidence beside it. Layer
roots are curated re-export facades and contain no behavior:

```text
actions/register-visit/index.ts
actions/register-visit/__tests__/register-visit.test.ts
actions/index.ts
queries/visit-by-id/index.ts
mutations/record-visit/index.ts
workflows/refresh-forecast/index.ts
providers/open-meteo/index.ts
```

Integrations also keep the typed collection in `integrations/integrations.ts`; their root
`integrations/index.ts` only re-exports that collection and its semantic submodules. Apply the same
`<layer>/<owner>/index.ts` shape to Rules, Views, UI, and other enabled layers. Do not start with
behavior in `<layer>/index.ts` and wait for lint to relocate it.

## Cross-Domain capability requirements

A Schema dependency pins the foreign Domain closure; it does not grant the installed caller Domain
authority to invoke that dependency. Every remote-Domain Provider call must have one matching,
explicit Application requirement so installation can materialize authority from the caller Domain
principal to the exact foreign callable:

```ts
import { defineApplication, requirements } from '@astrale-os/sdk/application'
import { schema as language } from '@astrale-os/sdk/schema'

import { MessagingSchema } from '@acme/messaging'
import { LogisticsSchema } from '#schema'

export const application = defineApplication({
  schema: LogisticsSchema,
  runtime,
  requirements: requirements({
    functions: [language.resolve(MessagingSchema).functions.send],
  }),
})
```

Use the public resolved callable—never a forged key—and keep the Provider caller-bound with
`execution.invoke(reference(domain, domain.functions.send), input)`. Verify the exact callable in
requested and materialized capabilities; dependency closure, typing, and build do not prove authority.

## Kernel callable requirements

Bound graph executors and direct Client APIs invoke protected Kernel callables. The Schema dependency
pins their exact closure; Application requirements let installation materialize `can_use` authority
for the Domain principal. A callable can admit successfully and still return Kernel `2004` when these
requirements are absent. Retain the generated defaults while any handler reads or writes graph state:

```ts
// schema/schema.ts
import { defineSchema, KernelSchema } from '@astrale-os/sdk/schema'

export const schema = defineSchema('shipment.example', {
  dependencies: { kernel: KernelSchema },
})

// application.ts
import { defineApplication, requirements } from '@astrale-os/sdk/application'
import { K } from '@astrale-os/sdk/schema'

export const application = defineApplication({
  schema,
  runtime,
  requirements: requirements({
    functions: [K.functions.query, K.functions.mutate],
  }),
})
```

Add other exact Kernel callables, such as `K.functions.provision` for `client.auth.provision(...)`,
only when used. Keep requirements in inert Application composition: do not create a `requirements/`
layer, forge keys, or grant the invoking human `can_use`. Inspect requested and materialized
capabilities after installation; typecheck, lint, build, and outer callable admission do not prove a
nested Kernel capability.

## Query and Mutation owners

Use `@astrale-os/sdk/query` for reusable observations and `@astrale-os/sdk/mutation` for one atomic
graph change. Build with resolved Schema Classes/Properties rather than copied key strings. Keep pure
projection in the Query owner and live preconditions in the same Mutation that changes state.

The stable authoring facades are narrow: Schema declarations come from `@astrale-os/sdk/schema`,
StateMachine from `@astrale-os/sdk/state`, graph language and `defineQuery` from
`@astrale-os/sdk/query`, and graph change language and `defineMutation` from
`@astrale-os/sdk/mutation`. Actions, Workflows, and Integrations use their matching SDK subpaths.

Start a single Query from this shape; the outer callback receives the resolved Domain once, while
`build` receives the invocation input:

```ts
import { defineQuery, Property, Query, queryResult, type QueryResult } from '@astrale-os/sdk/query'

export const issueByReference = defineQuery<typeof schema>()((domain) => {
  const Issue = domain.classes.Issue
  return {
    id: 'issue.by-reference',
    build: (input: { reference: string }) =>
      Query.from({ nodes: [Issue] })
        .filter({ predicate: Property(Issue.properties.reference.key).equals(input.reference) })
        .select({ kind: 'nodes', projection: { kind: 'value' } }),
    project: (result: QueryResult) => queryResult.optionalNode(result, 'issue.by-reference'),
  }
})
```

Start an atomic StateMachine change from this shape. `transition` owns the stale-state precondition,
legal target derivation, state update, and any additional property update in the same document:

```ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineMutation } from '@astrale-os/sdk/mutation'

export const closeIssue = defineMutation<typeof schema>()((domain) => ({
  id: 'issue.close',
  build(input: { issue: NodeId; from: 'open' }, mutation) {
    mutation.transition({
      node: input.issue,
      class: domain.classes.Issue,
      property: 'status',
      from: input.from,
      event: 'close',
    })
  },
  project: () => true,
}))
```

Inside an Action or Workflow, use the context's `query(definition, input)` and
`mutate(definition, input)` executors. `executeQuery(client, ...)` and `executeMutation(client, ...)`
remain the lower-level APIs for tests, scripts, and consumers that already own a Client.
Direct `client` access in a handler is reserved for genuine admitted Kernel capabilities that are
not graph Query or Mutation operations; declare each protected callable requirement and do not use
the Client as alternate graph plumbing.

A read followed by a write is not automatically atomic. If safety depends on current graph state,
encode the predicate as a Mutation precondition. Several commits or any external call make the
operation a Workflow.

Use the installed declarations only to resolve a detail absent from these public shapes. Do not invent
a repository facade, alternate AST, raw syscall wrapper, or structural clone of canonical SDK values.

## Outputs and failures

Return exactly the declared output mode: value, stream, or binary. Map only declared expected
business/provider failures. Unknown exceptions remain defects; do not relabel every thrown value as
invalid caller input.

## Tests

Test at the semantic owner:

- Action input/output and receiver inference;
- Action context has no `step`;
- exact Workflow step order and serializable results;
- Query projection and Mutation construction/preconditions;
- Provider response admission;
- Runtime exhaustiveness;
- Kernel-owned authentication, authority, and Policy denials without handler effects.
