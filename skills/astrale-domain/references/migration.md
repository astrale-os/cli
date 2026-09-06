# Schema evolution and data migration

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

Before reinstalling a Schema that removes a Class (Node or Edge), delete every existing instance of
that Class. The Kernel refuses the reinstall with `DATA_MIGRATION_REQUIRED` while incompatible data
remains.

An Edge Class whose affected endpoint cardinality is `1` cannot be deleted immediately. Perform the
change in stages:

1. publish and install an intermediate Schema revision that loosens the endpoint cardinality from
   `1` to optional (`0..1`);
2. delete every existing instance of the Edge Class; and
3. publish and install the final Schema revision that removes the Edge Class.

Qualify each installed revision before proceeding to the next stage. Do not bypass the intermediate
revision or treat `DATA_MIGRATION_REQUIRED` as a transient installation failure.

## Migration owner

Treat first-class Migration authoring as unavailable unless the installed SDK exposes a public
contract governing the required transition. Inspect its exact declarations and Kernel support; do not
infer an authoring API from linter vocabulary. If no such lifecycle exists, record the product gap
rather than inventing hooks or claiming convergence.

An ordinary Domain-owned Query/Mutation may repair user data only when invoked through a deliberate
authorized product operation. It is not an implicit post-install lifecycle.

## External effects

A migration involving a remote system is a multi-step Workflow with explicit failure and retry
semantics; it cannot be one atomic graph Mutation. Preserve immutable evidence and do not claim
exactly-once execution without a durable runner.

## Qualify a Schema revision

For a change from the current revision to a candidate revision:

1. retain the current origin/revision and representative data evidence;
2. build and deploy the candidate independently;
3. verify its Publication/Bundle and new revision;
4. update installation through public Client/CLI APIs;
5. repeat the same intent and prove convergence;
6. read existing data and invoke retained behavior;
7. exercise the added behavior;
8. retain exact failures and avoid destructive cleanup until evidence is complete.
