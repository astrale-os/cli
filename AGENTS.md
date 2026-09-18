# Astrale CLI

Astrale OS is a graph-based operating system. This autonomous repository is the `cli` submodule of the Astrale workspace and owns the `astrale` CLI, Domain Studio, viewer, and distributable Astrale skills.

## Repository boundaries

- `workspace:*` may reference only packages owned by this repository. Depend on packages owned by another Astrale repository through published versions.
- Use the checked-in package scripts and configuration as the source of truth for tooling and verification.

## Studio and viewer UI

- Reuse `@astrale-os/ui` and its semantic Tailwind tokens before creating custom components or styles.
- The default CLI cloud setup prepares Chromium, `agent-browser`, `chrome-devtools`, and their corresponding skills, plus the browsers required by the project's Playwright versions.
- For Studio or Viewer interface changes, launch the application and verify the changed interactions and visible states in Chromium before considering the work complete. Load the `agent-browser` skill for quick UI smoke checks; use the `chrome-devtools-cli` skill for console, network, and deeper browser diagnosis.
- Use the checked-in Playwright suites (`pnpm --dir studio test:e2e` and `pnpm test:viewer:browser`) for browser regression checks. The dedicated CI job remains an additional check; it does not replace browser verification during development.
