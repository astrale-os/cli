# Services contract

Origin: `services.astrale.ai`. Provider operations run on the Admin instance; use
`astrale call ... --admin` (or `--admin=<bookmark>` for an explicit Admin target).

## Resources and ownership

- `Service` / `CloudflareService`: the stable `(project, environment)` resource. Its opaque name
  is computed by the SDK's `serviceName`; its URL serves `current_deployment`. States: `active`,
  `deleting`. This address is not owner-scoped: changing caller does not create another owner's
  copy of the same project/environment.
- `service_owned_by`: exactly one owner Identity, set on first deploy and changed only by
  `transfer`. The caller owns the first deploy by default. A request may name an `owner` only when
  the caller is or acts as that Identity (`ActAs`). `OwnService` includes authority reached through
  `extends_with`; membership of an owning group grants management, including deletion.
- `Deployment` / `CloudflareDeployment`: one Worker build and frozen configuration. Its opaque
  label covers the Service name, build digest, and configuration digest; it has its own URL and,
  when requested, its own signing identity. States: `deploying`, `active`, `failed`, `retiring`,
  `retired`. Retirement is permanent.
- `deployment_of` and `current_deployment`: a deployment belongs to its Service and inherits its
  ownership; promotion changes which active deployment the Service serves.

Methods are authenticated and enforce ownership. A caller lacking ownership sees
`SERVICE_NOT_FOUND` / `DEPLOYMENT_NOT_FOUND`; deploying an existing Service owned elsewhere gives
`service-owned-elsewhere`. Registration of an account grants none of this authority.

## Deploy input

The static `CloudflareService.deploy` accepts `WorkerDeploymentRequestV1` from
`@astrale-os/sdk/deployment/worker`. Prefer `@astrale-os/adapter-astrale/services` to assemble and
send it; a hand-written old `serviceKey`, `entry`, or flat module payload is not this contract.

| Member | Meaning |
| --- | --- |
| `format`, `version` | `astrale.worker.deployment-request`, `1` |
| `project`, `environment` | Stable Service coordinates |
| `buildDigest`, `label` | Derived from admitted Worker bytes and configuration, not invented identifiers |
| `worker` | `mainModule`, build `manifest`, `modules`, optional `assets`; each content envelope carries encoding, decoded size, and base64 content/chunks |
| `configuration` | Canonical `astrale.worker.configuration` v1: compatibility date/flags, vars, declared secret names, and `record`, `signingIdentity`, `router` booleans |
| `secrets` | Values for exactly the names the configuration declares; write-only input |
| `record` | Opaque bytes/media type, present exactly when configuration requests a record |
| `readiness` | Optional paths that must return 200 with the uploaded version's `x-astrale-worker-version` |
| `promote` | Defaults to true; false leaves the Service's current deployment unchanged |
| `owner` | Optional first-owner choice, subject to `ActAs`; not an ownership bypass |

Services recomputes the build and address. Runtime settings and secret names affect the label;
secret values do not. The same release reuses its deployment and may update that deployment's
secret values in place. A new code/configuration release gets another deployment, leaving earlier
ones served. Do not append compatibility flags or otherwise edit configuration after hashing.
Host-owned bindings (`WORKER_URL`, `ASTRALE_BUILD_DIGEST`, `ASTRALE_VERSION_METADATA`,
`ASTRALE_SIGNING_IDENTITY`, `ROUTER`, `ASSETS`) are not user vars or secrets.

## Results and management

A deploy result is either:

- `kind: deployed`, `state: created | reused`, `secrets.state: bound | unchanged | updated`, and
  `deployment` with `id`, `serviceId`, opaque `service` name, `label`, `project`, `environment`,
  `url`, owner, state, digests, `current`, timestamps, optional `record` (bytes and media type), and `signingKeyId`; or
- `kind: rejected`, `reason`, `message`, and optional `retryAfter`.

A JSON response or exit zero alone does not establish deployment success. The adapter throws
`ServicesRefusal` for a deploy rejection. Ownership or validation refusals need corrected intent;
`service-unavailable` may follow effects, so retain the same release and respect its retry advice
within a bounded recovery attempt. Never allocate a different project to route around ownership.

`owner` in deploy or transfer input is a bare Identity node ID (no `@` prefix).

Static `CloudflareService.hosting` describes hosting; `list({project?, environment?})` returns
visible deployment summaries, not Service-only rows. Use `summary.serviceId` for Service Methods
and `summary.id` for deployment retirement.

| Receiver | Methods |
| --- | --- |
| `CloudflareService` | `promote({label})`, `transfer({owner})`, `setSecret({name,value})`, `secrets({})`, `setSchedule({crons})`, `schedules({})`, `logs({label?,tail?,since?})`, `delete({})` |
| `CloudflareDeployment` | `retire({})` |

`setSecret` affects the Service's current deployment only. There is no `deleteSecret` Method:
adding/removing a secret name changes configuration and needs a new deployment. Removing a name
from a new deployment does not remove it from older ones. Services retains no secret values;
metadata listing cannot recover them. A generic Worker with its exact original deploy input can
rotate a non-current release with updated values and `promote: false`. For Domain releases use
the [identical redeploy and restore-current procedure](../../astrale-domain/references/release.md#secrets-of-a-deployment);
the Domain adapter always promotes.

Services neither creates consumer Domain/Function nodes nor returns their installed IDs. A Domain
release's origin, revision, issuer, and Publication belong to its deployer. Its record is opaque to
Services; the Domain tooling admits it. Installing that release is a separate consumer operation.
