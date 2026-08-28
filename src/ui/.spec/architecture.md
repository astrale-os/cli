# UI local tooling

This private CLI owner manages an existing local React project. It does not connect to a Kernel and
does not add React, Base UI, Tailwind, shadcn, or the UI runtime to the installed CLI dependency
graph.

One UI operation resolves one immutable UI commit. During the V1 prerelease, operations
without an explicit version resolve the npm `beta` dist-tag; the legacy `latest` channel is not a V1
source. Package compatibility and registry reads use that commit. Patterns and blocks invoke the
release-qualified shadcn CLI on demand through the detected package manager. Released themes copy
the exact admitted embedded CSS directly, while a local playground export is admitted and copied
without registry or shadcn. Both theme paths install consumer-owned source and activate it through
one project-relative CSS import, and complete application writes before the lock advances. Dry-run
and doctor do not claim a file mutation.

Search is the sole public discovery journey. It reads a generated manifest and lexical artifact by
the same immutable UI commit, never loads the registry before ranking, and hydrates only returned
canonical demos. Admitted artifacts and code are cached under that commit with digest verification;
corrupt cache entries are repaired from the same release. The public result exposes no internal
family, provider, or score and hands registry candidates directly to `astrale ui add`.
