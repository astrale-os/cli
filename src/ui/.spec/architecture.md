# UI local tooling

This private CLI owner manages an existing local React project. It does not connect to a Kernel and
does not add React, Base UI, Tailwind, shadcn, or the UI runtime to the installed CLI dependency
graph.

One registry operation resolves one immutable UI commit. Package compatibility and registry reads
use that commit, and the detected package manager invokes the release-qualified shadcn CLI on
demand. A local playground-exported theme is instead admitted and copied without network or
shadcn. Both paths install consumer-owned source, activate themes through one project-relative CSS
import, and complete application writes before the lock advances. Dry-run, list, and doctor do not
claim a file mutation.
