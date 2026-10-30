# Integrations

An Integration is a consumer-owned, provider-neutral contract for behavior outside the Domain
graph. A Provider implements it for one environment and is constructed at Runtime initialization.

```ts
import { defineIntegration, defineProvider } from '@astrale-os/sdk/integration'

export const openMeteo = defineIntegration({
  id: 'open-meteo',
  operations: {
    forecast: defineIntegration.operation<Coordinates, Forecast>({ replay: { kind: 'safe' } }),
  },
})

export function createOpenMeteo(configuration: Configuration) {
  return defineProvider(openMeteo, {
    async forecast(input) {
      const response = await fetch(buildUrl(configuration, input))
      return admitForecastResponse(response)
    },
  })
}
```

## Replay

| `replay` | Another attempt |
| --- | --- |
| `{ kind: 'safe' }` | Runs again: repeating it is harmless |
| `{ kind: 'keyed', source: 'execution' }` | Runs again; `execution.idempotencyKey` is the logical call's id, the same on every attempt (in a Step, derived from the Execution) |
| `{ kind: 'keyed', source: 'input', key }` | Runs again; `execution.idempotencyKey` is `key` |
| `{ kind: 'unsafe' }` | Refused (`TypeError`) after the first attempt |
| `(input) => decision` | Decided per input; replayable only if it never answers `unsafe` |

- An operation accepts at most one input.
- A durable Step's `integrations` omit every operation whose decision may be `unsafe`, and refuse an
  `unsafe` decision before the Provider runs. A state-changing operation called from a Step is
  `keyed` (`workflows.md`, Call an external system).
- The marker states what the external system guarantees; it creates no idempotency.

## Providers

- Construct Providers only inside Runtime `initialize(environment)`. Admit the configuration once,
  keep only the values needed, and expose Integration clients, never the raw environment or
  secrets. No I/O at module import.
- Validate unknown remote bytes and responses at the Provider boundary. Translate only declared
  expected failures; an unexpected transport or provider failure stays a defect.
- Provider output is load-bearing in assertions.

## Effects

An Integration call that changes external state is one effect (`actions.md`):

- An Action reads, then makes one effect: one state-changing Integration call, or read-only
  Integration calls before one Mutation.
- A state-changing external call combined with another effect is a Workflow, inside a Step.

## Secrets and evidence

- Secrets live in the deployment or runtime environment, never in the Schema, Core data, graph
  Properties, logs, handoffs, snapshots or tests.
- Signed webhooks: retain the exact received bytes and the headers the signature scheme needs
  before decoding the business content.
- An external effect is proven by an independently owned receiver or a queryable API, never by a
  handler-local counter, an authored success boolean or a handoff. The producer may return a stable
  correlation value or a digest of the exact body it sent; receiver observation and cleanup belong
  to the acceptance owner.
- Receiver evidence proves the expected request happened, not the absence of other egress. Add a
  narrow source admission or runtime network control only when the scenario claims a closed egress
  boundary.

## Remote Domains

A declared dependency is called directly from an Action or Workflow (`domains.md`). Put a
cross-Domain call behind an Integration only for substitution, replay metadata or failure
translation. Its Provider:

- takes the exact dependency from the loaded `context.domain` that `initialize` receives;
- invokes the callable through `execution.invoke`, bound to the incoming caller; absent when the
  call carried no credential and in a durable Step;
- never stores a Client, rebuilds a foreign path, widens to a registry, calls a foreign
  implementation, copies its types, or claims atomicity across the Domain boundary.

The release requests a `call` scope on each foreign callable a handler or Provider invokes
(`FNC-XDOM-REQ` reports a missing one). The scope bounds only what the Domain does for another
caller; the callee's Policy still decides that caller (`policies.md`). It is neither a human grant
nor a Provider-held credential.
