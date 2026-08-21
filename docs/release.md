# CLI release lifecycle

Release Please owns the CLI version and immutable GitHub release. The package publisher and
standalone-binary publisher consume that same version; neither invents a second release identity.

## Normal beta release

1. Merge conventional feature and fix pull requests into `main`.
2. The `Release` workflow creates or updates the open Release Please pull request.
3. Select **Approve workflows to run** on the Release Please pull request, then wait for its required
   checks. GitHub puts pull-request workflows created through `GITHUB_TOKEN` in `action_required`
   by design; this is an approval gate, not a failed CI run.
4. Review the proposed version, changelog, `package.json`, and `.release-please-manifest.json`.
5. Merge the Release Please pull request.
6. The merge starts two publications of the same version:
   - `Publish` builds and publishes `@astrale-os/cli` to npm and GitHub Packages. The shared
     publisher derives the npm `beta` dist-tag from a `-beta.N` version.
   - `Release` creates the immutable `cli/v<version>` GitHub prerelease, then calls `CLI Release`
     to test and build four standalone binaries. `CLI Release` uploads the assets and advances the
     movable `beta` tag and channel release.

Do not manually edit `package.json` or `.release-please-manifest.json`, and do not manually push a
version tag during the normal flow.

Removing the workflow-approval click requires configuring a repository or organization GitHub App
installation token or PAT for Release Please. Do not replace this gate with `pull_request_target`,
which would run privileged base-repository automation against release-PR content.

## Enter beta once

The repository previously released `alpha` versions. Changing only `prerelease-type` does not
rename an existing prerelease sequence. The pull request that installs this beta configuration
must therefore use this one-time conventional commit message:

```text
fix(ci): automate CLI beta releases

Release-As: 1.0.0-beta.0
```

Do not merge an outstanding alpha Release Please pull request. After the configuration pull
request lands, confirm that Release Please updates or replaces it with `1.0.0-beta.0` before
merging the release. The configuration keeps `always-update` enabled so the long-lived Release
Please pull request cannot retain an old channel or version after lifecycle changes.

## Promote to stable

Create one promotion pull request that removes these three beta-only settings from
`.release-please-config.json`:

```json
"versioning": "prerelease",
"prerelease": true,
"prerelease-type": "beta"
```

Keep `"tag-separator": "/"`. Give the promotion commit this one-time message:

```text
chore(ci): promote CLI releases to stable

Release-As: 1.0.0
```

After the promotion pull request lands, Release Please proposes `1.0.0`. Merging that release pull
request publishes npm `latest`, creates `cli/v1.0.0`, and advances the standalone `stable` channel.
Subsequent releases use ordinary stable semantic versioning with no workflow changes.

The npm `beta` dist-tag remains as an intentional pointer to the last beta. It does not affect bare
installs after `latest` points to the stable version.

## Verification

For a beta `<version>`:

```bash
gh run list --repo astrale-os/cli --workflow Release --limit 5
gh run list --repo astrale-os/cli --workflow Publish --limit 5
gh release view --repo astrale-os/cli "cli/v<version>"
gh release view --repo astrale-os/cli beta
npm view @astrale-os/cli@beta version
```

Install and verify the standalone beta through the default channel:

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
astrale --version
astrale update --check --json
```

Install and verify the npm package, including Domain Studio:

```bash
npm install -g @astrale-os/cli@beta
astrale --version
astrale studio --help
```

The immutable and movable releases must contain `manifest.json`, `sha256sums.txt`, and all four
archives (`darwin`/`linux` by `arm64`/`x64`). `manifest.json.version` and `binaryVersion` must both
equal the Release Please version. A mismatch fails `CLI Release` before publication.

## Recovery and canary

Manual version tags are recovery-only. A tag must match the version already present in
`package.json`:

```bash
git tag "cli/v<version>" <release-commit>
git push origin "refs/tags/cli/v<version>"
```

`CLI Release` can also be dispatched with an existing package version to rebuild its immutable and
channel assets. Dispatch it without a version only for an explicit `canary` build. Normal pushes to
`main` do not build or publish canaries, so merging a Release Please pull request produces exactly
one four-platform binary build.
