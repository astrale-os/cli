# Schema evolution and data migration

Schema evolution and data migration are distinct decisions.

## Additive evolution

Prefer additions that preserve origin and existing Definition keys: optional properties, new Classes,
new Edges, and new callables. Rebuild and verify that the new Schema revision differs while unchanged
callable/Class keys remain stable. Reinstall through the public installation path and prove existing
data remains valid.

Adding syntax is not necessarily compatible with existing data: a new required property or an Edge
with minimum cardinality `1` can invalidate existing nodes. Introduce an optional form, backfill,
then install the tightened contract; a default in application code is not a persisted backfill.

## Production changes: expand, migrate, contract

For production data, prefer staged compatibility over an immediately breaking change:

1. Expand the Schema to accept both representations. Deploy readers that understand both and writers
   that produce the new form; keep old-data reads working throughout the transition.
2. Move every producer off the old form, including older deployments, jobs, imports, and clients.
   Migrate existing data in bounded, restart-safe batches without overwriting concurrent updates.
3. Verify no old representation remains and no active producer can recreate it. Only then tighten
   the Schema and remove compatibility code; a rollback must not reintroduce an incompatible writer.

For local iteration with disposable data, a direct change or deliberate reset may suffice. Do not
impose a production rollout on every experiment, or treat production data as disposable.

## Dependency compatibility and grouped activation

A Domain retains the exact dependency revision against which it was authored. A current Kernel can
bind it to another active revision when the structural comparison preserves its referenced schema,
inheritance obligations and declared capabilities. A different revision alone does not require
rebuilding every dependent. Inspect `SCHEMA_DEPENDENCY_INCOMPATIBLE` or
`SCHEMA_DEPENDENTS_INCOMPATIBLE` for the affected keys and Domains; preserve their business meaning.

Rebuild the incompatible consumers and their affected reverse dependents against the intended
closure. Deploy all candidates first, then request the changed dependency and those consumers as
explicit roots of one grouped install. Embedded dependencies are not automatically installed roots.
A deploy never installs, and uninstalling a dependent is not a substitute for repairing compatibility.

```sh
astrale domain install "$URL_A" "$URL_B" -i staging
astrale domain install a.example@2.1.0 b.example@3.0.0 -i production
```

Grant issuer-change consent only after checking the intended issuer change. Grouped schema
activation is atomic across its roots; the install Execution and manual data repairs have their own
lifecycle (see below).

## How an install treats existing data

An install or uninstall is a durable Execution. Its status `detail.class` says what it does to the
stored data:

| Class | Meaning |
| --- | --- |
| `noop` | Nothing changes; reinstalling the same release ends here. |
| `immediate` | Applied at once without reading the data: an optional property, a new Class or Edge, a widened enum, a removed callable. |
| `revalidate` | The existing data is validated against the new rules before the activation: a tightened bound, a new required property, a stricter cardinality. Incremental by default; `--validation-scope full` re-reads everything and `--validation-counts exact` counts every offender. |

An online install (the default mode) keeps the Instance open: it validates while applications write,
and only the activation briefly pauses writes. Data the target refuses ends the install `failed`
with `DATA_MIGRATION_REQUIRED` (CLI exit 2) and activates nothing. Its message and report name each
requirement (the operation, such as `populate-required` or `remove-facts`, its subject and the
facts observed). Then either migrate the data online and install again, repair it in a maintenance
session (below), or, for facts that should go, delete them. Do not treat this refusal as transient.

## Following an install

Keep the Execution an install prints, even when the CLI stops waiting before the outcome (exit 0
with no `changed`). Follow it with `astrale domain installation status|result <execution>` as the
same identity or Root; never submit the install again to discover whether it worked. A transport
failure can happen after the Kernel accepted it: install again with a fresh operation, and while the
first one still changes the schema it is refused `SCHEMA_CHANGE_ACTIVE` naming that Execution.

An operation id names one request and its outcome is final. Reusing it replays only that exact
request, which the Kernel marks `replayed`; anything else under that id is refused as an operation
conflict. Once a run ended `failed` or `cancelled`, request the change again with a fresh operation.

## Breaking evolution

Removing or renaming a property, Class, Edge, Policy, callable, or origin does not migrate stored data.
Treat it as an explicit compatibility and data-migration design. Do not conceal it in Core data,
Runtime initialization, a Provider, or an undocumented repair Action.

An online install that removes a populated Class (Node or Edge) is refused with
`DATA_MIGRATION_REQUIRED`. Resolve the incompatible data through a staged online transition or the
explicit maintenance session below. Installing the target does not automatically migrate those rows.

For an online staged transition, deleting the only required Edge first violates the currently installed cardinality; removing its
Class first leaves data in a retired Class. To remove a `1` relationship while retaining its nodes:

