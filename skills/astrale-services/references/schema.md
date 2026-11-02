# Services contract

Origin `services.astrale.ai`. Operations run on the Admin instance: `astrale call ... --admin`
(`--admin=<bookmark>` for an explicit Admin target).

## Resources and ownership

| Resource | Contract |
| --- | --- |
| `Service` / `CloudflareService` | The stable `(project, environment)` resource; opaque name from the SDK's `serviceName`; its URL serves `current_deployment`. States `active`, `deleting`. Not owner-scoped: another caller never gets its own copy of the same project and environment |
| `service_owned_by` | Exactly one owner Identity, set on first deploy (the caller by default) and changed only by `transfer` |
| `Deployment` / `CloudflareDeployment` | One Worker build and frozen configuration; opaque label over the Service name, build digest and configuration digest; its own URL and, when requested, its own signing identity. States `deploying`, `active`, `failed`, `retiring`, `retired`; retirement is permanent |
| `deployment_of`, `current_deployment` | A deployment belongs to its Service and inherits its ownership; promotion changes which active deployment the Service serves |

- A request names an `owner` only when the caller is or acts as that Identity (`ActAs`).
- `OwnService` includes authority reached through `extends_with`: a member of an owning group
  manages the Service, deletion included.
- Methods are authenticated and enforce ownership. A non-owner gets `SERVICE_NOT_FOUND` /
  `DEPLOYMENT_NOT_FOUND`; deploying an existing Service owned elsewhere gives
  `service-owned-elsewhere`. Registering an account grants none of this authority.

## Deploy input

Static `CloudflareService.deploy` takes `WorkerDeploymentRequestV1` from
`@astrale-os/sdk/deployment/worker`. Assemble and send it with
`@astrale-os/adapter-astrale/services`; a hand-written `serviceKey`, `entry` or flat module payload
is not this contract.

| Member | Meaning |
| --- | --- |
| `format`, `version` | `astrale.worker.deployment-request`, `1` |
| `project`, `environment` | Stable Service coordinates |
| `buildDigest`, `label` | Derived from the admitted Worker bytes and configuration |
| `worker` | `mainModule`, build `manifest`, `modules`, optional `assets`; each content envelope carries encoding, decoded size and base64 content or chunks |
| `configuration` | Canonical `astrale.worker.configuration` v1: compatibility date and flags, vars, declared secret names, and the `record`, `signingIdentity`, `router` booleans |
| `secrets` | Values for exactly the declared names; write-only |
| `record` | Opaque bytes and media type, present exactly when the configuration requests a record |
| `readiness` | Optional paths that must answer 200 with the uploaded version's `x-astrale-worker-version` |
| `promote` | Default `true`; `false` leaves the current deployment unchanged |
| `owner` | Optional first owner, subject to `ActAs`; a bare Identity node id (no `@`) |

- Services recomputes the build and the address. Runtime settings and secret names enter the label;
  secret values do not.
- The same release reuses its deployment and may update its secret values in place. New code or
  configuration makes another deployment; earlier ones keep serving.
- Never edit configuration (such as appending compatibility flags) after hashing.
- Host-owned bindings, never user vars or secrets: `WORKER_URL`, `ASTRALE_BUILD_DIGEST`,
  `ASTRALE_VERSION_METADATA`, `ASTRALE_SIGNING_IDENTITY`, `ROUTER`, `ASSETS`.

## Results

```text
WorkerDeploymentResponseV1 =
  { kind: 'deployed', state: 'created' | 'reused',
    secrets: { state: 'bound' | 'unchanged' | 'updated' }, deployment: Summary }
| { kind: 'rejected', reason, message, retryAfter?: ISO instant }
Summary = { id, url, label, serviceId, service, project, environment,
            owner: Identity Path, state, current: boolean, createdAt, retiredAt?,
            buildDigest, configuration: digest, signingKeyId?,
            record?: { contentType, contentBase64 } }
reason  = invalid-deployment | address-mismatch | build-mismatch | service-owned-elsewhere
        | deployment-conflict | deployment-retired | hosting-unavailable | service-unavailable
```

- `bound`: secrets bound at creation; `unchanged`: a reused deployment's secrets match;
  `updated`: rewritten in place on that deployment only.
- A refusal changed nothing, except `service-unavailable`, which may follow effects a rerun
  converges.
- A JSON response or exit 0 alone does not prove deployment success. The adapter throws
  `ServicesRefusal` on a rejection.
- An ownership or validation refusal needs corrected intent. On `service-unavailable`, rerun the
  same release within bounds and its `retryAfter`. Never allocate another
  project to route around ownership.

## Management

- Static `CloudflareService.hosting` describes hosting. `list({ project?, environment? })` returns
  visible deployment summaries, not Service rows: `summary.serviceId` for Service Methods,
  `summary.id` to retire a deployment.

| Receiver | Methods |
| --- | --- |
| `CloudflareService` | `promote({label})`, `transfer({owner})`, `setSecret({name,value})`, `secrets({})`, `setSchedule({crons})`, `schedules({})`, `logs({label?,tail?,since?})`, `delete({})` |
| `CloudflareDeployment` | `retire({})` |

- `setSecret` updates the current deployment only. No `deleteSecret`: adding or removing a secret
  name changes the configuration and needs a new deployment; removing a name from a new deployment
  leaves it in older ones.
- Services keeps no secret values; listing metadata never recovers them.
- To rotate a non-current generic Worker release, redeploy its exact original input with updated
  values and `promote: false`. Domain releases: the
  [identical redeploy and restore-current procedure](../../astrale-domain/references/deployment.md#secrets-of-a-deployment);
  the Domain adapter always promotes.
- Services never creates consumer Domain or Function nodes nor returns their installed ids. A Domain
  release's origin, revision, issuer and Publication belong to its deployer; its record is opaque to
  Services and admitted by the Domain tooling. Installing it is a separate consumer operation.
