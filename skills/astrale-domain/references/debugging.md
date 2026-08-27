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

## Classify admission failures

- Authentication failure: credential/session evidence was not admitted.
- Authority failure: caller lacks callable `can_use` authority.
- Policy failure: authenticated and authorized caller does not satisfy Schema Policy.
- Input failure: callable validation rejected input before execution.

Confirm denied calls caused no Action, Workflow step, Provider, or graph effect. Never add a handler
fallback or anonymous/Via bypass to make a test pass.

For a nested Kernel call, inspect the installed Domain's requested and materialized capabilities
before changing auth mode or Policy. Successful remote `Function.admit` followed by `Access denied`
before the expected Kernel syscall is evidence of a missing protected-callable requirement, not a
reason to grant the human dynamic authority. Repeat the same call only after the exact
installation-owned capability is materialized, then observe effects independently.

Treat authentication and provision journal inputs as secret unless their redaction is independently
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
