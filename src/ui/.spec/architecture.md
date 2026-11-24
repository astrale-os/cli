# UI local tooling

This private CLI owner manages an existing local React project. It does not connect to a Kernel and
does not add React, Base UI, Tailwind, shadcn, or the UI runtime to the installed CLI dependency
graph.

One UI operation resolves one immutable UI commit. During the V1 prerelease, operations
without an explicit version resolve the npm `beta` dist-tag; the `latest` dist-tag is not a V1
source. Package compatibility and registry reads use that commit. Each registry item is admitted on
its own against the install contract: consumer-owned files under `components/astrale/` and npm
package requirements only. A theme is one bounded stylesheet of plain style rules that loads no
other resource: its light theme rule declares every color, effect, shape, density, type, and motion
token, and its dark theme rule declares every color and effect token again. A refused item is reported with its reason when requested and does not
affect the others. The UI release gate and CLI CI both run the search provider qualification, which
requires every published item and every search handoff to be admitted. Patterns and blocks invoke the
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

Request is the separate contribution journey. It submits one bounded intent, keyed by its
digest, to the `ui.astrale.ai` Domain of the current Instance and returns only an exact receipt.
