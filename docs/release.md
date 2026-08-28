# CLI release lifecycle

The CLI v1 is distributed only as a standalone executable through GitHub
Releases. The legacy `@astrale-os/cli` npm package is frozen and deprecated; it
must never be published again.

Each platform archive is one standalone toolchain containing the public
`astrale` executable, its private release-pinned `astrale-cloudflared`
companion, and the companion license.

## Manual release

1. Merge conventional feature and fix pull requests into `main`. No release
   workflow runs automatically.
2. Manually dispatch **Release (manual)** and approve its protected
   `cli-release` environment. Release Please creates or updates its pull request.
3. Review the version, changelog, `package.json`, and release manifest; wait for
   required CI and code-owner approval, then merge the pull request.
4. Manually dispatch **Release (manual)** again. After environment approval,
   Release Please creates `cli/v<version>` and calls **CLI Release**.
5. Approve the `cli-release` publication job. It tests and builds the four Bun
   1.4.0 toolchains. Each CLI embeds Studio, viewer assets, and the release's
   Skills. Each archive also includes the exact cloudflared version pinned by
   `cloudflared.lock.json` and the distribution copy at
   `licenses/cloudflared.txt`. The job uploads the immutable assets, then
   advances the requested channel release.

Never edit release versions or push release tags manually. `CLI Release` may be
dispatched directly only to recover an existing version or create an explicit
canary; it has no push or tag trigger.

## Verification

```bash
gh run list --repo astrale-os/cli --workflow "Release (manual)" --limit 5
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

- `main` requires pull requests, required CI, code-owner review, and approval of
  the latest change; administrators do not bypass these rules.
- `cli-release` requires a reviewer other than the person who started the job.
- npm Trusted Publishing is revoked. Package publishing requires an interactive
  human with 2FA and rejects granular tokens; the `beta` dist-tag is absent and
  every accidentally published beta is deprecated.
- `.github/CODEOWNERS` and CI protect the workflow, package, release policy, and
  their contract tests.
