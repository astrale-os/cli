# CLI distribution policy

The Astrale CLI v1 has one consumer distribution: the standalone executable
installed by `install.sh` and updated by `astrale update` from GitHub Releases.

The `@astrale-os/cli` npm package is permanently discontinued. It stays private
in this repository, has no npm publication workflow or `publishConfig`, and its
published legacy versions remain deprecated with no active prerelease dist-tag.

Every push to `main` runs Release Please automatically. It creates or updates
the release pull request without environment approval; merging that pull
request remains a deliberate maintainer action. Its merge finalizes the tag and
starts binary construction automatically. Publishing standalone assets still
requires approval in the protected `cli-release` environment. Any change to
this policy, its guarded files, or npm publication capability requires explicit
product-owner approval.
