# Simulating and testing

Read when writing Domain fixtures, focused tests, demos, or live acceptance journeys.

## Test at the semantic owner

Use the smallest real boundary that proves the behavior:

- test pure projection and rules as ordinary functions;
- test a Query with a narrow `QueryClient` double and assert the exact AST and pagination behavior;
- test a Mutation with a narrow `MutationClient` double and assert the exact atomic document;
- invoke an Action definition's `run` with an admitted, typed context when testing handler
  orchestration;
- invoke a Workflow with an inline Step implementation when testing explicit step order and values;
- realize a Runtime when testing Action/Workflow exhaustiveness and Provider initialization;
- use a real Kernel for installation, identity, callable authority, Policy, routing, and persistence.

Do not create a general fake Kernel. It becomes a second implementation of authority, visibility,
transactions, paging, and error semantics, while still proving none of them.

## Query example

```ts
import { executeQuery, type QueryClient } from '@astrale-os/sdk/query'

const calls: unknown[] = []
const client: QueryClient = {
  async query(ast, options) {
    calls.push({ ast, options })
    return { result: { kind: 'nodes', nodes: [] }, page: {} }
  },
}

await executeQuery(client, visitsByOwner, { owner })
expect(calls).toHaveLength(1)
```

Keep the double at the SDK's injected capability boundary. Do not duplicate Client routing or Kernel
response admission in the fixture.

## Mutation example

```ts
import { executeMutation, type MutationClient } from '@astrale-os/sdk/mutation'

let submitted: unknown
const client: MutationClient = {
  async mutate(document) {
    submitted = document
    return emptyMutationResult
  },
}

await executeMutation(client, createVisit, input)
expect(submitted).toMatchObject({ format: 'astrale.graph.mutation', version: 'v3' })
```

Assert the complete invariant-bearing operation: node creation, required Edges, preconditions, and
the absence of unintended writes. A Mutation definition owns one atomic document; a read performed
before it is not part of that transaction.

## Actions and Workflows

Actions deliberately have no Step API. For an Action, prove the selected Query, Mutation, or
Integration call and its output. For a Workflow, supply the SDK runner used by the Runtime and assert
stable step identifiers, serializable step values, and effect order.

The current inline runner gives structure and observability. It does not prove durable replay,
exactly-once effects, compensation, or crash recovery. Never claim those guarantees from an in-memory
test.

## Core and fixtures

Core is fixed Domain-owned installation data, not demo data, mutable product state, a post-install
hook, or a migration mechanism. Put throwaway sample data in a test fixture or explicitly invoked
demo owner. Runtime- or environment-dependent setup belongs to an Action, Workflow, or operator-owned
journey with declared requirements.

## Live acceptance

At least one acceptance journey should use packed or published packages outside every source
workspace, a clean Kernel data root, real credentials, and the deployment adapter the product ships.
Observe installation and invocation through public Client APIs. Keep authentication, authority,
Policy, handler, Provider, persistence, update, uninstall, and cleanup evidence distinct.
