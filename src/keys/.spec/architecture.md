# CLI key material

This Node-only module owns local identity key material. Every identity uses its own
`<subject>.private.jwk` / `<subject>.public.jwk` pair, including an identity named `manager`. Writes are private and
atomic through State. Signing admits the selected private JWK algorithm and never substitutes
manager material for a missing identity key.

Externally supplied or persisted pairs cross a proof-loss boundary here. Keys accepts only supported
algorithms, keeps paths inside the selected key directory, rejects private material in the public
file, and proves private/public correspondence before returning or replacing files.

Only import/export and scaffold code use the raw-key operations. Ordinary connection code receives
signed credentials or public material.
