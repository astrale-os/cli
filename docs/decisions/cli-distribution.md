# CLI distribution policy

The Astrale CLI v1 has one consumer distribution: the standalone executable
installed by `install.sh` and updated by `astrale update` from GitHub Releases.

The `@astrale-os/cli` npm package is permanently discontinued. It stays private
in this repository, has no npm publication workflow or `publishConfig`, and its
published legacy versions remain deprecated with no active prerelease dist-tag.

Release Please never runs from a push to `main`. An authorized maintainer must
dispatch it manually; publishing standalone assets also requires approval in
the protected `cli-release` environment. Any change to this policy, its guarded
files, or npm publication capability requires explicit product-owner approval.
