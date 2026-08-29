# CLI Admin Instance adapter

The adapter queries the exact caller-visible `Instance` Class extent directly for listing and calls
the stable singleton Fleet receiver for automatic creation. Listing is one Kernel graph request
through 256 visible Instances and follows only explicitly bounded cursor pages; connection itself
performs no schema discovery, introspection, or graph read. Every returned Node or Method summary
is decoded locally before it reaches a command.

Automatic creation invokes `Fleet.createInstance`. Status, deletion, and Domain installation first
resolve a caller-visible Instance through the same native inventory and then invoke that exact
Instance receiver. The adapter creates internal operation IDs but preserves the existing CLI
projection and selection-required experience.

Instance invitation creation invokes the exact resolved Instance. Invitation status invokes the
exact retained Invitation receiver and returns its recorded lifecycle without provider refresh,
reconciliation, mutation, or operation identity. A sender or Fleet administrator can observe it;
the claimed user can observe it after acceptance. Diagnostic reconciliation remains a separate,
explicit recovery operation. Every Invitation result must remain scoped to one member invitation
for one managed Instance.

Administrator lifecycle inventory is deliberately separate from ordinary caller-visible listing.
It invokes `Fleet.listInstanceLifecycle` through the stable Core receiver, admits the returned
portable values, and excludes retired tombstones unless the caller explicitly requests them. This
is the only adapter surface that exposes retained child issuers; it exists for authorized operator
composition and never infers retirement from reachability or a missing graph result.
