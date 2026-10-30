# Debugging

Walk the deployed lifecycle in order; source correctness proves nothing live.

```text
source Schema and Runtime → Build → Release and Addressing → provider deployment
  → served release (release.json) / JWKS / Bundle → Kernel installation and active revision
  → authenticated invocation → graph/View observation
```

## Establish exact identities

Record source SHA, package versions, Schema origin/revision, Build/Release digests, deployment id,
serving URL, installed revision, caller `(iss, sub)`, callable key. A serving URL is not Schema
identity; the newest deployment is not necessarily installed.

## Issuer, Domain origin, and URL are different coordinates

| Coordinate | Selects | Example |
| --- | --- | --- |
| `kernel: IssuerId` | Canonical Kernel security authority | `https://host.example/api` |
| `origin: DomainOrigin` | Semantic Domain | `projects.example` |
| `invocationUrl` | Concrete network resource | `https://host.example/api/invoke` |
| `transportOrigin` | Browser origin: scheme, host, port | `https://host.example` |

- Never `new URL(kernel).origin`: it drops the identity-bearing `/api`. Derive Kernel endpoints with
  SDK helpers, never a separately configured invocation URL.
- Bundles, discovery, provider routes, callbacks and probes keep independent URLs; a Router may
  proxy a Kernel without changing its issuer.
- Authentication names `(iss, sub)`, not a Domain origin. Compare the verified release
  (`/.well-known/astrale/release.json`: origin, issuer/subject, endpoints), not hostnames.
- One Kernel publishes intrinsic `kernel.astrale.ai` and hosts installed `projects.example` at the
  same issuer: select by the installed Domain origin.

## Follow an invocation only when diagnosing transport

```text
installed-Domain binding → source Kernel → local result
                                       ↘ verified protocol redirect → destination
                                         later calls may reuse the learned route/credential
```

- The SDK session owns discovery, delegation, redirect admission and credential reuse; not every
  call makes separate delegate/exchange requests (local and warm calls differ). Use the session the
  host selects.
- A Domain token exchange makes the Domain the executor; the caller stays the verified source
  identity. Policies evaluate the caller; Journal records name the executor in `principal`. The
  executor bounds every operation: it holds the syscall's Role, and owns each Class or callable,
  holds a scope on it, or itself passes its Policy. An identity acting for itself meets no ceiling.
- A redirect carries a destination credential; never forward the original token. Only the pinned
  source may redirect; a destination redirect is rejected.
- Route reuse is partitioned by source, target, credential, delegation and expected Schema revision;
  route artifacts are confidential. Only an admitted stale-route or route-miss triggers bounded
  source recovery; business refusals and timeouts are not retry signals.
- Kernel admission uses the installed Registry contract; the serving SDK validates against its
  deployed Release. A mismatch needs a coherent install/deployment, never stripped revision checks.

## Classify admission failures

| Failure | Check |
| --- | --- |
| Authentication | credential/session evidence not admitted |
| Syscall | Query, Mutation, … admit holders of their Kernel Role (`graph.reader`, `graph.writer`, …). `self`: the Domain's Roles; `caller`: the caller's and the Domain's, separately. Roles may come through `extends_with` (bundle, profile, Group) |
| Graph / callable authority | delegated: the executor's ceiling, then the caller's rule; direct: the rule alone. Without a scope the ceiling holds only if the executor owns the target or itself passes its rule; the caller's passing Policy never compensates. The callee Domain never substitutes for the calling executor. Kernel behavior: the Domain's own writes on a foreign Class are decided by that Class's write slot; no scope widens them |
| Policy | Function Root/owner alternatives ≠ Class owner/rule alternatives; neither a Role nor a scope bypasses a business Policy |
| Input | callable validation rejected input before execution |

- Read `policies.md` before changing requirements. Confirm a denied call caused no Action,
  Workflow Step, Provider or graph effect. Never add a handler fallback or anonymous bypass, and
  never grant the human a Role to hide a failure.
- Nested Kernel call: compare requested and materialized Roles and scopes
  (`astrale introspect <origin>`, `capabilities`) before changing auth mode or Policy. With
  `authority.reader`, follow an Identity's memberships, then each target's:
  `astrale query @<identity-id> --edge /:kernel.astrale.ai:class.extends_with --direction outgoing`.
- Remote `Function.admit` succeeds then `Access denied` before the expected syscall: a nested
  authority problem, not which Role, scope or slot. Check requirements, materialized Roles and
  scopes, the `caller`/`self` session, and the deployed Kernel revision; after the fix, repeat and
  observe effects independently.
- Authentication and registration journal inputs are secret (proof JWTs, keys, headers nest in
  callable input): read outcome, topic, callable and authority metadata, never whole records;
  destroy isolated journal state at cleanup.

## Runtime failures

- Initialization errors precede invocation: inspect admitted environment and Provider construction
  without printing secrets.
- Action dispatch: one registered Action address, no Step lifecycle.
- Durable Workflow: an exhausted Step ends `STEP_EXHAUSTED`, naming the Step and the Kernel refusal;
  a paused Execution gives no cause: read the Domain's logs (`workflows.md`).
- Provider response errors belong to Provider admission; network defects never become caller-input
  errors.

## Graph failures

Check pagination, receiver identity, typed Edge direction, live Mutation preconditions, installed
revision. A read before a Mutation is not transaction evidence.

## Deployment and installation

Fetch the served release (release.json), discovery/JWKS and Bundle; never trust intended
Addressing. Then Kernel installation state. `SCHEMA_REQUIREMENTS_UNSATISFIED`: `details.denials`
names, by Edge Class and target, each Role membership, granter or scope the installer may not pose
or remove (`release.md`). A Worker that cannot reach a local Kernel tunnel: prove public health and
Worker-to-Kernel reachability separately.

## Package drift

A downstream Domain's manifest declares the SDK and public adapter only; emitted declarations expose
SDK facades; the lockfile has no source/workspace override for Astrale packages; the Worker bundle
excludes linter, declaration-packaging, compiler and scaffold closure. Reproduce from a packed or
published package outside every repository before calling a workspace-only failure a product
defect.
