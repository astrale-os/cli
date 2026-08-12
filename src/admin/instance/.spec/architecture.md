# CLI Admin Instance adapter

The adapter discovers and binds the configured Admin Domain, proves its origin, and resolves the
singleton Fleet receiver. Policy-visible `Instance` and `Host` Nodes come from bounded Graph queries;
Host location is joined through `instance_runs_on_host`.

Automatic creation invokes `Fleet.createInstance`; explicit `--host-id` resolves one visible,
non-reserved Host and invokes `Host.createInstance`. Status, deletion, and Domain installation
invoke the exact Instance receiver. The adapter creates internal operation IDs but preserves the
existing CLI projection and selection-required experience.
