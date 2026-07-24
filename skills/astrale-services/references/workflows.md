# Services workflows

```bash
TARGET=my-instance
SERVICE=/services/import-worker
```

## Deploy a Worker

A Worker deployment payload:

```json
{
  "path": "/services/import-worker",
  "name": "Import Worker",
  "entry": "index.mjs",
  "modules": [
    { "name": "index.mjs", "kind": "esm", "contentBase64": "BASE64_MODULE" }
  ],
  "compatibilityDate": "2026-07-13",
  "vars": { "ENVIRONMENT": "production" }
}
```

```bash
astrale call /:services.astrale.ai:class.CloudflareWorker:deploy \
  -i "$TARGET" --json < deploy.json
```

The service parent must already exist. A redeploy to the same service path is the idempotent update path.

To host Functions, author them with `serviceWorkerEntry({ functions })`. The same `CloudflareWorker.deploy` call discovers and reconciles them; do not pass a manifest in the deploy payload.

## Secrets

Set, list, and delete secrets:

```bash
API_TOKEN="$API_TOKEN" jq -n '{name:"API_TOKEN",value:env.API_TOKEN}' | \
  astrale call "$SERVICE::setSecret" -i "$TARGET" --json
unset API_TOKEN

astrale call "$SERVICE::secrets" -i "$TARGET" --json
astrale call "$SERVICE::deleteSecret" name=API_TOKEN -i "$TARGET" --json
```

`secrets` returns names, never values.

## Schedules

Schedules are five-field UTC cron expressions and are replaced as a set:

```bash
astrale call "$SERVICE::setSchedule" \
  --data '{"crons":["0 * * * *","30 2 * * 1"]}' \
  -i "$TARGET" --json
astrale call "$SERVICE::schedules" -i "$TARGET" --json
astrale call "$SERVICE::setSchedule" --data '{"crons":[]}' -i "$TARGET" --json
```

The provider invokes `POST /__scheduled` on matching ticks.

## Logs and graph state

```bash
astrale get "$SERVICE" -i "$TARGET" --json
astrale call "$SERVICE::logs" tail=100 -i "$TARGET" --json
astrale call "$SERVICE::logs" tail=100 since=1783962000000 -i "$TARGET" --json
```

For polling, advance `since` and deduplicate by each line's stable `id`.

## Delete and open the UI

```bash
astrale view /:services.astrale.ai:view.service \
  --target "$SERVICE" -i "$TARGET" --browser

# Destructive: provider deployment and graph node are removed.
astrale call "$SERVICE::delete" -i "$TARGET" --json
```