1. publish and install an intermediate Schema revision that loosens the endpoint cardinality from
   `1` to optional (`0..1`);
2. delete every existing instance of the Edge Class; and
3. publish and install the final Schema revision that removes the Edge Class.

Qualify each installed revision before proceeding to the next stage. Do not treat
`DATA_MIGRATION_REQUIRED` as a transient failure. Update dependent Domains when the structural
compatibility check requires it. Deploying the final revision does not make an intermediate data
cleanup legal under the currently active schema.

## Uninstalling a Domain with data

`astrale domain uninstall` removes the selected Domains in one activation. Safe mode, the default,
deletes nothing: it is refused (`remove-facts`) for each of their Classes that still holds facts.
`--destructive` deletes those facts, and the Kernel relations of the deleted Nodes, in the same
activation, but never more than the Host's projection bound per Class; the refusal carries that
bound in `work`. Above it, delete the facts through ordinary Mutations first (Edges before their
Nodes, in batches the Mutation limit admits), then uninstall. Edges a surviving Domain owns and
surviving dependents block the uninstall. A refused uninstall deleted nothing.

## Maintenance repair sessions

Maintenance requires Root as both principal and caller and closes the **whole Instance** to ordinary
traffic. A Shell administrator or a business role is not automatically Root. Record the identity,
Instance, reason and effects of every Root use. Use a separate populated QA Instance for deliberate
breaking experiments; preserve a recovery plan for real data.

1. Retain the source revisions, exact target releases, representative node IDs/properties and Edge
   endpoints. Decide how to repair toward both target and source before entering maintenance.
2. Start the target install with `--mode maintenance` and a retained `--operation`. The CLI watches
   the session until it has drained the Instance and awaits its first command, then prints it
   (`--no-wait` returns at once with the Execution). Keep that Execution.
3. After `--no-wait`, read its status until `detail.phase` is `awaiting`; stop and inspect a
   terminal failure or cancellation instead of waiting indefinitely. A maintenance request with no schema change is
   refused with `SCHEMA_INPUT_INVALID`. Repair data with Root raw graph mutations using the
   session's source/target vocabulary; application Actions remain closed even to Root. Record
   each committed batch; several mutations are not one atomic migration.
4. Read the current `detail.command`, then send `domain installation apply` with that index.
   `apply` validates, activates the target and reopens the Instance on success; it is not a dry-run
   validation. `--validation-scope full --validation-counts exact` requests broader validation and
   failure counts when needed. An accepted signal only acknowledges the command.
5. Observe status/result. A refused validation leaves its report and returns the same session to
   repair; fix the reported data and use the next announced command index. Reconnect to the same
   Execution after a client restart rather than starting another install.
6. Require a completed outcome and result, then verify active revisions, retained data and normal
   non-Root reads/writes. An Execution ID, a successful status read or an accepted signal is not
   evidence that the migration finished.

```sh
astrale domain install "$TARGET_URL" -i qa-migration --as qa-root \
  --operation "$OPERATION" --mode maintenance --no-wait --json
astrale domain installation status "$EXECUTION" -i qa-migration --as qa-root --json
# Apply deliberate repair mutations, then read status for its current command index.
astrale domain installation apply "$EXECUTION" -i qa-migration --as qa-root \
  --command "$COMMAND_INDEX" --validation-scope full --validation-counts exact --json
astrale domain installation result "$EXECUTION" --wait -i qa-migration --as qa-root --json
```

`abort --attempt <number>` stops the named running validation attempt and returns the session to
repair; it does not undo committed repair mutations. Cooperative `cancel` attempts to validate and
reactivate the source schema, so it can also require data repair. `resume` resumes a paused Execution;
it is not a command to reopen the Instance. A live session has no forced exit: it ends by `apply`,
a cooperative `cancel` or its idle expiry; a forced cancel or a delete is refused
`EXECUTION_EXIT_REFUSED`. Only the Host operator can release a stuck session.

The repair lifecycle does not invent a Domain `Migration` hook. Domain-owned Query/Mutation
operations remain explicit authorized operations; external effects require their own Workflow.

## External effects

A migration involving a remote system is a multi-step Workflow with explicit failure and retry
semantics; it cannot be one atomic graph Mutation. Preserve immutable evidence and do not claim
exactly-once execution without a durable runner.

## Qualify a Schema revision

For a change from the current revision to a candidate revision:

1. retain the current origin/revision and representative data evidence;
2. build and deploy the candidate, which installs nothing;
3. verify the release its deployment serves, its Bundle, and its new revision;
4. install it through the public CLI (`astrale domain install`) or Client APIs;
5. repeat the same intent and prove convergence;
6. read existing data and invoke retained behavior;
7. exercise the added behavior;
8. retain exact failures and avoid destructive cleanup until evidence is complete.
