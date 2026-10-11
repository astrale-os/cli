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
activation is atomic across its roots; the installation Execution and manual data repairs have their
own lifecycle. A transport failure or timeout can occur after admission. Keep the returned Execution
ID and observe it with `domain installation status/result`; do not submit a new operation to discover
whether the previous one worked. If no ID was received, retain the exact original operation and
request, and follow the CLI recovery instructions. A verified already-current postcondition is not
proof that a particular earlier Execution completed.

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

## Maintenance repair sessions

Use matching published CLI, SDK and Kernel versions that expose durable installation and repair
sessions. Check the installed command help and public `session.schema.installation` API. Older
clients can reject a new admission response after the Execution has started; an SDK version alone
does not prove that its embedded client matches the Host.

Maintenance requires Root as both principal and caller and closes the **whole Instance** to ordinary
traffic. A Shell administrator or a business role is not automatically Root. Record the identity,
Instance, reason and effects of every Root use. Use a separate populated QA Instance for deliberate
breaking experiments; preserve a recovery plan for real data.

1. Retain the source revisions, exact target releases, representative node IDs/properties and Edge
   endpoints. Decide how to repair toward both target and source before entering maintenance.
2. Start the target install with `--mode maintenance --no-wait` and a retained operation ID. Keep
   the returned Execution even when the CLI exits nonzero because the installation is unfinished.
3. Read its status until `detail.phase` is `awaiting`; stop and inspect a terminal failure or
   cancellation instead of waiting indefinitely. A maintenance request with no schema change is
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
astrale domain installation result "$EXECUTION" -i qa-migration --as qa-root --json
```

`abort --attempt <number>` stops the named running validation attempt and returns the session to
repair; it does not undo committed repair mutations. Cooperative `cancel` attempts to validate and
reactivate the source schema, so it can also require data repair. `resume` resumes a paused Execution;
it is not a command to reopen the Instance. Forced cancellation or Execution deletion can leave the
source uncertified and are not normal recovery steps.

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
