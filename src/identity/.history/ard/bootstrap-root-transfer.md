# Bootstrap root transfer and child authority

Status: resolved
Impact: high
Selection: identity-export-v1-and-authenticated-management-delegation

## Context

A production Host creates the manager Kernel's signing material before the CLI has any local state.
Qualification may mount that generated secret into the operator environment, but it must not
manufacture the CLI registry or key files. The Host producer and CLI importer previously agreed only
through coincident TypeScript object shapes. The root-to-child journey was also distributed across
Host, Runtime, Client, and CLI behavior, leaving room to confuse a manager-signed Management carrier
with the effective child principal.

## Decision

https://schemas.astrale.ai/cli/identity-export/1 is the portable JSON Schema for the plaintext
IdentityExport V1 envelope. CLI Identity owns and publishes that schema. Structural schema admission
does not prove a keypair: identity import additionally proves that the private and public JWKs form
one pair before publishing either keys or registry state.

The Host secret generator emits one schema-conforming identity.json with mode 0600. The platform
runner imports it through:

    astrale identity import <identity.json> --name platform-root

The imported root is the manager Kernel principal. It is never provisioned or registered as an
application identity. The manager bookmark uses the non-reserved alias platform-manager, pins the
manager issuer, and selects platform-root as its default identity. Manager identity is proved by the
authenticated public Identity.whoami syscall, not local CLI status.

Because this credential is issued by the target Kernel itself, CLI signing carries the imported
subject as an already-resolved identity Grant. The external-primary `{ identity: self }` form is not
valid for a self-issued Kernel bearer and cannot be substituted at this boundary.

Child creation is the public receiver call
/:host.astrale.ai:core.manager::createInstance. Once its Operation and Instance status report a
ready route and issuer, the canonical child credential is minted at the manager:

    astrale token -i platform-manager --for platform-root --audience <child-issuer> --raw

That token is a manager-to-child Management carrier. Its outer JWT subject names the manager
principal; child Runtime maps it to the child Kernel principal. Child calls therefore keep the token
as --creds, and @self resolves through the child's authenticated Identity.whoami. The child bookmark
pins the child issuer and carries no --as platform-root default.

## Consequences

- Bootstrap crosses one explicit file contract and one supported CLI command; no CLI state file is
  fabricated.
- Direct manager signing and child Management delegation remain distinct.
- No consumer may infer the effective principal from an unverified JWT subject or cached
  registration.
- The portable schema is structural and versioned; cryptographic pair proof remains CLI admission.
- A future encrypted Host-to-CLI bootstrap format requires a new explicit deployment decision. CLI's
  interactive compact-JWE export remains an operator transfer representation, not Host output.
