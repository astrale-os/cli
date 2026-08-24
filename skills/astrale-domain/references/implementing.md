# Implementing

The Schema declares callable identity, input/output, receiver, authentication mode, and Policy. SDK
Runtime authoring implements that contract as either an Action or a Workflow. Authors do not maintain
separate Function and Method handler registries.

## Action

Use an Action for one semantic asynchronous operation. Its context deliberately has no Workflow Step
API.

```ts
import { defineAction, type ActionServices } from '@astrale-os/sdk/action'
import type { schema } from '#schema'

interface Services extends ActionServices<Dependencies, IntegrationClients> {}

export const renameVisit = defineAction<typeof schema, Services>()(
  'FieldVisit.rename',
  async ({ self, input, query, mutate }) => {
    const visit = await query(readVisit, { self })
    return mutate(renameVisitMutation, {
      self,
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
- `query` and `mutate` execute authored definitions through that same admitted Client; they are absent
  when an anonymous invocation has no bound Client.
- `execution` owns cancellation, deadline, background work, and request-body access.

Do not check roles or permissions in the Action. Kernel admission has already evaluated callable
authority and the Schema Policy.

## Workflow

Use a Workflow when the operation has several explicit effects or observations:

```ts
import { defineWorkflow } from '@astrale-os/sdk/workflow'
import type { schema } from '#schema'

export const refreshForecast = defineWorkflow<typeof schema, Services>()(
  'FieldVisit.refreshForecast',
  async ({ self, query, mutate, integrations, step }) => {
    const visit = await step.run('read-visit', () => query(readVisit, { self }))
    const forecast = await step.run('fetch-forecast', () =>
      integrations.openMeteo.forecast(visit.coordinates),
    )
    await step.run('record-forecast', () =>
      mutate(recordForecast, { self, forecast }),
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

## Query and Mutation owners

Use `@astrale-os/sdk/query` for reusable observations and `@astrale-os/sdk/mutation` for one atomic
graph change. Build with resolved Schema Classes/Properties rather than copied key strings. Keep pure
projection in the Query owner and live preconditions in the same Mutation that changes state.

Inside an Action or Workflow, use the context's `query(definition, input)` and
`mutate(definition, input)` executors. `executeQuery(client, ...)` and `executeMutation(client, ...)`
remain the lower-level APIs for tests, scripts, and consumers that already own a Client.

A read followed by a write is not automatically atomic. If safety depends on current graph state,
encode the predicate as a Mutation precondition. Several commits or any external call make the
operation a Workflow.

Inspect the installed SDK declarations and generated examples for the exact Query/Mutation builder
shape. Do not invent a repository facade, alternate AST, raw syscall wrapper, or structural clone of
canonical SDK values.

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
