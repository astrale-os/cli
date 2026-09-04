# CLI release lifecycle

The CLI v1 is distributed only as a standalone executable through GitHub
Releases. The legacy `@astrale-os/cli` npm package is frozen and deprecated; it
must never be published again.

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
4. **CLI Release** tests and builds the four Bun 1.4.0 toolchains. Each CLI
   embeds Studio, viewer assets, and the release's Skills. Current source has no
   provider binary pin, acquisition script, or separate provider license asset.
5. Approve the protected `cli-release` publication job. It uploads the immutable
   assets, then advances the requested channel release.

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

The installer and updater retain schema-v2 support for explicitly selected
historical releases. Their original companion and license are still verified
and committed transactionally; same-version repair still works for those releases.
Historical release recovery checks out the immutable source tag. Only tags
containing `cloudflared.lock.json` execute their own pinned acquisition and
three-file packaging scripts. This is exercised compatibility, not the current
development runtime.

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
  environment approval. The `cli-release` publication job requires a reviewer
  other than the person who started it.
- npm Trusted Publishing is revoked. Package publishing requires an interactive
  human with 2FA and rejects granular tokens; the `beta` dist-tag is absent and
  every accidentally published beta is deprecated.
- `.github/CODEOWNERS` documents release ownership, and the release contract
  tests detect policy drift; neither is currently a merge requirement.
