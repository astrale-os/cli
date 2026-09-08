# Astrale CLI

Astrale OS is a graph-based operating system. This autonomous repository is the `cli` submodule of the Astrale workspace and owns the `astrale` CLI, Domain Studio, viewer, and distributable Astrale skills.

## Repository boundaries

- `workspace:*` may reference only packages owned by this repository. Depend on packages owned by another Astrale repository through published versions.
- Use the checked-in package scripts and configuration as the source of truth for tooling and verification.

## Studio and viewer UI

- Reuse `@astrale-os/ui` and its semantic Tailwind tokens before creating custom components or styles.
- The default CLI cloud setup installs neither browsers nor global browser tools/skills. Do not assume `agent-browser`, `chrome-devtools-cli`, or `webapp-testing` is available.
- Studio's checked-in Playwright suite (`pnpm --dir studio test:e2e`) is the source of truth for browser regression checks. The dedicated CI job provisions Chromium and runs it; default cloud sessions can rely on that job for browser validation.
- In a separately prepared environment with browser tools and their skills available, use `agent-browser` for quick UI smoke checks and `chrome-devtools-cli` for deeper diagnosis. Do not add browser installation to the default agent setup.
