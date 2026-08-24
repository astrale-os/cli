# Migration

Schema evolution and data migration are distinct decisions.

## Additive evolution

Prefer additions that preserve origin and existing Definition keys: optional properties, new Classes,
new Edges, and new callables. Rebuild and verify that the new Schema revision differs while unchanged
callable/Class keys remain stable. Reinstall through the public installation path and prove existing
data remains valid.

## Breaking evolution

Removing or renaming a property, Class, Edge, Policy, callable, or origin does not migrate stored data.
Treat it as an explicit compatibility and data-migration design. Do not conceal it in Core data,
Runtime initialization, a Provider, or an undocumented repair Action.

## Migration owner

Use the SDK migration surface only when the installed SDK exposes a governing migration contract for
the required transition. Inspect its exact declarations and Kernel support before authoring. If no
such lifecycle exists, record the product gap rather than inventing hooks or claiming convergence.

An ordinary Domain-owned Query/Mutation may repair user data only when invoked through a deliberate
authorized product operation. It is not an implicit post-install lifecycle.

## External effects

A migration involving a remote system is a multi-step Workflow with explicit failure and retry
semantics; it cannot be one atomic graph Mutation. Preserve immutable evidence and do not claim
exactly-once execution without a durable runner.

## Qualification

For V1 to V2:

1. retain V1 origin/revision and representative data evidence;
2. build and deploy V2 independently;
3. verify V2 Publication/Bundle and a new revision;
4. update installation through public Client/CLI APIs;
5. repeat the same intent and prove convergence;
6. read old data and invoke retained behavior;
7. exercise the additive V2 behavior;
8. retain exact failures and avoid destructive cleanup until evidence is complete.
