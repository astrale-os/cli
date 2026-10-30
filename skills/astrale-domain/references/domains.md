# Domains

## Find the semantic owner

Before adding vocabulary, check whether another Astrale Domain already owns it. Reuse a foreign
Domain when its identity and lifecycle are genuinely authoritative; do not copy its Classes or
recreate its callable contracts locally for convenience.

For sign-in users and shared groups, use Shell's public contract; read `users.md` for concrete
subclasses, existing-node registration, invitation, and the traversal agreement Shell needs.

## Schema dependency

Declare a Schema dependency on each Domain whose Classes, Edges, Policies, Views, Core definitions,
or callables the local Domain refers to or calls; a reference reached only through another
dependency is refused. Import the foreign Domain through its published package facade. Do not
reconstruct definition keys or depend on another package's private source.

## Behavioral dependency

Call a foreign callable from an Action or Workflow through its declared alias, choosing the
authority explicitly (`runtime.md`):

```text
local Action or Workflow
  -> dependencies.<alias>.caller.invoke(...)   acts for the incoming caller
     dependencies.<alias>.self.invoke(...)     acts as the Domain
  -> remote callable, admitted by its own Policy
```

The release requests a `call` scope on each foreign callable it invokes; the scope bounds only what
the Domain does for another caller, and the dependency itself grants nothing (see `policies.md`).
Wrap the call in a consumer-owned Integration (`integrations.md`) when it needs substitution, replay
metadata, or failure translation. A state-changing foreign call combined with local changes is a
Workflow (`workflows.md`); it is not one atomic graph Mutation.

## Public boundary

Domain source uses semantic `@astrale-os/sdk/*` paths. The SDK owns Kernel compatibility. Direct
Kernel Core/DSL imports, private SDK deep paths, copied callable types, and source links are boundary
violations.

Origin is semantic identity. A deployment URL is serving placement. Redeployment or installation on
another instance must not silently rename the Schema origin or its Definition keys.

## Review

- Which package owns each Class, Edge, Policy, callable, and lifecycle?
- Does a direct reference or call justify each Schema dependency?
- Does each foreign call select `caller` or `self` and have its `call` scope?
- Are only published facades imported?
- Are atomicity and availability claims honest across the remote boundary?
