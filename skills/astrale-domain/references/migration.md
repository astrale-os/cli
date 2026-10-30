# Schema evolution and data migration

Installing a target Schema never migrates stored data. Never hide a migration in Core data, Runtime
initialization, a Provider or an undocumented repair Action; there is no Domain `Migration` hook.

## Classify the change

| Change | Kind | Path |
| --- | --- | --- |
| Optional Property, new Class, Edge or callable, widened enum | additive | install online |
| New required Property, minimum cardinality `1`, tightened bound, enum or cardinality | breaking: existing data may not satisfy it | online install if the data may already satisfy it, else a maintenance session |
| Removed or renamed Property, Class, Edge or origin | breaking | maintenance session (default), or a staged online transition |

- Additive: keep origin and existing Definition keys. Rebuild, verify the revision changed while
  unchanged callable/Class keys stayed stable, reinstall, prove existing data still valid.
- A default in application code is not a persisted backfill.
- Default for a breaking change: a [maintenance repair session](#maintenance-repair-sessions) as
  Root. Rehearse it on a populated QA Instance, then run it on the real one with a recovery plan.
  A [staged online transition](#staged-online-transition-expand-migrate-contract) only when the
  Instance cannot close, or uncontrolled clients still write the old form. Disposable local data may
  be reset; production data never.

## How an install treats existing data

An install or uninstall is a durable Execution; its status `detail.class`:

| `detail.class` | Meaning |
| --- | --- |
| `noop` | Nothing changes (reinstalling the same release) |
| `immediate` | Applied without reading data: optional Property, new Class or Edge, widened enum, removed callable |
| `revalidate` | Existing data validated before activation: tightened bound, new required Property, stricter cardinality. Incremental by default; `--validation-scope full` re-reads everything; `--validation-counts exact` counts every offender (small Classes only, see `apply`) |

- Online (default mode): the Instance stays open; it validates while applications write; only the
  activation briefly pauses writes.
- Data the target refuses: `failed`, `DATA_MIGRATION_REQUIRED` (CLI exit 2), nothing activated. Not
  transient. Message and report name each requirement: operation (`populate-required`,
  `remove-facts`, …), subject, observed facts. Repair in a maintenance session, delete facts that
  should go, or migrate online and install again.
- An Edge endpoint's lifetime is `onDelete: 'restrict' | 'detach'` (`schema.md`). Deleting a Node
  detaches the Edges other Domains hold toward it; the Mutation result does not report them and
  your Domain cannot query their Edge Classes to move them first. Agree a Class change that
  recreates Nodes (rename, merge, split) with every dependent Domain. In a maintenance session that
  delete is refused `MUTATION_POST_STATE_INVALID`.

## Following an install

- Keep the printed Execution, even when the CLI stops waiting first (exit 0 without `changed`).
  Follow it with `astrale execution status|result <execution>` as the same identity, Root or an
  `execution.reader`. Never resubmit an install to learn whether it worked.
- Install needs the Kernel Role `domain.installer`, uninstall `domain.uninstaller` (or Root);
  `release.md`, Authority an install needs.
- After a transport failure the Kernel may already have accepted it: install again with a fresh
  operation; while the first still changes the Schema the second is refused `SCHEMA_CHANGE_ACTIVE`,
  naming that Execution.
- An operation id names one request with a final outcome. Reusing it replays only that exact request
  (`replayed`); anything else under it is refused `SCHEMA_OPERATION_CONFLICT`. A call refused before
  dispatch (validation, authority, `SCHEMA_CHANGE_ACTIVE`) leaves the id free. After `failed` or
  `cancelled`, use a fresh operation.

## Dependency compatibility and grouped activation

- A Domain keeps the exact dependency revision it was authored against. The Kernel binds it to
  another active revision when the structural comparison preserves its referenced Schema,
  inheritance obligations, and the callables and Classes its release scopes name (`policies.md`);
  a new dependency revision alone does not force rebuilding dependents.
- `SCHEMA_DEPENDENCY_INCOMPATIBLE` / `SCHEMA_DEPENDENTS_INCOMPATIBLE` name the affected keys and
  Domains. Rebuild the incompatible consumers and their affected reverse dependents against the
  intended closure; deploy all candidates; install the changed dependency and those consumers as
  explicit roots of one grouped install. Embedded dependencies are not roots. Uninstalling a
  dependent does not repair compatibility.
- Grouped activation is atomic across its roots; the install Execution and manual repairs are not.
  Consent to an issuer change only after checking it (`release.md`).

```sh
astrale domain install "$URL_A" "$URL_B" -i staging
astrale domain install a.example@2.1.0 b.example@3.0.0 -i production
```

## Staged online transition: expand, migrate, contract

Online, every write is checked against the active Schema.

1. Expand: the Schema accepts both representations; readers read both, writers produce the new one.
2. Move every producer off the old form (older deployments, jobs, imports, clients). Migrate data in
   bounded, restart-safe batches that do not overwrite concurrent updates.
3. Verify no old representation remains and no producer can recreate it; then tighten the Schema
   and remove compatibility code. A rollback must not reintroduce an incompatible writer.

Qualify each installed revision before the next stage. Deploying the final revision does not make a
cleanup legal under the active one. Removing a required (`1`) relationship while keeping its Nodes:

1. install a revision loosening the endpoint from `1` to `0..1`;
2. delete every Edge of that Class;
3. install the revision removing the Edge Class.

In a maintenance session that is one target: install the final revision, delete the Edges, apply.

## Uninstalling a Domain with data

`astrale domain uninstall` removes the selected Domains in one activation.

- Safe mode (default) deletes nothing: refused `remove-facts` for each of their Classes still
  holding facts, whatever their number.
- `--destructive` retires those Classes at activation, whatever their size: their facts become
  invisible to every read and write, then the Execution purges them in batches (`detail.phase`
  `purging`, `detail.purge: { removed, total? }`). After the activation commits it cannot be
  cancelled or deleted (`EXECUTION_EXIT_REFUSED`) and ends `completed`.
- Either mode: Edges of surviving Classes follow their lifetimes; a restricting Edge at a leaving
  Node refuses the uninstall as `restricted-deletion` until deleted. Surviving dependents block it.
  A refused uninstall deleted nothing.

## Maintenance repair sessions

Requires Root as both executor and caller; closes the **whole Instance**. Every other caller is
refused `INSTANCE_MAINTENANCE` (`BACKEND_UNAVAILABLE` 5001 with a retry delay; CLI exit 75 once its
retries run out), and Root's writes are refused while `apply` validates. Prepare the repair before
entering; warn the Instance's users.

- Root: on an Instance you own, `astrale instance root import <slug>` saves it as `<slug>-root`
  (`--as <slug>-root`). A Shell administrator or business role is not Root. Record identity,
  Instance, reason and effects of every Root use.
- During the session Root writes raw graph Mutations in the union of the source and target
  vocabularies, with the state rules (required Properties, cardinality, accepted endpoints) of
  neither; `apply` validates against the target and activates in one step. No intermediate
  revision. Application Actions stay closed, even to Root. The Kernel serves no Query v7 in a
  session: read with Query V6.

1. Retain source revisions, exact target releases, representative node ids/Properties and Edge
   endpoints. Plan the repair toward both target and source before entering.
2. `install --mode maintenance --operation <retained>`. The CLI waits until the Instance is drained
   and the session awaits its first command (`--no-wait` returns the Execution at once). Keep it.
3. After `--no-wait`, poll status until `detail.phase` is `awaiting`; stop on a terminal failure or
   cancel. A maintenance request without a Schema change is refused `SCHEMA_INPUT_INVALID`.
4. Repair: a rename is a copy into the target key plus a delete of the source key. Record each
   committed batch; several Mutations are not one atomic migration.
5. `astrale domain installation apply` sends exactly the command the session awaits
   (`detail.command`); while the session drains or attempts it is refused `SESSION_NOT_AWAITING`.
   `apply` validates, activates and reopens the Instance: it is not a dry run. An accepted signal
   only acknowledges the command. `--validation-scope full` revalidates every retained fact. Keep
   the default sampled counts: under `--validation-counts exact`, a value rule (enum, length, type)
   rejecting thousands of distinct values can keep the attempt from a verdict, Instance closed.
6. A refused validation leaves its report and returns the same session to repair; fix, apply
   again. After a client restart, reconnect to the same Execution.
7. Require a completed outcome and result, then verify active revisions, retained data, and normal
   non-Root reads and writes. An Execution id, a status read or an accepted signal proves nothing.

```sh
astrale instance root import "$INSTANCE" --yes
astrale domain install "$TARGET_URL" -i "$INSTANCE" --as "$INSTANCE-root" \
  --operation "$OPERATION" --mode maintenance --no-wait --json
astrale execution status "$EXECUTION" -i "$INSTANCE" --as "$INSTANCE-root" --json
# repair, then apply at the command the session awaits
astrale domain installation apply "$EXECUTION" -i "$INSTANCE" --as "$INSTANCE-root" \
  --validation-scope full --json
astrale execution result "$EXECUTION" --wait -i "$INSTANCE" --as "$INSTANCE-root" --json
```

The online refusal's report, or `detail.report.summary` after a refused `apply`, lists each failing
rule: Class, Property, count, ≤ 20 offenders (`truncated` past them). Beyond them, read the Class as
Root (`astrale query --class`, V6) and select offenders yourself. A repair is an ordinary Mutation
(`astrale mutate --as "$INSTANCE-root"`; `--dry` checks its form, not the data) keyed by full
Property keys; `node.delete` and `edge.delete` (`edge: { source, target, class }`) remove facts:

```json
{ "operations": [{ "op": "node.update", "node": "@task-42", "class": "tasks.example:class.Task",
  "props": { "set": { "tasks.example:class.Task.property.title": "Draft" },
             "unset": ["tasks.example:class.Task.property.name"] } }] }
```

Exits:

| Command | Effect |
| --- | --- |
| `apply` | Validates the target, activates, reopens |
| `domain installation abort` | Stops the validation attempt toward the target; back to repair. An attempt back to the source cannot be aborted |
| `astrale execution cancel` | Validates and reactivates the source: may also require repair |
| no command by `detail.expires` | An attempt back to the source |
| forced cancel, delete | Refused `EXECUTION_EXIT_REFUSED`; only the Host operator releases a stuck session |
| `astrale execution resume` | Resumes a paused Execution; does not reopen the Instance |

No rollback: neither `abort` nor `cancel` undoes committed repairs. Going back after a completed
`apply` is a new session installing the previous release and reversing the repair.

## External effects

A migration touching a remote system is a durable Workflow with explicit failure and retry
semantics (`workflows.md`), never one atomic Mutation; preserve immutable evidence.

## Qualify a Schema revision

1. Retain the current origin/revision and representative data.
2. Build and deploy the candidate (installs nothing); verify the release its deployment serves, its
   Bundle and its revision.
3. Install through `astrale domain install` or Client APIs; for a breaking change, run the whole
   maintenance session on a populated QA Instance and time the closure.
4. Repeat the same intent and prove convergence.
5. Read existing data, invoke retained behavior, exercise the added behavior.
6. Retain exact failures; no destructive cleanup until the evidence is complete.
