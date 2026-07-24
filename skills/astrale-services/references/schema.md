# Services schema

Origin: `services.astrale.ai`

## Service model

`Service` is a provider-neutral interface and an Astrale `Identity`. A deployed service can receive grants and call a kernel as itself.

Instance methods shared by service implementations:

- `setSecret({ name, value })` and `deleteSecret({ name })`.
- `secrets()` returns names only; values are intentionally unreadable.
- `setSchedule({ crons })` replaces the complete schedule; `[]` clears it.
- `schedules()` returns current provider cron expressions.
- `logs({ tail?, since? })` returns `{ name, lines[] }` with stable line ids and epoch-ms timestamps.
- `delete()` tears down the provider service and removes the graph node.

Live graph properties include `url`, `state`, `digest`, and optional `error`.

## Deploy factories

| Class | Static method | Result |
|---|---|---|
| `CloudflareWorker` | `deploy` | A Worker Service plus all Functions declared by its signed SDK manifest |

Deploy accepts an exact `path`, optional `name`, entry module name, modules, compatibility settings, service bindings, plaintext vars, static assets, and limits. Modules use `{ name, contentBase64, kind? }`; assets use `{ path, contentBase64, contentType? }`.

The artifact never carries a second Function manifest. SDK-authored workers use one registry:

```ts
export default serviceWorkerEntry({
  functions: { receive: defineRemoteFunction({ inputSchema, outputSchema, execute }) },
})
```

Deploy fetches and verifies the worker's signed manifest and reconciles exact Function state under `<service>/functions/<slug>`. Each Function shares the Service issuer/key, keeps its own node-id subject, and links to the Service through `hosted_by_service`.

The result is `{ path, url, digest, state, error?, functions[] }`.

## Placement

Services live at caller-selected paths such as `/services/api` or `/orgs/acme/workers/importer`. The domain does not maintain a global services folder or list method. Discover visible services through graph queries scoped to the part of the graph you own.

## View

`/:services.astrale.ai:view.service` applies to `CloudflareWorker`.
