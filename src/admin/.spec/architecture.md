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

`instance list` performs one exact caller-authorized native Instance Query through 256 visible
Instances, then follows only bounded Kernel cursors when more pages exist. Deleted lifecycle
tombstones are not operational inventory and are excluded from the returned list. The journey
performs no Admin Method or schema-discovery call and rejects the complete inventory if any later
page fails. Against the production beta Admin endpoint, the built CLI must finish in less than 1
second with a warm route and less than 2 seconds from a cold executable process when its
authenticated exchange credential is current. Authentication bootstrap after login or credential
expiry is measured separately. Unit tests prove the exact-Class AST, bounded pagination,
fail-closed collection, tombstone exclusion, and no-reflection shape; retained live evidence proves
the wall-clock bounds.
