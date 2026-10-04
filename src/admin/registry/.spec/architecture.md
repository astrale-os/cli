# CLI Admin registry adapter

The adapter reads and writes the global Domain version registry Admin keeps (CT26/CT27): one
`RegisteredDomain` per origin and one immutable `Publication` per version. It turns them into the
CLI registry plumbing documents (CT29) that `astrale domain versions` and the hidden
`astrale __domain-registry` commands print, and that the SDK's `diff`, `publish` and `yank` read.

Reads are the caller's own Queries on Admin's graph, never a reflection of Admin's schema and never
a call made under Admin's authority. The index is one Query from the origin's `RegisteredDomain`
through incoming `publication_of_domain` to its Publications, so `ObserveRegisteredDomain` and
`ReadPublication` (domain admins and installers, directly or through Groups) decide what the caller
sees. Only an empty answer is followed by a second Query on the `RegisteredDomain` itself, to tell
"no version yet" from "absent or not permitted"; the two latter are one refusal,
`REGISTRY_DOMAIN_NOT_FOUND`, so nothing reveals a Domain the caller cannot read. No read lists who
holds access (AM-53): access is Admin's to show.

Changes are Admin Methods: `RegisteredDomain.publish` on the Domain's Node and `Publication.yank` /
`unyank` on the Publication's Node. Admin's Policies decide who may call them, and Admin's own
compare-and-swap makes a rerun safe: the same version and release digest answer `unchanged`.

A bundle download goes through the Kernel `download` syscall on the Publication's `bundle` Property
and is written to the output file only after its byte count and sha256 digest match the
Publication's descriptor; a partial file never takes the output name.

Strict local decoders admit every field the adapter reads and ignore fields Admin adds later, so an
additive Admin release never breaks a published CLI. Versions are admitted by
`@astrale-os/sdk/versioning` (AM-18); the adapter only orders the index by SemVer precedence.
