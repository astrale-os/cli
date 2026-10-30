# Testing

Read for Domain tests, fixtures, demos and live acceptance.

## Test at the semantic owner

| Behavior | Smallest real boundary |
| --- | --- |
| Projection, Rules | Ordinary function calls |
| A Query | `runQuery(client, domain, query, input)` with a narrow `QueryClient` double: assert the exact documents, page size and cursor. `checkQuery(query, sampleInput, { domain })` (`@astrale-os/sdk/testing`) checks its bounds and relation scopes without a Kernel |
| A Mutation | `executeMutation(client, domain, mutation, input)` with a narrow `MutationClient` double: assert the exact atomic document |
| Action orchestration | The Action definition's `run` with an admitted, typed context (an Action has no Step API) |
| Durable Workflow step order and values | `createTestWorkflowEngine` (`workflows.md`, Test) |
| Inline Workflow step order and values | An inline Step implementation |
| Action/Workflow exhaustiveness, Provider initialization | A realized Runtime |
| Installation, identity, Roles, scopes, callable authority, Policy, routing, persistence | A real Kernel |

- No general fake Kernel: it re-implements authority, visibility, transactions, paging and error
  semantics and proves none of them.
- A hand-copied builder, or an assertion on the document version alone, bypasses the SDK's
  realization and projection.
- Assert the invariant-bearing operations and the absence of unintended writes, not call counts.

## What a test proves

- A constructed stale-state precondition proves authoring only. A refused concurrent edit without
  partial writes needs a Kernel transaction: for read → Rule → Mutation, change the guarded fact
  between the read and the commit.
- A "complete collection" claim needs a fixture that crosses a page boundary, and a read past its
  bound must raise `TOO_MANY` without publishing partial output.
- An inline Workflow run in memory proves structure and step order; never durable replay,
  exactly-once effects, compensation or crash recovery. `createTestWorkflowEngine` proves replay
  against the code, not crash recovery on a Host.
- Compute expected results independently of the implementation; reusing its calculation proves
  agreement only.
- A complete delivery exercises every exposed Action and Workflow with representative success and
  applicable refusal inputs; a focused change, the affected callables and their dependent
  invariants. Binding metadata, AST checks or one tested handler never stand in for an unexecuted
  public callable.

## Core and fixtures

- Core is fixed Domain-owned installation data: never demo data, mutable product state, a
  post-install hook or a migration mechanism.
- Throwaway sample data: a test fixture or an explicitly invoked demo owner. Runtime- or
  environment-dependent setup: an Action, a Workflow or an operator-owned journey with declared
  requirements.
- Demo data: Datasets under `tests/`, referenced from `astrale.config.ts` as
  `tests: tests({ datasets: [dataset('./tests/datasets/demo.ts')] })`. `dataset(path)` is lazy:
  build and deploy never load the module, and a Dataset never reaches a Build, a Release or an
  installation. Studio extracts referenced Datasets on demand (Tests tab); several per project need
  distinct ids. Production code never imports `tests/`. Authoring: `datasets.md`.

## Live acceptance

- Deployment or integration claims: a representative journey on the intended Kernel, with real
  credentials and the deployment adapter the product ships. Package or release qualification: also
  a packed or published consumer outside the source workspace. A managed-remote test needs no local
  Kernel.
- Isolate destructive lifecycle scenarios from shared instances; record the exact deployed and
  installed revisions.
- Observe through public Client APIs. Keep authentication, authority, Policy, handler, Provider,
  persistence, update, uninstall and cleanup evidence distinct; report locally tested, remotely
  observed and not exercised separately.
- Durable regression tests stay with their production owner; situational logs, credentials and
  proof tooling stay out of the delivery.

Cleanup converges from every partial state (nothing installed, dependencies only, the full closure):

1. Prove Domain presence with a public Domain-root point observation before querying its Classes.
   Only the exact not-found result is absence; a Schema-introspection failure is not.
2. `QUERY_DEFINITION_UNRESOLVED` is an empty observation only once the owning Domain is proven
   absent. Never suppress authentication, authorization, protocol, unknown-outcome or unrelated
   query failures.
3. Delete only independently observed business facts, then uninstall dependents before
   dependencies.

### Design focused scenarios

One semantic claim per scenario, with the smallest sufficient criteria; evidence classes need not
all appear in each. For example:

- cross-Domain package boundary, install ordering and caller-bound dispatch;
- delegation authority: a `caller` operation refused when the caller fails the Role or Policy or
  the Domain lacks the scope, and a dependency call as `self` decided by its Policy alone;
- multi-user Policy denial and revocation;
- local service, tunnel and real external API delivery;
- a thin integrated smoke composing already-proven pieces, without repeating every adversarial
  check.

Criteria observe outcomes and security boundaries, never private filenames, test counts, one source
layout or incidental output fields, and are never stricter than the public contract. Add a
criterion only when its absence leaves the claim unsupported.

### Bound convergence

Keep the product claim and package versions explicit. A defect that invalidates the claim: keep
the reproduction and fix it at its owner; otherwise track it separately. Never expand the test
framework or the task automatically, nor add scenarios or tooling for evidence an existing test
already supplies.
