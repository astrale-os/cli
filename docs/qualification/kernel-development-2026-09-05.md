# Kernel development and View qualification — 2026-09-05

Status: incomplete. This is scoped evidence, not a no-regression certificate.

## Cohort and isolation

The CLI change starts at `852ddbf`, including fetched origin/main `405e73b` (beta.83).
The pre-change native integration CLI was `514434d`. The updated CLI was compiled with
Bun 1.4.0 to a private temporary fixture; the user's installed binary was not replaced.

The Kernel combines Host and inherited-installation-authority changes at local integration
head `6438a989686ca87e9cf4c683a7a5f4711709504b`. Its admitted production closure was rebuilt as
`astrale-dx-proof/kernel:cli-20260905`, image
`sha256:7f7dc43312bdb5fcb7ce13f92d561d11ca41a8254dc7261caf98fff925be994c`.
Retained profiles were started with an explicit Compose image override, not by replacing
the user's shared local image tags. This is not new `host:up --local` build-isolation evidence.

## Live CLI results

- Both retained loopback Kernels ran concurrently on their original distinct ports.
- Host-root `get @self`, reconnecting B's existing `development` child, root import with
  live-JWKS verification, and child-root `get @self` passed.
- The updated binary created `cli-flow-proof` independently on both Hosts:
  A's child is `@dac95f6a-94cc-4f94-8410-4217f800b5fe`; B's is
  `@7dfc7a96-1ab7-4860-bca7-588f0d9ffd40`.
- Their bookmarks are `astrale-dx-proof-a-cli-flow-proof` and
  `astrale-dx-proof-b-cli-flow-proof`; their root identities and issuers are distinct.
  Both authenticated `get @self` calls and repeat create/reconnect calls passed.
- After `host:down --name dx-proof-a`, B still reconnected and verified its child root.
- The user's active `1pact-semantic-proof` bookmark remained unchanged.

## View cleanup and regression coverage

Remote-first development no longer has an alternate local Worker document to mount.
Removed the internal local-development flag, its Publication proof, mount-transport propagation,
and three dedicated production modules. Studio now calls the canonical `startViewSession`
directly; the Viewer calls Shell's `openView` with the exact Kernel-resolved placement.
Local browser hosting, Kernel proxying, credential boundaries, session lifecycle, target-bound
resolution, and external-origin grants remain. No new public API or configuration was added.

The complete affected production slice shrank from 1,592 to 1,406 physical lines. The removed
proof checks belonged only to the retired alternate transport; canonical placement validation
and credential checks were not moved or duplicated. Removed tests cover that intentionally
retired path; remaining tests assert no override flag/transport, exact placement, credential
privileges, private session storage, Studio compatibility, and executable resolution.

A live missing-View lookup previously escaped as an unhandled native stack trace. The command
now uses its existing structured fatal-error boundary. The updated binary returned one JSON
`VIEW_NOT_FOUND` error, and the focused regression test verifies the code and absence of browser
effects. Typechecking, lint, and 28 focused tests passed. The complete test command also passed
for the transport cleanup before the additional error-boundary test; that final test passed
in the focused rerun.

## Open gates

- Actual Shell Views did not connect: the installed `home` and `group` routes point to
  `https://app.astrale.ai/` and `/groups`; their Shell handshake timed out after 10 seconds.
  This reproduced with the pre-cleanup integration binary and with the updated binary.
  Session startup is therefore not evidence of successful rendering or application usability.
- Successful open/refresh/close of a generated application's remote View still needs a real
  View-bearing fixture; the retained Cloudflare smoke application declares no `main` View.
- Named-tunnel/DNS lifecycle, full packed latest Services/SDK integration, and provider-secret
  candidate parity remain separately unqualified. No tunnel or shared remote upgrade was used.
- Local builds still share Docker tags across profiles. Concurrent build/restart isolation
  needs a separate fix/proof; the explicit image override above only isolates this test run.

Only owned View sessions and the named browser session were closed. Both test Hosts were stopped
without deleting persistent generations or child/root bookmarks. No remote deployment was deleted.
