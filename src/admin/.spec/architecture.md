# CLI Admin adapters

This private aggregate translates the frozen CLI command journey into the discovered V2
`admin.astrale.ai` contract. It binds the exact served Domain revision through Kernel Client,
uses `GraphApi` for policy-visible inventory, and invokes receiver-oriented Methods through
`DomainBinding`. It does not import Admin implementation code, hard-code one schema revision, call
Host directly, or persist remote graph truth.

`instance` owns create/list/status/delete/install projection and explicitly excludes the reserved
Admin Host from consumer placement. `catalog` owns Domain inventory, publication, and default-set
configuration. `graph` is their bounded cursor helper and is not re-exported by the aggregate.

Commander grammar, help text, output shapes, bookmark behavior, and current interactive host
selection remain owned by the existing command surface; these adapters change only its remote
semantic owner.
