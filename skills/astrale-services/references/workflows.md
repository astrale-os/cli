# Services workflows

## New generic Worker

`create-astrale-service` ships in `@astrale-domains/services` ≥ 0.8.2. Inspect the generated
README and pinned dependencies.

```sh
npm exec --package @astrale-domains/services@0.9.1 -- create-astrale-service nightly-report
npm --prefix nightly-report install
```

- The generator writes local source only and refuses an existing directory: `src/index.js` (health
  and the private cron entry), `src/job.js`, optional account-session code, `service.json`, build
  and deploy scripts. It registers no account and grants no access. For an HTTP API, adapt the
  entry and job and drop the account secrets and vars.
- `service.json`: project, compatibility date and flags, plain vars, secret **names**, readiness
  paths, crons. Start with `crons: []` until the job is verified.
- Secret values come from `.env.<environment>` when that file exists, otherwise from the process
  environment; the two never merge.

```sh
npm run deploy -- production [--admin <bookmark>] [--as <identity>] [--no-promote]
```

- Builds and deploys through Admin's Services, then, when promoting, replaces the Service's crons
  with `service.json`'s set. `--no-promote` leaves routing and crons unchanged.
- Prints the Service and deployment ids, label, URL, current status and secret-write status. Read
  both the deployment and the schedule outcome: a created Worker does not prove the schedule
  succeeded.

## Existing Worker artifacts

Bundle the entry and its runtime dependencies first, then deploy with
`@astrale-os/adapter-astrale/services` from the project's pinned dependencies. It builds the
canonical request and sends secrets on stdin through the authenticated CLI.

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
  promote: true,
})
console.log({ state, serviceId: deployment.serviceId, deploymentId: deployment.id,
  label: deployment.label, url: deployment.url, current: deployment.current })
```

- Readiness assumes the Worker serves `/health` with
  `x-astrale-worker-version: env.ASTRALE_VERSION_METADATA.id`; adapt it to the real contract. The
  example requests no Domain record, signer, router or installation.
- Adapter options go second: `{ admin: '<bookmark>', identity: '<local CLI identity>' }`.
- `promote: false` deploys a candidate. On a first deploy it leaves no current deployment: promote
  its label before using current-only logs, secrets or schedules.
- The adapter loads no secrets: read declared values from protected files or a secret manager in
  the deploy script.

## Inspect and operate

Calls target Admin. A canonical path is `@` + the returned bare node id; never a slug or a computed
id.

```sh
SERVICE_PATH='@<returned-service-id>'
DEPLOYMENT_PATH='@<returned-deployment-id>'
astrale call /:services.astrale.ai:class.CloudflareService:hosting --admin --data '{}' --json
astrale call /:services.astrale.ai:class.CloudflareService:list \
  project=nightly-report environment=production --admin --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.logs" \
  --admin --data '{"tail":50}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.promote" \
  label="$PREVIOUS_LABEL" --admin --json
```

- `logs({ label?, tail?, since? })`: without a label, the current deployment. `list` includes
  `current` and the lifecycle state; take `PREVIOUS_LABEL` from an active row.
- Promotion moves the stable endpoint and the cron target. Rollback promotes an older active
  deployment; it never rewrites immutable code or changes a consumer Kernel's installation. Verify
  the exact URL, version and application behavior afterwards.

### Secrets and schedules

```sh
# {"name":"API_TOKEN","value":...} from a protected file outside the repository, or stdin
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.setSecret" \
  --admin --data @/private/path/secret-input.json --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.secrets" \
  --admin --data '{}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.setSchedule" \
  --admin --data '{"crons":["0 * * * *"]}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.schedules" \
  --admin --data '{}' --json
```

- `setSecret`: the current deployment must declare the name. Rotation keeps the code, URL and key,
  propagates asynchronously and touches no other deployment. Update the source of future deploy
  values too, or a redeploy restores the old value. The reply does not identify the deployment when
  a promotion races the rotation: recheck `current`, then verify behavior after propagation.
- Another active generic Worker deployment: redeploy its exact original Worker, configuration and
  record with updated values (all declared values preserved) and `promote: false` (`--no-promote`);
  expect the same label and URL, `reused`, secrets `updated`. Changed artifacts make another
  deployment, and a promoting redeploy moves the endpoint and cron target.
- `setSchedule` replaces the whole set: at most 24 five-field UTC expressions; `[]` disables. Every
  promoting scaffold deploy re-applies `service.json.crons`, overwriting a manual `setSchedule`:
  enable a cron by editing the file and redeploying after verification
  ([service-account-cron.md](service-account-cron.md)).
- Keep bounded evidence; never log secret or business payloads.

### Ownership, View, retirement, deletion

```sh
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.transfer" \
  --admin --data '{"owner":"<new-owner-id>"}' --json
astrale view /:services.astrale.ai:view.application -i <admin-bookmark>
astrale call "${DEPLOYMENT_PATH}::services.astrale.ai:class.CloudflareDeployment.method.retire" \
  --admin --data '{}' --json
astrale call "${SERVICE_PATH}::services.astrale.ai:class.CloudflareService.method.delete" \
  --admin --data '{}' --json
```

- `transfer` needs authority over the Service and the new owner; `owner` is a bare node id (no
  `@`), and the result formats it as a Path.
- The View belongs to the Domain and takes no Service target. `view -i` needs an actual Admin
  bookmark; it is distinct from `call --admin`.
- Run only the requested lifecycle operation. Retirement permanently withdraws one deployment; the
  current one cannot be retired alone: promote another active deployment first, or delete the
  Service.
- Deleting a Domain Service retires all its deployments, published versions included: registry
  installs and pinned consumers can then fail. Inventory them first.
- Both converge in phases: keep the exact target, respect `retryAfterMs`, repeat within a bounded
  window until `retired` / `deleted`. A `retiring` / `deleting` receipt is not completion.
- Deletion stops routing and crons, retires every deployment, removes the graph resource and frees
  the name. Verify external withdrawal separately from graph state. Neither operation uninstalls a
  consumer Domain or removes a business account.

## Domain releases

```sh
astrale-domain deploy <environment>          # with @astrale-os/adapter-astrale
astrale domain install "$DEPLOYMENT_URL" -i "$CONSUMER_INSTANCE"
```

An Environment selects deployment configuration, never a consumer. Each consumer pins and upgrades
independently; promoting the Service's stable URL never moves an existing pin. Verification and
handoff: [deployer-agent.md](deployer-agent.md).
