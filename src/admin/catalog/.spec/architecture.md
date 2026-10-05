# CLI Admin catalog adapter

The adapter reads policy-visible `Domain` Nodes through bounded Graph pages using stable Class and
Property keys, and derives default membership from the stable Fleet relation. It performs no schema
discovery or reflection. A Fleet's catalog is the Domains it contains (`fleet_contains`) and the
Domains it lists from another Fleet (`fleet_lists_domain`): one Domain per origin, read once even
when both relations reach it. Publication invokes `Fleet.publishDomain`; a requested default change
is a separate explicit `Fleet.configureDomainDefault` call on the same Fleet, naming the Domain.
Unchanged publication input is a no-op, and an omitted description preserves the current value.
Admin's `CATALOG_ORIGIN_CONFLICT` refusal (only the core Fleet catalogues a new origin; a Fleet
changes only the Domains it contains) surfaces as that CLI error code with the next step to take.
