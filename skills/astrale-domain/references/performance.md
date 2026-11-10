# Performance

Read when reducing graph round trips, bounding pagination, or deciding whether work belongs in an
Action, Mutation, Query, or Workflow.

## Measure the semantic operation

Optimize from observed Client calls and payload sizes, not from database-specific shortcuts. Preserve
visibility, Policy, pagination, preconditions, and outcome evidence. A reduction is valuable only when
the same product invariant remains proven.

## Read through reusable Queries

Author reusable reads with `defineQuery` from `@astrale-os/sdk/query` (`queries.md`) and call them
with the Action or Workflow's `query`. Read through the typed handles; do not copy Definition keys,
parse paths, issue raw database queries, or hand-write canonical documents.

- Use one read when one graph observation answers the question: `.with` carries each row's
  relations in the same read, at one snapshot.
- Read independent lists as facets of one Query and dependent reads as `steps`. Each facet, step and
  page is its own Kernel invocation at its own snapshot; a Query makes at most 32 reads.
- State the smallest bound that is true on every verb. `exists()` and `count({ upTo })` answer
  without listing; `.ref()` reads identities when the values are not needed.
- Follow a hierarchy with `.reachable()` in one read instead of one step per level. Its bound limits
  the rows answered, not the walk: the Kernel walks the whole closure, so narrow it with `through`.
- Declare completeness with `all({ max })` or `query.all`; both raise `TOO_MANY` rather than truncate.
- Project from the returned rows instead of re-reading each returned node.
- Treat an absent visible node as unavailable; do not infer that it does not exist.

The SDK checks a Query's bounds before it sends anything, and the linter's `QRY-ROWS` warns when
constant bounds multiply past 10,000 rows. `output` should remain pure.

Do not expect facets to share one network round trip or one snapshot: each is a separate read.
`d.A.union(d.B)` reads two Classes in one read; measure the actual calls rather than inferring
batching from one `query(...)` in the handler.

## Write one invariant as one Mutation

One bounded Mutation avoids per-item round trips only when all writes belong to one atomic invariant.
Its operations are not sequential commands: combine updates to one target and keep independently
raceable facts as preconditions. `runtime.md` covers the effect-set and pre-state constraints.

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

Do not duplicate a long list of concrete Classes to optimize an existential Policy. Kernel resolves
`node(Class)` through the pinned Registry to the active concrete descendants, including installed
foreign descendants. It resolves `node()` from the active concrete Registry and narrows that set from
the variable's Edge endpoints when the normalized Policy makes a safe constraint available. The
backend then evaluates exact label alternatives rather than discovering inheritance per candidate.

Selector choice still follows authorization semantics. `node.exact(Class)` is the smallest extent;
`node(Class)` can grow as concrete descendants are installed; and `node()` can remain broad when its
Edge topology does not narrow it. Review the resolved selector extent and Policy plan when a broad
existential is on a measured hot path, but do not make an exact selector merely to improve a benchmark.

## Stop before cleverness

Do not add a generic repository, cache, batching framework, persistent catalog, or adapter-specific
query abstraction without multiple real consumers and measured benefit. Prefer a small named Query or
Mutation owner and delete it again if the product operation disappears.
