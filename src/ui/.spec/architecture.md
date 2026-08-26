# UI local tooling

This private CLI owner manages an existing local React project. It does not connect to a Kernel and
does not add React, Base UI, Tailwind, shadcn, or the UI runtime to the installed CLI dependency
graph.

One registry operation resolves one immutable UI commit. Package compatibility and registry reads
use that commit. Patterns and blocks invoke the release-qualified shadcn CLI on demand through the
detected package manager. Released themes copy the exact admitted embedded CSS directly, while a
local playground export is admitted and copied without registry or shadcn. Both theme paths install
consumer-owned source and activate it through one project-relative CSS
import, and complete application writes before the lock advances. Dry-run, list, and doctor do not
claim a file mutation.
