# CLI Admin catalog adapter

The adapter reads policy-visible `Domain` Nodes through bounded Graph pages using stable Class and
Property keys, and derives default membership from the stable Fleet relation. It performs no schema
discovery or reflection. Publication invokes `Fleet.publishDomain`; a requested default change is a
separate explicit `Domain.configureDefault` call. Unchanged publication input is a no-op, and an
omitted description preserves the current value.
