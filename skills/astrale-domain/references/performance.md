# Performance

Read when reducing graph round trips, bounding pagination, or deciding whether work belongs in an
Action, a Mutation, a Query or a Workflow.

## Measure the semantic operation

Optimize from observed Client calls and payload sizes, never database-specific shortcuts. A
reduction counts only when visibility, Policy, pagination, guards, outcome evidence and the product
invariant stay proven.

## Reads

Grammar, patterns and limits: `queries.md`. Use the Schema's handles; never copy Definition keys,
parse paths, issue raw database queries or hand-write the canonical Query document.

- One read when one observation answers; relations carried with `with`. Facets for independent
  reads; `steps` (2 to 8) when a read needs an earlier answer.
- Each read is one Kernel invocation at its own snapshot: a Query of N reads is N round trips,
  whatever one `query(...)` call suggests; a Query makes at most 32 reads. `d.A.union(d.B)` reads
  two Classes in one read.
- The smallest bound true on every verb. `exists()` and `count({ upTo })` answer without listing;
  `.ref()` reads identities when the values are not needed.
- A hierarchy is one `.reachable()` read, never one step per level. Its bound limits the rows
  answered, not the walk: the Kernel walks the whole closure, so narrow it with `through`.
- Completeness is `all({ max })` or `query.all`; both raise `TOO_MANY`, never truncate.
- Project in `output` from the returned rows; never re-read a returned Node.
- A read past the SDK's bounds or the Kernel's plan limits is refused before it runs, never slowed:
  narrow it or split it into steps.
- The SDK checks a Query's bounds before sending it; the linter's `QRY-ROWS` warns when constant
  bounds multiply past 10,000 rows.
- An absent visible Node is unavailable, never proof that it does not exist.

## Writes

One Mutation replaces per-item round trips only when every write belongs to one atomic invariant
(`mutations.md`). Its operations are an effect set, not sequential commands: one change per target,
and every independently raceable fact a guard (`expect.none|exists|count|unchanged`), never a read
before it. What the Schema declares (a key, a cardinality, accepted endpoints) is enforced, never a
guard.

## Admission round trip

Each call a deployment serves costs one `Function.admit` round trip to its Kernel before the handler
runs. `admission: { maxAge }` (`policies.md`, Admission age) removes it for a repeated call within
the age, at the price of revocation lag. Kept admissions live in the `serve({ cache })` cache:

| `cache` | Kept in |
| --- | --- |
| omitted | process or isolate memory, 1,024 entries, least recently used out first |
| `() => DeploymentCache` | that cache (`get(key)`, `put(key, value, expiresAt)`); a read failing or over 30 ms is a miss |
| `false` | nowhere |

A Worker built by `@astrale-os/adapter-cloudflare` keeps them in its deployment's Cache API behind
an isolate memory tier; `cloudflareWorkerEntry()({ cache: false })` keeps none. Reuse needs a Kernel
whose `Function.admit` answers `maxAge`; any other admits every call.

## Action or Workflow

An Action reads, then makes at most one effect; a Workflow only for two or more effects that cannot
commit together, such as an Integration call and a Mutation. Reads never make a Workflow; never
split an Action to ease testing. Step costs and durability: `workflows.md`.

## Hidden N+1 work

| Regression | Instead |
| --- | --- |
| Reading each Node again after a Query returned it | Project the rows; `with` for relations |
| One Mutation per item | One bounded Mutation owning the invariant |
| An Integration client per invocation | Built once in Runtime `initialize` |
| External calls at module import | Inside `initialize` or a handler |
| Build, declaration-packaging, linter or scaffolding code in the Worker closure | Kept out of the Runtime's import graph |

Assert call counts at the injected Query, Mutation and Integration boundaries. A source-only test
cannot prove deploy-time isolation: inspect the built Worker closure and the packed package.

## Policy Node selectors

| Selector | Extent |
| --- | --- |
| `node.exact(Class)` | That Class only |
| `node(Class)` | Its active concrete descendant-or-self Classes in the Policy owner's pinned dependency closure; an independently installed extension never joins it |
| `node()` | The active concrete catalog, narrowed by the variable's Edge endpoints when the normalized Policy allows |

- The Kernel evaluates the resolved label alternatives; it never discovers inheritance per
  candidate. Never list concrete Classes by hand to optimize an existential.
- Choose the selector by authorization meaning, never to win a benchmark. On a measured hot path,
  review the resolved extent and the Policy plan of a broad existential.

## Stop before cleverness

No generic repository, cache, batching framework, persistent catalog or adapter-specific query
abstraction without several real consumers and measured benefit. Prefer a small named Query or
Mutation, and delete it when the product operation disappears.
