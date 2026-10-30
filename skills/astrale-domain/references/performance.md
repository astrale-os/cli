# Performance

Read when reducing graph round trips, bounding pagination, or deciding whether work belongs in an
Action, Mutation, Query, or Workflow.

## Measure the semantic operation

Optimize from observed Client calls and payload sizes, not from database-specific shortcuts. Preserve
visibility, Policy, pagination, preconditions, and outcome evidence. A reduction is valuable only when
the same product invariant remains proven.

## Read through reusable Queries

Define reusable reads as Queries (`queries.md` owns the grammar, the patterns and the limits) and
call them from the Action or Workflow context under a named authority. Use the Schema's handles;
do not copy Definition keys, parse paths, issue raw database queries, or write the canonical Query
document by hand.

- Use one read when one graph observation answers the question; carry relations with `with`.
- Use a record of facets for independent reads, and `steps(first, …)` (two to eight) when a read
  needs an earlier result.
- End each read with the verb that bounds it; `all({ max })` only when completeness is required.
- Project in `output` from the returned rows instead of re-reading each returned node.

Each read is one Kernel invocation at its own snapshot; facets, steps and pages share none. Do not
expect a Query of several reads to make one round trip. `d.A.union(d.B)` reads two Classes in one
read; measure the actual calls rather than inferring batching from one `query(...)` in the handler.
A read past the SDK's bounds or the Kernel's plan limits is refused before it runs, never slowed
(`queries.md`, Limits): narrow the read or split it into steps.

## Write one invariant as one Mutation

One bounded Mutation avoids per-item round trips only when all writes belong to one atomic invariant.
Its operations are not sequential commands: combine updates to one target and keep independently
raceable facts as guards (`mutation.expect.none|exists|count|unchanged` in a
`defineMutation<typeof schema>()` Mutation), never as a read before it. What the Schema declares (a
key, a cardinality, accepted endpoints) is never a guard. `mutations.md` covers the effect-set and
pre-state constraints.

## Choose Action versus Workflow by effects

An Action reads what it needs, performs at most one effect, and has no Step API. Do not split it
merely to make tests easier. Use a Workflow only when the operation has two or more effects that
cannot commit together, such as an Integration call and a graph Mutation. Reads never make a
Workflow. `workflows.md` covers what each Step costs and when a Workflow must be durable.

## Avoid hidden N-plus-one work

Common regressions are:

- loading each node again after a Query already returned it;
- invoking one Mutation per item when one bounded atomic document owns the invariant;
- constructing an Integration client per invocation instead of once in Runtime initialization;
- performing external calls during module import;
- placing build, declaration-packaging, linter, or scaffolding code in the Worker closure.

Assert call counts at the injected Query, Mutation, and Integration boundaries. Inspect the built
Worker closure and packed package, because a source-only test cannot prove deploy-time isolation.

## Let the Registry lower Policy Node selectors

Do not duplicate a long list of concrete Classes to optimize an existential Policy. Kernel closes
`node(Class)` to the active concrete descendant-or-self Classes inside the Policy owner's pinned
dependency closure; an independently installed extension never joins it. It resolves `node()` from
the active concrete catalog and narrows that set from the variable's Edge endpoints when the
normalized Policy makes a safe constraint available. The backend then evaluates exact label
alternatives rather than discovering inheritance per candidate.

Selector choice still follows authorization semantics. `node.exact(Class)` is the smallest extent;
`node(Class)` covers the concrete descendants the owner's closure pins; and `node()` can remain
broad when its Edge topology does not narrow it. Review the resolved selector extent and Policy
plan when a broad existential is on a measured hot path, but do not make an exact selector merely
to improve a benchmark.

## Stop before cleverness

Do not add a generic repository, cache, batching framework, persistent catalog, or adapter-specific
query abstraction without multiple real consumers and measured benefit. Prefer a small named Query or
Mutation owner and delete it again if the product operation disappears.
