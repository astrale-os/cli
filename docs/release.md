# CLI release lifecycle

The CLI v1 is distributed only as a standalone executable through GitHub
Releases. The legacy `@astrale-os/cli` npm package is frozen and deprecated; it
must never be published again.

Each platform archive is one standalone toolchain containing the public
`astrale` executable, its private release-pinned `astrale-cloudflared`
companion, and the companion license.

## Release

1. Merge conventional feature and fix pull requests into `main`. Every push to
   `main` runs **Release Please**, which creates or updates the beta release pull
   request automatically. No manual dispatch or environment approval gates that
   pull request.
2. Merge the release pull request when its version, changelog, `package.json`,
   and release manifest are ready. Release Please never merges it automatically.
3. That merge runs **Release Please** again. It creates `cli/v<version>` and
   calls **CLI Release** without another manual dispatch or approval.
4. **CLI Release** tests and builds the four Bun 1.4.0 toolchains. Each CLI
   embeds Studio, viewer assets, and the release's Skills. Each archive also
   includes the exact cloudflared version pinned by `cloudflared.lock.json` and
   the distribution copy at `licenses/cloudflared.txt`.
5. The protected `cli-release` publication job uploads the immutable assets, then advances
   the requested channel release under the configured environment rules.

Never edit release versions or push release tags manually. `CLI Release` may be
dispatched directly only to recover an existing version or create an explicit
canary; it has no push or tag trigger.

## Verification

```bash
gh run list --repo astrale-os/cli --workflow "Release Please" --limit 5
gh release view --repo astrale-os/cli "cli/v<version>"
gh release view --repo astrale-os/cli beta
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_CHANNEL=beta sh
astrale --version
~/.astrale/bin/astrale-cloudflared --version
astrale update --channel beta --check --json
astrale skills status --json
```

The immutable and movable releases must contain `manifest.json`,
`sha256sums.txt`, and all four platform archives (`darwin`/`linux` by
`arm64`/`x64`). Every archive contains exactly `astrale`,
`astrale-cloudflared`, and `LICENSE.cloudflared`. Manifest schema v2 records the
release version, compiled `binaryVersion`, and pinned `cloudflaredVersion`; the
four asset digests close over those archives. A closure, version, checksum, or
native smoke mismatch fails `CLI Release` before publication.

## Required controls

- `main` requires pull requests and blocks force-pushes and deletion. It
  currently requires zero approvals and no status checks, code-owner review, or
  last-pusher approval.
- Opening, updating, and finalizing the Release Please pull request requires no
  environment approval. The `cli-release` publication job follows the configured environment
  protection rules (currently protected branches only).
- npm Trusted Publishing is revoked. Package publishing requires an interactive
  human with 2FA and rejects granular tokens; the `beta` dist-tag is absent and
  every accidentally published beta is deprecated.
- `.github/CODEOWNERS` documents release ownership, and the release contract
  tests detect policy drift; neither is currently a merge requirement.

## Promote an existing release to latest

The installer and new CLI builds default to `latest`, the manually selected release. Ordinary
Release Please publication still advances `beta`; it never advances `latest`. A beta version remains
a beta version when promoted. `latest` is our explicit download tag, independent of GitHub's automatic
“Latest release” designation. The CLI npm package stays frozen.

From a checkout with Node and authenticated `gh`:

```bash
# Discover exact cli/v tags; ignore the moving beta/latest channel releases.
gh release list --repo astrale-os/cli --limit 20 --json tagName,publishedAt

# Read-only: qualify the source workflow, download all six assets, and verify their hashes.
node scripts/promote.mjs cli/v1.0.0-beta.85
```

After the workflow is on `main`:

```bash
# Preview, no public writes and no environment approval.
gh workflow run promote.yml --repo astrale-os/cli --ref main \
  -f release=cli/v1.0.0-beta.85

# Apply only when the user requests this exact release.
gh workflow run promote.yml --repo astrale-os/cli --ref main \
  -f release=cli/v1.0.0-beta.85 -f apply=true

gh run list --repo astrale-os/cli --workflow promote.yml --limit 10 \
  --json databaseId,displayTitle,status,conclusion,url
gh run watch <matching-run-id> --repo astrale-os/cli --exit-status
gh release view latest --repo astrale-os/cli --json tagName,body,assets
astrale update --channel latest --check --json
```

Apply uses the existing protected `cli-release` environment and `GITHUB_TOKEN`, and serializes with
ordinary channel publication. The existing environment rules apply; promotion adds no new approval
gate. The script checks a successful binary publication qualification
on the exact release commit (including reusable CLI Release jobs within Release Please), all archive
hashes, checksums, and the manifest. It copies the existing archives without rebuilding, sets only the
copied manifest's `channel` to `latest`, and verifies the resulting ref and all six assets. It never
executes tooling from the selected old release.

### First activation

There is no public `latest` CLI channel until the first authorized promotion. **Seed it before
rolling out the installer default change**, otherwise bare installation will fail with a missing
manifest. An authorized operator can seed a qualified existing release with
`node scripts/promote.mjs <exact-cli-tag> --apply` from this checkout before merging. Then merge the
changes, release a CLI beta containing the new updater default, and promote that version. This setup
change alone must not seed or publish anything.

Old binaries still default to `beta`, including when an old release is selected for rollback. Use
`astrale update --channel latest` explicitly to move those installations to the selected channel.
New binaries use `latest` by default; `--channel beta` opts into the moving beta for that run. For
installation before activation or for deliberate beta consumption, use `ASTRALE_CHANNEL=beta`.
No implicit fallback to beta is used when latest is absent or unavailable.

### Rerun and rollback

Rerun the same promotion to finish an interrupted upload. To roll back, select a previous qualified
`cli/v...` release with the same command. The manifest and archives retain that exact version;
`astrale update --channel latest` permits moving to it even if older than the installed version.
SDK and CLI releases are promoted separately: verify the intended pair against the deployed Kernel.

GitHub channel refs and six release assets cannot change atomically. During replacement an installer
may see inconsistent hashes and fail safely; retry after the promotion succeeds. A failed promotion
may leave a partial channel, so rerun it before declaring success. Local `--apply` is for authorized
bootstrap/recovery using an existing `gh` login; do not run it concurrently with workflow publication.
