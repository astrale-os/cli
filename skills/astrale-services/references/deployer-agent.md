# Deploying a callable Domain through Services

For code or requirements that become a hosted Domain with callable Functions. A plain API or
background job: [workflows.md](workflows.md).

1. Inspect the source, identify the Function contracts and run the project's tests. Author the
   Domain with its pinned SDK and configuration (`astrale-domain` skill).
2. Configure a Project Environment with `astrale()` from `@astrale-os/adapter-astrale`. An
   Environment holds deployment configuration and secrets; it names no consumer Kernel.
3. `astrale-domain deploy <environment>` (or the project's deploy script). The adapter sends a
   canonical Worker deployment request to Admin's Services and verifies the served Domain release.
   Keep the immutable URL and the release and build digests from `DeployResultV1`, which carries no
   owner and no Service or deployment ids. Then match that URL in
   `astrale-domain list --environment <environment> --json`: `id` is the deployment id, `owner` the
   owner, `callTarget.service` holds the Service id.
4. Only when installation is requested: `astrale domain install <deployment-url> -i <consumer>` on
   each selected consumer, following the CLI's issuer-change consent when it applies. The installing
   identity needs the consumer's Kernel `domain.installer` Role and the right to grant every Kernel
   Role membership the release requests; Root has both. A release's Roles and scopes:
   [Policies](../../astrale-domain/references/policies.md). Deploying, promoting a Service or
   installing on one consumer upgrades no other consumer.
5. Confirm the exact installed release, then invoke the requested Functions through each consumer
   under its intended application identity, with representative inputs. Infrastructure readiness
   and Root access prove nothing about consumer Policy behavior.
6. Exercise secrets, schedules or cleanup only when requested ([workflows.md](workflows.md),
   [schema.md](schema.md)).

## Upgrade and rollback

- Releases A and B have separate immutable URLs. A consumer pinned to A stays on A until it is
  explicitly installed to B, even when B is current on the Service. Test each requested consumer's
  own pin.
- Roll back Service traffic or crons: promote an older active deployment. Roll back a consumer:
  install the chosen prior release on it, with issuer consent when required. Compatible code never
  replaces an old deployment in place.
- A failed deployment or an ambiguous reply: inspect its exact coordinates and recover within
  bounds. Check which deployment is current before claiming the prior release stayed current.
  Never retire useful releases or remove consumer installations to tidy a failed candidate.

## Handoff

Return the source and package versions, project and environment, owner and Service and deployment
ids from the matched listing row, exact URLs and digests, promotion state, and observed health and
application results. For a Domain, also its release identity, each requested consumer's installed
pin, and the canonical Function call paths with observed results. Keep source and package evidence
distinct from installed and runtime evidence. Never return tokens, private keys, raw secret files
or secret values.

Deleting the publishing Service withdraws its deployments without uninstalling consumer Schemas: a
still-installed consumer can lose callable availability. Retire or delete only the requested
resources; a requested consumer uninstall is a separate operation.
