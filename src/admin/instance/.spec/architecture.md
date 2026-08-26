# CLI Admin Instance adapter

The adapter calls the stable singleton Fleet receiver directly. Listing and automatic creation are
one Admin Method call each; connection performs no schema discovery, introspection, or graph read.
Every returned summary is decoded locally before it reaches a command.

Automatic creation invokes `Fleet.createInstance`. Status, deletion, and Domain installation first
resolve a caller-visible Instance through Fleet and then invoke that exact Instance receiver. The
adapter creates internal operation IDs but preserves the existing CLI projection and
selection-required experience.
