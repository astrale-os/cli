# Vendored Kernel packs

`kernel/*.tgz` are `pnpm pack` outputs from `astrale-os/kernel@kernel-v2` after
the explicit edge-direction DSL (`outgoing` / `incoming`). Published
`@astrale-os/kernel-*@0.2.0-beta.1` / `0.6.0-beta.1` still expect `cardinality`.

`astrale-os-sdk-0.5.0-beta.1.tgz` is the publication-v2 pack (`auth.exchange`).
Public npm `0.5.0-beta.1` only re-exports `kernel-core/auth`.

`astrale-os-shell-0.3.8-beta.1.tgz` is unpublished; public npm only has `0.3.7`.

Replace these `file:` overrides with registry versions once that kernel cohort
and matching SDK/shell releases are published.
