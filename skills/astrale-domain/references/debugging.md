# Debugging

Debug the deployed lifecycle in order. Source correctness alone does not prove live behavior.

```text
source Schema and Runtime
  -> Build
  -> Release and Addressing
  -> provider deployment
  -> served release (release.json)/JWKS/Bundle
  -> Kernel installation and active revision
  -> authenticated invocation
  -> graph/View observation
```

## Establish exact identities

Record the source SHA, package versions, Schema origin/revision, Build/Release digests, deployment id,
serving URL, installed revision, caller identity coordinates, and callable key. Do not use a serving
URL as Schema identity or assume the newest deployment is installed.

## Issuer, Domain origin, and URL are different coordinates

Use this distinction when discovery, authentication, or routing fails; ordinary Domain code should
use SDK bindings rather than reconstruct these coordinates.

| Coordinate | Selects | Example |
| --- | --- | --- |
| `kernel: IssuerId` | Canonical Kernel security authority | `https://host.example/api` |
| `origin: DomainOrigin` | Semantic Domain | `projects.example` |
| `invocationUrl` | Concrete network resource | `https://host.example/api/invoke` |
| `transportOrigin` | Browser origin: scheme, host, port | `https://host.example` |

- Never normalize an issuer with `new URL(kernel).origin`: it drops the identity-bearing `/api`.
  Derive Kernel protocol endpoints through SDK helpers, not a separately configurable invocation URL.
- Keep independent URLs for bundles, external discovery, provider routes, callbacks, and probes.
  A Router may proxy a Kernel without changing its canonical issuer.
- Authentication identifies an exact `(iss, sub)` pair, not a Domain origin. The verified release
  (`/.well-known/astrale/release.json`) binds semantic origin, issuer/subject, and concrete endpoints; compare those rather than
  hostnames alone.
- One Kernel can publish intrinsic `kernel.astrale.ai` and host installed `projects.example` at the same
  issuer. Select the installed product by its Domain origin, not the intrinsic release's origin.

## Follow an invocation only when diagnosing transport

```text
installed-Domain binding → source Kernel → local result
                                       ↘ verified protocol redirect → destination
                                         subsequent calls may reuse the learned route/credential
```

- The SDK session owns discovery, delegation transport, redirect admission, and credential reuse.
  Do not assume every call performs separate delegate/exchange requests; local and warm calls differ.
- A Domain token exchange makes that Domain's installed identity the executor while the caller stays
  the verified source identity, usually the user. This changes the executor's Roles, scopes, and
  ownership, not the caller: Policies still evaluate the user, and Journal records name the Domain as
  `principal`. It also bounds every operation of the session: the Domain must hold the
  syscall's Role, and own each Class or callable, hold a scope on it, or itself pass its Policy. An
  identity acting for itself meets no such ceiling; use the session selected by the host.
- A protocol redirect carries a destination credential, not permission to forward the original token
  to any URL. Only the pinned source may redirect; a destination redirect is rejected.
- Route reuse is partitioned by source, target, credential, delegation, and expected Schema revision.
  Changing identity must not reuse another caller's credential; route artifacts are confidential.
- Cached routes expire with their admitted lifetime/credential. An admitted stale-route or route-miss
  failure can trigger bounded source recovery; business refusals and arbitrary timeouts are not retry signals.
- Kernel admission uses the installed Registry contract while the serving SDK validates the handler against
  its deployed Release. A mismatch requires coherent installation/deployment, not stripped revision checks;
  compare safe route and release metadata without logging credentials.

## Classify admission failures

- Authentication failure: credential/session evidence was not admitted.
- Syscall failure: Query, Mutation, and the other syscalls admit holders of their Kernel Role
  (`graph.reader`, `graph.writer`, ...). As `self`, inspect the Domain's Roles; as `caller`, inspect the
  caller's and the Domain's separately. A Role may be held through `extends_with` composition (a
  bundle, a profile, a Group).
- Graph or callable authority failure: distinguish a delegated operation (the Domain's ceiling, then
  the caller's rule), a direct one (the rule alone), and the Domain's own writes on a foreign Class
  (that Class's write slot; no scope widens them). Without a scope, the ceiling holds only when the
  Domain owns the target or itself passes its rule; the caller's passing Policy never compensates.
  The callee Domain never substitutes for the calling executor. See `policies.md` before changing
  requirements or slots.
- Policy refusal: distinguish Function Root/owner alternatives from Class owner/rule alternatives;
  neither a Role nor a scope bypasses a business Policy. Check the deployed Kernel's semantics first.
- Input failure: callable validation rejected input before execution.

Confirm denied calls caused no Action, Workflow step, Provider, or graph effect. Never add a handler
fallback or anonymous/Via bypass to make a test pass.

For a nested Kernel call, compare the installed Domain's requested and materialized Roles and
scopes (`astrale introspect <origin>`, `capabilities`) before changing auth mode or Policy. With
`authority.reader`, list an Identity's direct memberships, then follow each target for bundles and
Groups: `astrale query @<identity-id> --edge /:kernel.astrale.ai:class.extends_with --direction outgoing`.
Successful remote `Function.admit` followed by `Access denied` before the expected Kernel syscall
suggests a nested authority problem; it does not identify which Role, scope, or slot failed. Check
exact requirements, materialized Roles and scopes, the selected `caller`/`self` session, and the
deployed Kernel revision. Do not grant the human a Role to conceal the failure. After correcting the
proven cause, repeat the call and observe effects independently.

Treat authentication and registration journal inputs as secret unless their redaction is independently
proven. Do not retain or display a complete journal record merely to learn the phase: proof JWTs,
keys, credentials, or headers may be nested in otherwise useful callable input. Prefer safe outcome,
topic, callable, and authority metadata, and destroy isolated journal state during terminal cleanup.

## Runtime failures

- Runtime initialization errors occur before invocation; inspect admitted environment and Provider
  construction without printing secrets.
- Action dispatch errors involve one registered Action address and have no Step lifecycle.
- A durable Workflow whose Step spent its budget ends `STEP_EXHAUSTED`, naming the Step and the
  Kernel refusal; a paused Execution gives no cause, so read the Domain's logs (`workflows.md`).
- Provider response errors belong to Provider admission; unexpected network defects must not become
  caller-input errors.

## Graph failures

Use resolved Schema definitions and public Query/Mutation APIs. Check pagination, receiver identity,
typed Edge direction, live Mutation preconditions, and installed revision. A read before a Mutation is
not transaction evidence.

## Deployment and installation

Fetch the deployment's release (release.json), discovery/JWKS, and Bundle rather than trusting
intended Addressing. Then inspect Kernel installation state. An install refused
`SCHEMA_REQUIREMENTS_UNSATISFIED` names in `details.denials`, by Edge Class and target, each Role
membership, granter, or scope the installer may not pose or remove (`release.md`). If a Worker
cannot reach a local Kernel tunnel, prove public health and Worker-to-Kernel reachability separately.

## Package drift

For a downstream Domain:

- manifest declares SDK and public adapter, not Kernel implementation packages;
- emitted declarations expose SDK facades;
- lockfile has no source/workspace override for Astrale packages;
- Worker bundle excludes linter, declaration-packaging, compiler, and scaffold closure.

Reproduce from a packed or published package outside every repository before labeling a workspace-only
failure as a product defect.
