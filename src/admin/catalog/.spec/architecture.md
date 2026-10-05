# CLI Admin catalog adapter

The adapter reads policy-visible `Domain` Nodes through bounded Graph pages using stable Class and
Property keys, and derives default membership from the stable Fleet relation. It performs no schema
discovery or reflection. A Fleet's catalog is the Domains it contains (`fleet_contains`) and the
Domains it lists from another Fleet (`fleet_lists_domain`): one Domain per origin, which the
Kernel's Node selection returns once even when both relations reach it. Publication invokes
`Fleet.publishDomain`; a requested default change is a separate explicit
`Fleet.configureDomainDefault` call on the same Fleet, naming the Domain. Unchanged publication
input is a no-op, and an omitted description preserves the current value. Admin's
`CATALOG_ORIGIN_CONFLICT` refusal (a Fleet other than the core Fleet changes only the Domains it
contains; the core Fleet catalogues an origin only when no Domain of it exists) surfaces as that CLI
error code, with a hint that names only steps that work.
