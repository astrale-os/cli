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
