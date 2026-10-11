# Deploying a callable Domain through Services

Use this workflow when code or requirements should become a hosted Astrale Domain with callable
Functions. A plain API or background job does not need this workflow; use
[workflows.md](workflows.md) instead.

1. Inspect the source, identify the intended Function contracts, and run the project's tests.
   Author the Domain using its pinned SDK and project configuration. The `astrale-domain` skill
   covers Schema/runtime authoring and release commands when available.
2. Configure a Project Environment using `astrale()` from `@astrale-os/adapter-astrale`. An
   Environment contains deployment configuration and secrets; it names no consumer Kernel.
3. Run `astrale-domain deploy <environment>` (or the project's deploy script). The adapter sends a
   canonical Worker deployment request to Admin's Services and verifies the served Domain release.
   Retain the immutable URL and release/build digests from DeployResultV1. Then run
   `astrale-domain list --environment <environment> --json` and match that URL: its `id` is the
   deployment ID, `owner` is the owner, and `callTarget.service` contains the Service node ID.
   DeployResultV1 itself has no owner or Service/deployment node IDs.
4. If installation is part of the request, run `astrale domain install <deployment-url> -i <consumer>`
   on each selected consumer. Follow the CLI's issuer-change consent contract when it applies.
   Deploying, promoting a Service, and installing on one consumer do not upgrade other consumers.
5. Confirm the exact installed release and invoke the requested Functions through each consumer
   with its intended application identity and representative inputs. Infrastructure readiness and
   root access do not prove consumer policy behavior.
6. Exercise secrets, schedules, or cleanup only when they belong to the requested scope. Use
   [workflows.md](workflows.md) for management and [schema.md](schema.md) for authority boundaries.

## Upgrade and rollback verification

Release A and changed release B have separate immutable URLs. Deploy B and verify its served
release. A consumer pinned to A continues using A until explicitly installed to B, even if B is
current on the Service. When multiple consumers were requested, inspect and test their independent
pins rather than assuming one install updates all of them.

To roll back stable Service traffic or crons, promote an older active deployment. To roll back a
consumer Domain, explicitly install the chosen prior release on that consumer, including any
required issuer consent. Do not promise that compatible code replaces an old deployment in place.

A failed deployment or ambiguous reply needs inspection of its exact coordinates and bounded
recovery. Check the current deployment before claiming the prior release stayed current; do not
retire useful releases or remove consumer installations merely to tidy a failed candidate.

## Handoff

Return the source/package versions, project/environment, owner and Service/deployment IDs from
the matched listing row, exact
URLs and digests, promotion state, and observed health/application results. For a Domain, also
include its release identity, each requested consumer's installed pin, and canonical Function call
paths with observed results. Distinguish source/package evidence from installed/runtime evidence.
Never return tokens, private keys, raw secret files, or secret values.

Deletion of the publishing Service withdraws its deployments without uninstalling consumer
Schemas; a still-installed consumer may consequently lose callable availability. Retire/delete
only the requested resources and coordinate any explicitly requested consumer uninstall separately.
