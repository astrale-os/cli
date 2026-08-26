# CLI Admin adapters

This private aggregate translates the frozen CLI command journey into the stable public
`admin.astrale.ai` contract. Routine commands use canonical Admin Class, Property, Core receiver,
and Method paths through Kernel Client. They do not download, inspect, bind, or rebuild the Admin
schema. Strict local decoders admit every untrusted Admin result. The adapter does not import Admin
implementation code, call Host directly, or persist remote graph truth.

`instance` owns create/list/status/delete/install projection and explicitly excludes the reserved
Admin Host from consumer placement. `catalog` owns Domain inventory, publication, and default-set
configuration. `graph` is their bounded cursor helper and is not re-exported by the aggregate.

Commander grammar, help text, output shapes, bookmark behavior, and current interactive host
selection remain owned by the existing command surface; these adapters change only its remote
semantic owner.

## Performance contract

`instance list` performs one Admin method call after connection setup and no schema-discovery call.
Against the production beta Admin endpoint, the complete command must finish in less than 1 second
with a warm route/cache and less than 2 seconds from a cold CLI process. Unit tests prove the
single-call/no-reflection shape; retained live evidence proves the wall-clock bounds.
