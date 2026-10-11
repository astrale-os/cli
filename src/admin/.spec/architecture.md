# CLI Admin adapters

This private aggregate translates the frozen CLI command journey into the stable public
`admin.astrale.ai` contract. Routine commands use canonical Admin Class, Property, Core receiver,
and Method paths through Kernel Client. They do not download, inspect, bind, or rebuild the Admin
schema. Strict local decoders admit every untrusted Admin result. The adapter does not import Admin
implementation code, call Host directly, or persist remote graph truth.

`instance` owns create/list/status/delete projection and explicitly excludes the reserved Admin
Host from consumer placement. `registry` owns the Domain version registry. `graph` is their bounded
cursor helper and is not re-exported by the aggregate. Installing a Domain on an Instance is no
Admin call: `domain install -i <instance> --as <slug>-root` reaches the Instance's Kernel as its
root identity, which `instance create` imports and `instance root import` recovers.

Commander grammar, help text, output shapes, bookmark behavior, and current interactive host
selection remain owned by the existing command surface; these adapters change only its remote
semantic owner.

## Performance contract

`instance list` performs one `Instance.list` call. With `--fleet`, a Fleet's administrators add one
decision and one Fleet inventory Query of at most 40 pages of 256 Instances. Exact NodePath
lifecycle operations use a bounded direct lookup so a terminal delete can still be retried after
response loss without depending on public inventory. The journey performs no schema-discovery call
and rejects the complete inventory if any required page fails. Against the production beta Admin endpoint, the built CLI must finish in less than 1 second
with a warm route and less than 2 seconds from a cold executable process when its authenticated
exchange credential is current. Authentication bootstrap after login or credential expiry is
measured separately. Unit tests prove the exact-Class AST, bounded pagination, fail-closed
collection, exact terminal lifecycle retry, and no-reflection shape;
retained live evidence proves the wall-clock bounds.
