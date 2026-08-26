# UI local tooling

This private CLI owner manages an existing local React project. It does not connect to a Kernel and
does not add React, Base UI, Tailwind, shadcn, or the UI runtime to the installed CLI dependency
graph.

One operation resolves one immutable UI commit. During the V1 prerelease, operations without an
explicit version resolve the npm `beta` dist-tag; the legacy `latest` channel is not a V1 source.
Package compatibility and registry reads use that commit, and the detected package manager invokes
the release-qualified shadcn CLI on demand.
Application writes complete before the lock advances. Dry-run, list, view, diff, and doctor do not
claim a file mutation.
