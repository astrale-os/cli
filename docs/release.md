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
~/.astrale/bin/astrale-cloudflared --version
astrale update --check --json
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
  environment approval. The `cli-release` publication job requires a reviewer
  other than the person who started it.
- npm Trusted Publishing is revoked. Package publishing requires an interactive
  human with 2FA and rejects granular tokens; the `beta` dist-tag is absent and
  every accidentally published beta is deprecated.
- `.github/CODEOWNERS` documents release ownership, and the release contract
  tests detect policy drift; neither is currently a merge requirement.
