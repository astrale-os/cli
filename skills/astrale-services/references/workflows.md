# Services workflows

```bash
TARGET=my-instance
SERVICE_NODE_ID=opaque-node-id
```

## Direct provider-only deploy

```json
{
  "serviceKey": "import-worker",
  "name": "Import Worker",
  "entry": "index.mjs",
  "modules": [
    { "name": "index.mjs", "kind": "esm", "contentBase64": "BASE64_MODULE" }
  ],
  "compatibilityDate": "2026-08-28",
  "vars": { "ENVIRONMENT": "production" }
}
```

```bash
astrale call /:services.astrale.ai:class.CloudflareWorker:deploy \
  -i "$TARGET" --json < deploy.json
```

This deploys provider compute and returns optional canonical Published Application metadata. It
does not install a Domain. If installation is desired, use the normal explicit command:

```bash
astrale domain install "$PUBLISHED_APPLICATION_URL" --direct -i "$CONSUMER_INSTANCE"
```

For a managed one-command project deployment, use `@astrale-os/adapter-astrale`. It deliberately
performs Services deploy, waits for stable Publication readiness, then installs once on the
configured instance.

## Operate a Service

```bash
API_TOKEN="$API_TOKEN" jq -n '{name:"API_TOKEN",value:env.API_TOKEN}' | \
  astrale call "@$SERVICE_NODE_ID::setSecret" -i "$TARGET" --json
unset API_TOKEN

astrale call "@$SERVICE_NODE_ID::secrets" -i "$TARGET" --json
astrale call "@$SERVICE_NODE_ID::deleteSecret" name=API_TOKEN -i "$TARGET" --json
astrale call "@$SERVICE_NODE_ID::setSchedule" \
  --data '{"crons":["0 * * * *"]}' -i "$TARGET" --json
astrale call "@$SERVICE_NODE_ID::schedules" -i "$TARGET" --json
astrale call "@$SERVICE_NODE_ID::logs" tail=100 -i "$TARGET" --json
```

## View and delete

```bash
astrale view /:services.astrale.ai:view.application -i "$TARGET" --browser

astrale call "@$SERVICE_NODE_ID::delete" -i "$TARGET" --json
```

Deletion removes provider deployment, schedules, secrets, routing/certificate resources, and the
Service graph anchor. It does not uninstall any consumer Domain. Uninstall each consumer explicitly
only when that consumer chooses:

```bash
astrale domain uninstall published.example.test -i "$CONSUMER_INSTANCE"
```
