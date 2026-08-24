# Integrations

An Integration is a consumer-owned, provider-neutral contract for behavior outside the Domain graph.
A Provider supplies its environment-specific implementation at Runtime initialization.

## Define the contract

```ts
import { defineIntegration } from '@astrale-os/sdk/integration'

export const openMeteo = defineIntegration({
  id: 'open-meteo',
  operations: {
    forecast: defineIntegration.operation<Coordinates, Forecast>({
      replay: { kind: 'safe' },
    }),
  },
})
```

Choose replay metadata honestly. A marker does not manufacture idempotency or exactly-once behavior.

## Define and initialize the Provider

```ts
import { defineProvider } from '@astrale-os/sdk/integration'

export function createOpenMeteo(configuration: Configuration) {
  return defineProvider(openMeteo, {
    async forecast(input) {
      const response = await fetch(buildUrl(configuration, input))
      return admitForecastResponse(response)
    },
  })
}
```

Construct Providers only inside Runtime `initialize(environment)`. Admit environment configuration
once, retain only the necessary values, and expose Integration clients—not raw environment or secrets—
to Actions and Workflows. Never perform I/O at module import.

## Action versus Workflow

- An Action may make one Integration operation when that operation is the Action's single semantic
  asynchronous effect.
- Use a Workflow when an external call is combined with graph observations or changes.
- Put each Workflow effect in its own stable `step.run`; Actions have no Step API.

Provider output must be load-bearing in assertions. Validate unknown remote bytes/responses at the
Provider boundary. Preserve unexpected transport/provider defects as defects, and translate only
declared expected failures.

## Secrets and evidence

Keep secrets in deployment/runtime environment, never Schema, Core data, graph properties, logs,
handoffs, snapshots, or tests. For signed webhooks, retain exact received bytes and headers required by
the signature scheme before decoding business content.

## Remote Domains

Use the same Integration/Provider boundary for cross-Domain calls. The Provider uses the public SDK
Client/session facade and the remote Domain's public contract. Do not call a foreign implementation,
copy its types, or claim atomicity across the service boundary.
