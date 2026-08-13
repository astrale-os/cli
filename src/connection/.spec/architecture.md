# CLI connection architecture

The private `connection` module owns one scoped bridge from existing CLI flags and local identity
state to the public Kernel Client. It selects the exact source Kernel URL and issuer, either omits
credentials for an explicit anonymous selection or resolves fresh source-Kernel authority for each
Call, binds Graph and Auth helpers, and closes every owned Client resource when the command action
terminates.

```mermaid
flowchart LR
  F[CLI flags and local state] --> T[Connection target]
  T --> H[ClientSession]
  C[CLI credential sources] --> R[SessionAuth]
  R --> H
  H --> G[GraphApi]
  H --> A[AuthApi]
  H --> X[Command action]
  G --> X
  A --> X
```

ClientSession owns source admission, Publication discovery, redirect witnessing, route caching, transport
selection, and the single safe stale-route recovery. The CLI does not reproduce those rules or
discover destination identity. `SessionAuth.resolve(call, signal)` returns source-Kernel authority and
ClientSession supplies the audience-free self Delegate used by the canonical path-only protocol. No
credential or route is persisted by this module.

`--anonymous` deliberately suppresses ambient and bookmark-default identities by omitting the
`SessionAuth` capability. It cannot be combined with `--as` or `--creds`; contradictory selections fail
before local identity state or a connection is opened. Public and optional callables can then
observe a genuinely anonymous caller, while required callables reject the request at the Kernel.

The target, timeout, and optional CA file are resolved before constructing the session. The CA file
customizes only the Fetch capability passed to Client. `withClientSession` and
`withAdminClientSession` are terminal lifecycle boundaries: success, failure, and cancellation all
close both the Client Session and its direct source-Auth client.
