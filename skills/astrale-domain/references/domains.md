# Domains

Read to decide whether to reuse another Astrale Domain, or to depend on and call one.

## Semantic owner

- Before adding vocabulary, check whether another Domain owns it. Reuse it when its identity and
  lifecycle are authoritative; never copy its Classes or recreate its callable contracts locally.
- Sign-in users and shared groups: Shell's public contract (`users.md`).

## Schema dependency

- Declare a Schema dependency on each Domain whose Classes, Edges, Policies, Views, Core
  definitions or callables the Domain references or calls. Every foreign reference is owned by one
  direct dependency; a reference reachable only through another dependency is refused.
- Import the foreign Domain through its published package facade; never rebuild definition keys or
  import another package's private source.

## Calling a dependency

```text
dependencies.<alias>.caller.invoke((dep) => dep.functions.f, input)   caller = the incoming caller
dependencies.<alias>.self.invoke((dep) => dep.functions.f, input)     caller = the Domain
→ the remote callable, admitted by its own Policy
```

- Choose the authority explicitly (`authority.md`).
- The release requests a `call` scope on each foreign callable it invokes. The scope bounds only
  what the Domain does for another caller; the dependency grants nothing (`policies.md`).
- A consumer-owned Integration wraps the call only for substitution, replay metadata or failure
  translation (`integrations.md`).
- A foreign write and a local write are two effects, never one atomic Mutation: together they are a
  Workflow (`workflows.md`).

## Public boundary

- Domain source imports semantic `@astrale-os/sdk/*` paths only; the SDK owns Kernel
  compatibility. Kernel Core/DSL imports, private SDK deep paths, copied callable types and source
  links are boundary violations.
- The origin is semantic identity; a deployment URL is placement. Redeploying or installing on
  another instance never renames the Schema origin or its Definition keys.

## Review

- Which package owns each Class, Edge, Policy, callable and lifecycle?
- Does a direct reference or call justify each Schema dependency?
- Does each foreign call select `caller` or `self`, with its `call` scope?
- Are only published facades imported?
- Are atomicity and availability claims honest across the Domain boundary?
