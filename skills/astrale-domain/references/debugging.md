# Debugging

Debug the deployed lifecycle in order. Source correctness alone does not prove live behavior.

```text
source Schema and Runtime
  -> Build
  -> Release and Addressing
  -> provider deployment
  -> Publication/JWKS/Bundle
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
- Authentication identifies an exact `(iss, sub)` pair, not a Domain origin. The verified Publication
  binds semantic origin, issuer/subject, and concrete endpoints; compare those rather than hostnames alone.
- One Kernel can publish intrinsic `kernel.astrale.ai` and host installed `projects.example` at the same
  issuer. Select the installed product by its Domain origin, not the intrinsic Publication's origin.

## Follow an invocation only when diagnosing transport

```text
installed-Domain binding → source Kernel → local result
                                       ↘ verified protocol redirect → destination
                                         subsequent calls may reuse the learned route/credential
```

- The SDK session owns discovery, delegation transport, redirect admission, and credential reuse.
  Do not assume every call performs separate delegate/exchange requests; local and warm calls differ.
- A protocol redirect carries a destination credential, not permission to forward the original token
  to any URL. Only the pinned source may redirect; a destination redirect is rejected.
- Route reuse is partitioned by source, target, credential, delegation, and expected Schema revision.
  Changing identity must not reuse another caller's credential; route artifacts are confidential.
- Cached routes expire with their admitted lifetime/credential. An admitted stale-route or route-miss
  failure can trigger bounded source recovery; business refusals and arbitrary timeouts are not retry signals.
- A revision mismatch requires a coherent installed binding/deployment, not stripping revision checks.
  Compare safe route and Publication metadata; never log credentials to investigate a cache issue.

## Classify admission failures

- Authentication failure: credential/session evidence was not admitted.
- Callable authority failure: inspect the installed executor and the caller's complete Grant separately;
  missing caller `can_use` alone is not a diagnosis because callable Policy can supply caller authority.
- Policy refusal: establish which check failed and whether another authority branch applies. See
  `policies.md`; a Policy is not universally an additional gate after direct capability.
- Input failure: callable validation rejected input before execution.

Confirm denied calls caused no Action, Workflow step, Provider, or graph effect. Never add a handler
fallback or anonymous/Via bypass to make a test pass.

For a nested Kernel call, inspect the installed Domain's requested and materialized capabilities
before changing auth mode or Policy. Successful remote `Function.admit` followed by `Access denied`
before the expected Kernel syscall suggests a nested authority problem; it does not identify which
edge or traversal failed. Check exact requirements, materialized capabilities, the selected
caller/Domain authority mode, and the deployed Kernel revision. Do not grant the human dynamic
authority to conceal the failure. After correcting the proven cause, repeat the call and observe
effects independently.

Treat authentication and registration journal inputs as secret unless their redaction is independently
proven. Do not retain or display a complete journal record merely to learn the phase: proof JWTs,
keys, credentials, or headers may be nested in otherwise useful callable input. Prefer safe outcome,
topic, callable, and capability metadata, and destroy isolated journal state during terminal cleanup.

## Runtime failures

- Runtime initialization errors occur before invocation; inspect admitted environment and Provider
  construction without printing secrets.
- Action dispatch errors involve one registered Action address and have no Step lifecycle.
- Workflow failures should name the stable step that failed; step results must be JSON-serializable.
- Provider response errors belong to Provider admission; unexpected network defects must not become
  caller-input errors.

## Graph failures

Use resolved Schema definitions and public Query/Mutation APIs. Check pagination, receiver identity,
typed Edge direction, live Mutation preconditions, and installed revision. A read before a Mutation is
not transaction evidence.

## Deployment and installation

Fetch deployed Publication, discovery/JWKS, and Bundle rather than trusting intended Addressing. Then
inspect Kernel installation state. If a Worker cannot reach a local Kernel tunnel, prove public health
and Worker-to-Kernel reachability separately.

## Package drift

For a downstream Domain:

- manifest declares SDK and public adapter, not Kernel implementation packages;
- emitted declarations expose SDK facades;
- lockfile has no source/workspace override for Astrale packages;
- Worker bundle excludes linter, declaration-packaging, compiler, and scaffold closure.

Reproduce from a packed or published package outside every repository before labeling a workspace-only
failure as a product defect.
