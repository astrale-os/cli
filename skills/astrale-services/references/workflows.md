# Services workflows

## New generic Worker

The published `@astrale-domains/services` 0.8.2 package ships `create-astrale-service`. Use that
version or a deliberately selected newer compatible release; inspect the generated README and
pinned dependencies rather than assuming an old installed package has the current scaffold.

```sh
npm exec --package @astrale-domains/services@0.8.2 -- create-astrale-service nightly-report
npm --prefix nightly-report install
```

The generator creates local source only and refuses an existing directory. It writes
`src/index.js` (health and private cron entry), `src/job.js`, optional account-session code,
`service.json`, and build/deploy scripts. It neither registers an account nor grants access.
For an HTTP API, adapt the entry and job and remove account secrets/vars you do not need.

Edit `service.json`: project, compatibility date/flags, plain vars, secret **names**, readiness
paths, and crons. Provide declared values through its ignored environment file or process
environment. Start with `crons: []` until the real job is verified. Run in the project directory:

```sh
npm run deploy -- production
# Alternatives: --admin <bookmark>, --as <identity>, --no-promote
```

This builds and deploys through Admin's Services, then replaces Service crons with the declared
set when promoting. `--no-promote` leaves current routing and crons alone. Read both deployment and
schedule outcomes: a created Worker does not prove schedule configuration succeeded. The script
prints Service/deployment IDs, deployment label/URL, current status, and secret-write status.

## Existing Worker artifacts

Use `@astrale-os/adapter-astrale/services` in the project's pinned dependency set. Bundle the entry
and runtime dependencies first. The adapter constructs the canonical request and sends secrets on
stdin through the authenticated CLI; do not build an obsolete flat deploy payload.

```js
import { deployWorker, readWorkerDirectory } from '@astrale-os/adapter-astrale/services'

const worker = await readWorkerDirectory('.dist', { mainModule: 'worker.mjs' })
const { state, deployment } = await deployWorker({
  project: 'nightly-report',
  environment: 'production',
  worker,
  configuration: {
    compatibilityDate: '2026-09-01',
    compatibilityFlags: ['nodejs_compat'],
    vars: {},
  },
  secrets: {},
  readiness: ['/health'],
  promote: false,
})
console.log({ state, serviceId: deployment.serviceId, deploymentId: deployment.id,
  label: deployment.label, url: deployment.url, current: deployment.current })
```

The example assumes the Worker implements `/health` and returns
`x-astrale-worker-version: env.ASTRALE_VERSION_METADATA.id`; adapt readiness to its real contract.
It requests no Domain record, signer, router, or installation. Pass adapter options
`{ admin: '<bookmark>', identity: '<local CLI identity>' }` as the second argument when needed.
Use the scaffold's secret loading for declared values rather than embedding them in source.

## Inspect and operate

Service calls target Admin. Prefix each returned bare node ID with `@` to form its canonical path;
do not substitute a slug or compute a graph ID:

```sh
SERVICE_PATH='@<returned-service-id>'
DEPLOYMENT_PATH='@<returned-deployment-id>'
astrale call /:services.astrale.ai:class.CloudflareService:hosting --admin --data '{}' --json
astrale call /:services.astrale.ai:class.CloudflareService:list \
  project=nightly-report environment=production --admin --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.logs" \
  --admin --data '{"tail":50}' --json
```

`logs` accepts optional deployment `label` and numeric `since`; without a label it reads the current
deployment. `list` includes `current` and lifecycle state, so select the precise active release.

```sh
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.promote" \
  label="$PREVIOUS_LABEL" --admin --json
```

Promotion changes the stable Service endpoint and cron target. Rollback promotes an older active
deployment; it does not overwrite immutable code or change what a consumer Kernel has installed.
Inspect the returned result and verify the exact URL/version and application behavior after moving it.

### Secrets and schedules

Use a protected file outside the repository or piped stdin for `{"name":"API_TOKEN","value":...}`:

```sh
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.setSecret" \
  --admin --data @/private/path/secret-input.json --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.secrets" \
  --admin --data '{}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.setSchedule" \
  --admin --data '{"crons":["0 * * * *"]}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.schedules" \
  --admin --data '{}' --json
```

The current deployment must declare the secret. Rotation keeps its code/URL/key, propagates
asynchronously, and affects no other deployment. Update the source of secret values used by future
deploys too, or a redeploy can restore the old value. New/removed names require a new configuration.

Schedules replace the complete set (up to 24 five-field UTC expressions), not append to it.
`{"crons":[]}` disables it. See [service-account-cron.md](service-account-cron.md) for the private
entry and real-tick verification. Retain bounded evidence without logging secret or business payloads.

### Ownership, view, retirement, deletion

Transfer requires authority over the existing Service and the intended new owner:

```sh
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.transfer" \
  owner='@<new-owner-id>' --admin --json
astrale view /:services.astrale.ai:view.application -i <admin-bookmark>
```

The View belongs to the Domain; it needs no fabricated Service target. Use an actual Admin bookmark
for `view`, whose `-i` selection is distinct from `call --admin`.

```sh
astrale call "${DEPLOYMENT_PATH}::services.astrale.ai:class.CloudflareDeployment.method.retire" \
  --admin --data '{}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.delete" \
  --admin --data '{}' --json
```

Run only the lifecycle operation requested. Retirement permanently withdraws one deployment;
current cannot retire alone, so first promote another active deployment or delete the Service.
Retirement/deletion converge in phases: retain the same exact target, respect `retryAfterMs`, and
repeat within a bounded window until `retired` / `deleted`. Do not interpret a `retiring` / `deleting`
receipt as completion. Deletion stops Service routing/crons, retires all deployments, then removes
the graph resource and frees its name. Verify externally visible withdrawal separately from graph
state. Neither operation uninstalls any consumer Domain or removes a business account.

## Domain releases

For a Domain project, use `astrale-domain deploy <environment>` with
`@astrale-os/adapter-astrale`, then deliberately install the returned immutable deployment URL:

```sh
astrale domain install "$DEPLOYMENT_URL" -i "$CONSUMER_INSTANCE"
```

An Environment selects deployment configuration, never a consumer instance. Each consumer pins and
upgrades independently; promotion of the Service's stable URL does not move an existing pin.
See [deployer-agent.md](deployer-agent.md) for verification and handoff.
