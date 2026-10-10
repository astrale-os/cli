# CLI Admin registry adapter

The adapter reads and writes the global Domain version registry Admin keeps (CT26/CT27): one
`Domain` per origin, the same Node Fleet catalogs list, and one immutable `Publication` per
version. It turns them into the CLI registry plumbing documents (CT29) that `astrale domain
versions` and the hidden `astrale __domain-registry` commands print, and that the SDK's `diff`,
`publish` and `yank` read.

Reads are the caller's own Queries on Admin's graph, never a reflection of Admin's schema and never
a call made under Admin's authority. The index is one Query from the origin's `Domain` through
incoming `publication_of_domain` to its Publications, so `ObserveDomain` and `ReadPublication`
decide what the caller sees: domain admins and installers, directly or through Groups, read the
versions; a Fleet whose catalog lists the Domain lets its members read the Domain but not its
versions. Only an empty answer is followed by a second Query on the `Domain` itself, to tell "no
version readable" from "absent or not permitted"; the two latter are one refusal,
`REGISTRY_DOMAIN_NOT_FOUND`, so nothing reveals a Domain the caller cannot read. No read lists who
holds access (AM-53): access is Admin's to show.

An origin is claimed before its first version. `claim` calls Admin's static `Domain.create` with
the origin alone: first claim gives an origin no one has to its caller, who becomes the first
administrator of its Domain, and Admin does not verify who owns the origin. A caller who already
administers the Domain gets the same answer, so a rerun is safe. An origin another account holds
is `REGISTRY_ORIGIN_CLAIMED`; an origin under `astrale.ai`, which only Astrale operators register,
is `REGISTRY_ORIGIN_RESERVED`; a caller that is no Admin account is `REGISTRY_FORBIDDEN`.

The other changes are Admin Methods on a Node: `Domain.publish` on the Domain's Node and
`Publication.yank` / `unyank` on the Publication's Node. Admin's Policies decide who may call them, and Admin's
absence check makes a rerun safe: the same version and release digest answer `unchanged`. The
publish result passes Admin's retention mark through (`marked`, `failed`, `not-applicable`);
rerunning the same publish marks a `failed` deployment again.

Admin keeps no bundle. `bundle` reads the Publication through Admin, then the release its
deployment serves (`release.json`), admitted only with the Publication's release digest, then the
Schema Bundle that release describes (`schema.bundle.href`). The bytes are written to the output
file only after their byte count and sha256 digest match the descriptor (`schema.bundle.ref`); a
partial file never takes the output name. Each deployment GET follows no redirect and is bounded by
`--timeout`. The output is checked and its partial file created before the deployment is read, and
a local file failure is the caller's `FILE_WRITE_FAILED`, never a registry refusal. A deployment
that does not answer, serves another release or a bundle that does not match gets the refusals
Admin's `publish` gives for the same answers (`PUBLICATION_RELEASE_UNREACHABLE`,
`PUBLICATION_RELEASE_MISMATCH`).

Failures are translated once, in `failure.ts`, into the CT29 vocabulary. `REGISTRY_UNAVAILABLE`
always allows a rerun of the same command, and says a rerun can help only with
`details.retryable: true`; on a change, `details.delivery: 'unknown'` says the change may have
applied, which the rerun settles.

Strict local decoders admit every field the adapter reads and ignore fields Admin adds later, so an
additive Admin release never breaks a published CLI. Versions are admitted by
`@astrale-os/sdk/versioning` (AM-18); the adapter only orders the index by SemVer precedence.
