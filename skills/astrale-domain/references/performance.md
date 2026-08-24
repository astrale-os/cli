# Performance

Read when reducing graph round trips, bounding pagination, or deciding whether work belongs in an
Action, Mutation, Query, or Workflow.

## Measure the semantic operation

Optimize from observed Client calls and payload sizes, not from database-specific shortcuts. Preserve
visibility, Policy, pagination, preconditions, and outcome evidence. A reduction is valuable only when
the same product invariant remains proven.

## Read through reusable Queries

Author reusable reads with `defineQuery` or `defineCompositeQuery` from `@astrale-os/sdk/query` and
execute them with the Action or Workflow's bound Client. Use resolved Schema Classes and Properties;
do not copy Definition keys, parse paths, issue raw database queries, or recreate the canonical Query
AST.

- Use one Query when one graph observation answers the question.
- Use a composite Query for a closed set of dependent reads with one final projection.
- Bound every cursor chain and reject repeated cursors.
- Project from the returned graph instead of re-reading each returned node.
- Treat an absent visible node as unavailable; do not infer that it does not exist.

Query execution owns remote response admission and pagination. A local projection should remain pure.

## Write one invariant as one Mutation

Use `defineMutation` from `@astrale-os/sdk/mutation` for one atomic graph document. Prefer the rich
builder over copied low-level property or class keys:

```ts
import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { defineMutation } from '@astrale-os/sdk/mutation'

export const renameVisit = defineMutation({
  id: 'field-visit.rename',
  change(mutation, input: { readonly visit: NodeId; readonly title: string }) {
    mutation.updateNode({
      node: Path.id(input.visit),
      class: Work.classes.FieldVisit,
      props: { set: { title: input.title } },
    })
  },
})
```

Place current-state safety conditions in `mutation.expect`; a Query followed by a Mutation is not an
atomic read-modify-write. Keep related node and Edge writes in the same Mutation when they form one
invariant.

## Choose Action versus Workflow by semantics

An Action performs one semantic asynchronous operation and has no Step API. Do not split it merely to
make tests easier. Use a Workflow when the operation has several explicit observations or effects,
especially an Integration call between graph reads and writes. Stable steps improve diagnosability,
but the current inline runner is not a durability system.

## Avoid hidden N-plus-one work

Common regressions are:

- loading each node again after a Query already returned it;
- invoking one Mutation per item when one bounded atomic document owns the invariant;
- constructing an Integration client per invocation instead of once in Runtime initialization;
- performing external calls during module import;
- placing build, declaration-packaging, linter, or scaffolding code in the Worker closure.

Assert call counts at the injected Query, Mutation, and Integration boundaries. Inspect the built
Worker closure and packed package, because a source-only test cannot prove deploy-time isolation.

## Stop before cleverness

Do not add a generic repository, cache, batching framework, persistent catalog, or adapter-specific
query abstraction without multiple real consumers and measured benefit. Prefer a small named Query or
Mutation owner and delete it again if the product operation disappears.
