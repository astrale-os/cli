# CLI key material

This Node-only module owns the retained `@astrale-os/cli/keys` subpath. Manager keys remain on their
legacy filenames; every other identity uses its own subject-named pair. Writes are private and
atomic through State. Signing admits the selected private JWK algorithm and never substitutes
manager material for a missing identity key.

Externally supplied or persisted pairs cross a proof-loss boundary here. Keys accepts only supported
algorithms, keeps paths inside the selected key directory, rejects private material in the public
file, and proves private/public correspondence before returning or replacing files.

The retained Node-only subpath contains the explicit raw-key operations required by import/export
and scaffold consumers. Ordinary connection code receives signed credentials or public material.
