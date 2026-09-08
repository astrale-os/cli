# Astrale CLI

Astrale OS is a graph-based operating system. This autonomous repository is the `cli` submodule of the Astrale workspace and owns the `astrale` CLI, Domain Studio, viewer, and distributable Astrale skills.

## Repository boundaries

- `workspace:*` may reference only packages owned by this repository. Depend on packages owned by another Astrale repository through published versions.
- Use the checked-in package scripts and configuration as the source of truth for tooling and verification.

## Studio and viewer UI

- Reuse `@astrale-os/ui` and its semantic Tailwind tokens before creating custom components or styles.
- For quick UI smoke checks, load the `agent-browser` skill and use the `agent-browser` CLI.
- For repeatable checks or regression tests, use Playwright through the `webapp-testing` skill.
- For deep browser diagnosis, load the `chrome-devtools-cli` skill and use the Chrome DevTools CLI.
