# CLI Admin Fleet catalog adapter (legacy)

Deprecated. The Domain version registry (`../../registry`) replaces the Fleet catalog for
publishing and installing Domains: `astrale-domain publish <environment>` publishes a version,
`astrale domain versions` and `astrale domain install <origin>@<version>` read it. The Fleet
catalog stays the only source of a Fleet's default Domains until catalogue and provisioning by
version ship, so this adapter is kept, unchanged, for the commands that still use it: `domain
publish`, `domain list` and the bare-origin `domain install`
(`src/commands/domain/legacy/`). Short-term consumers: operators who keep a Fleet's defaults
(repointing its Shell default with `astrale domain publish --fleet`), and 1Pact developer machines,
whose adapter-astrale 0.5.0-beta.148 `ensureServices` execs `domain install services.astrale.ai -i
<instance>`. Removal (D15): once catalogue and provisioning by version ship and no supported 1Pact
SDK installs by bare origin, in a breaking CLI release.

The adapter reads policy-visible `Domain` Nodes through bounded Graph pages using stable Class and
Property keys, and derives default membership from the stable Fleet relation. It performs no schema
discovery or reflection. Publication invokes `Fleet.publishDomain`; a requested default change is a
separate explicit `Domain.configureDefault` call. Unchanged publication input is a no-op, and an
omitted description preserves the current value.

A catalog install resolves the caller-visible Instance through the Instance adapter, then invokes
that exact `Instance.installDomain` receiver with the catalog Domain's Node Path. The install reads
the catalog of the one Fleet that contains the Instance (`resourceFleet`), never a Fleet directory.
