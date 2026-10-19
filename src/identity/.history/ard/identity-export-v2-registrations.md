# Identity export carries Kernel registrations

Status: resolved
Impact: high
Selection: identity-export-v2

## Context

A key identity registered on a Kernel signs the `(iss, sub)` that Kernel registered for its key,
recorded under the Kernel issuer in `identities.json`. The V1 export envelope carried only the
keypair, subject, mode, key ID and default issuer. An identity imported from it in another
`ASTRALE_HOME` therefore signed with the unconfigured CLI issuer, which no Kernel can verify. Its
calls failed at the Kernel with a retryable "Authentication is unavailable." even though the
registration existed. The CI Actions that import an exported envelope inherited the failure.

The V1 schema and its CLI reader are strict: an unknown field is refused as an invalid shape. A V1
envelope that silently grew a `registrations` field would be refused as malformed by every released
reader, and would change the published V1 schema under its own `$id`.

## Decision

Export writes a new V2 envelope: the V1 fields plus a required `registrations` map, keyed by the
exact Kernel issuer, of the registered `{ iss, sub, registeredAt }`. It is empty when the key is
registered nowhere. `https://schemas.astrale.ai/cli/identity-export/2` publishes it beside the
unchanged V1 schema.

Import admits V1 and V2. V2 restores the registrations exactly. V1 remains a complete
representation of a key with no registrations, which is what a Host bootstrap root is, and imports
as before with none. The CLI never derives or guesses a registration. Export admits its own
envelope as import would, so a written export always imports.

A key identity left with only the unconfigured CLI issuer for a Kernel, with no registration there
and no issuer of its own, is refused locally before any request. The refusal names the identity
and the Kernel whose registration it lacks.

## Consequences

- An exported registered identity authenticates from a fresh `ASTRALE_HOME` on every Kernel it
  was registered on.
- Releases before this one refuse V2 envelopes as an unsupported shape. Importing a new export
  needs a CLI that reads V2. Existing V1 envelopes and Host bootstrap roots keep importing.
- An identity imported from a V1 export of a registered identity fails with a local message that
  names the missing registration. The fix is a V2 export from the home where it is registered,
  or a new registration.
