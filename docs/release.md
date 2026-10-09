# CLI release lifecycle

The CLI v1 is distributed only as a standalone executable through GitHub
Releases. The `@astrale-os/cli` npm package is deprecated and must never be
published again.

Each current platform archive contains exactly one standalone `astrale`
executable. Project development deploys remotely; Kernel Host owns its own
stable ingress lifecycle. Neither requires a CLI-bundled tunnel executable.

## Release

1. Merge conventional feature and fix pull requests into `main`. Every push to
   `main` runs **Release Please**, which creates or updates the beta release pull
   request automatically. No manual dispatch or environment approval gates that
   pull request.
2. Merge the release pull request when its version, changelog, `package.json`,
   and release manifest are ready. Release Please never merges it automatically.
3. That merge runs **Release Please** again. It creates `cli/v<version>` and
   calls **CLI Release** without another manual dispatch or approval.
4. **CLI Release** tests and builds the four Bun 1.4.2 toolchains. Each CLI
   embeds Studio, viewer assets, and the release's Skills. Current source has no
   provider binary pin, acquisition script, or separate provider license asset.
   Intel macOS builds receive an explicit ad-hoc signature because Bun's built-in
   signer currently handles ARM64 only. macOS builds must pass strict code-signature
   verification both before execution and after archive extraction. A failing signature blocks publication; these
   ad-hoc signatures do not provide Developer ID or Apple notarization.
5. The protected `cli-release` publication job uploads the immutable assets,
   then advances the requested channel release. Its environment restricts allowed
   branches; it currently requires no manual reviewer approval.

Never edit release versions or push release tags manually. `CLI Release` may be
dispatched directly only to recover an existing version or create an explicit
canary; it has no push or tag trigger.

## Verification

```bash
gh run list --repo astrale-os/cli --workflow "Release Please" --limit 5
gh release view --repo astrale-os/cli "cli/v<version>"
gh release view --repo astrale-os/cli beta
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
astrale --version
astrale update --check --json
astrale skills status --json
```

The immutable and movable releases must contain `manifest.json`,
`sha256sums.txt`, and all four platform archives (`darwin`/`linux` by
`arm64`/`x64`). Every current archive contains exactly `astrale`. The manifest
records the release version, compiled `binaryVersion`, channel, repository, and
four required asset digests. It uses the existing single-binary format (no
`schemaVersion` field), which already installed CLIs understand; it does not
introduce a new manifest API. A closure, version, checksum, or
native smoke mismatch fails `CLI Release` before publication.

## Compatibility

Compatibility is forward-only: an existing standalone installation can upgrade
to a current single-binary release. The current installer, updater, and release
workflow do not install, repair, or reconstruct retired two-binary releases.

Upgrading a historical CLI to a current release replaces the CLI and clears the
obsolete cohort metadata. It does not delete a retained companion or license:
the installer cannot establish ownership of arbitrary pre-existing files from
their names alone. Current Project development never discovers or launches them.
Old SDK projects using the historical local-development adapter are not migrated
by updating the CLI; update their SDK and Project configuration together.

To qualify an already released standalone CLI against a candidate without
changing either installation or user state:

```bash
node scripts/qualification/standalone-upgrade-e2e.mjs /path/to/previous/astrale /path/to/candidate/astrale
```

The check uses disposable installs, tests checksum refusal, upgrades with a
missing or unusable retained companion, verifies exact executable bytes and
metadata, and confirms the companion was never launched. Native release builds
also exercise this migration using their newly built executable.

## Required controls

- `main` requires pull requests and blocks force-pushes and deletion. It
  currently requires zero approvals and no status checks, code-owner review, or
  last-pusher approval.
- Opening, updating, and finalizing the Release Please pull request requires no
  environment approval. The `cli-release` publication environment restricts
  allowed branches and currently has no required reviewer.
- npm Trusted Publishing is revoked. Package publishing requires an interactive
  human with 2FA and rejects granular tokens; the `beta` dist-tag is absent and
  every published version is deprecated.
- `.github/CODEOWNERS` documents release ownership, and the release contract
  tests detect policy drift; neither is currently a merge requirement.

## Promote an existing release to latest

The installer and new CLI builds default to `latest`, the manually selected release. Ordinary
Release Please publication still advances `beta`; it never advances `latest`. A beta version remains
a beta version when promoted. `latest` is our explicit download tag, independent of GitHub's automatic
“Latest release” designation. The CLI npm package stays frozen.

Only current single-binary releases can be promoted. Historical two-binary manifests are
rejected before any public write, including during rollback.

From a checkout with Node and authenticated `gh`:

```bash
# Discover exact cli/v tags; ignore the moving beta/latest channel releases.
gh release list --repo astrale-os/cli --limit 20 --json tagName,publishedAt

# Read-only: qualify the source workflow, download all six assets, and verify their hashes.
node scripts/promote.mjs cli/v1.0.0-beta.133
```

After the workflow is on `main`:

```bash
# Preview, no public writes and no environment approval.
gh workflow run promote.yml --repo astrale-os/cli --ref main \
  -f release=cli/v1.0.0-beta.133

# Apply only when the user requests this exact release.
gh workflow run promote.yml --repo astrale-os/cli --ref main \
  -f release=cli/v1.0.0-beta.133 -f apply=true

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

Rerun the same promotion to finish an interrupted upload. To roll back, select a previous qualified single-binary
`cli/v...` release with the same command. The manifest and archives retain that exact version;
`astrale update --channel latest` permits moving to it even if older than the installed version.
SDK and CLI releases are promoted separately: verify the intended pair against the deployed Kernel.

GitHub channel refs and six release assets cannot change atomically. During replacement an installer
may see inconsistent hashes and fail safely; retry after the promotion succeeds. A failed promotion
may leave a partial channel, so rerun it before declaring success. Local `--apply` is for authorized
bootstrap/recovery using an existing `gh` login; do not run it concurrently with workflow publication.
