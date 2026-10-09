# Prepare CLI

`scripts/setup/setup.sh` downloads the Config setup archive pinned by version and
SHA-256 in `setup.lock`. `repo.sh` selects the CLI profile; implementation lives in
[Config setup](https://github.com/astrale-os/config/tree/main/setup).

Setup activates Node, pnpm and Bun from the repository's version declarations,
installs dependencies at the standalone workspace root and runs `pnpm assets:ensure`.
That product command prepares Viewer, Studio and embedded skills and reuses its
asset digest cache. Setup prepares Chromium, agent-browser and Chrome DevTools tools,
and their skills for the selected harness. It also installs the Chromium revisions
required by root and Studio Playwright. It installs no global Astrale CLI.
It does not build a release executable or deploy anything.

- Prepare: `bash scripts/setup/setup.sh`.
- Verify without download, installation or asset generation: `bash scripts/setup/verify.sh`.
- Codex: disable cache; Setup `AGENT_HARNESSES=codex bash scripts/setup/setup.sh`;
  Maintenance empty.
- Claude: environment Setup empty; committed SessionStart prepares on changed setup
  inputs, otherwise loads paths. Failed preparation leaves no success marker.
- Conductor: `AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh` checks existing
  machine tools at the required versions, then installs dependencies and prepares
  assets. It may download the pinned archive but never installs machine tools or browsers;
  the project Playwright browsers must already be installed.
  Local Claude hooks only restore prepared paths.

Verification checks runtime versions, root/Studio tools, asset freshness and
`bun bin/run.ts --version`. For development use `bun bin/astrale.ts`; the global
released CLI is unnecessary. Verification also checks global browser tools and skills,
and launches Chromium through root and Studio Playwright. Verify interface changes in
Chromium during development and run the relevant checked-in Playwright suite.
The dedicated CI job also runs browser tests.

Allow GitHub release downloads, including `release-assets.githubusercontent.com`,
as well as runtime and package registry hosts. Bootstrap requires Bash, Git, curl,
tar/gzip and SHA-256 tooling; remote Claude also needs `flock`.
Dependency installation may update the lockfile; inspect changes before committing.
In the umbrella workspace, use its root installation instead.

CI executes the pinned archive and verifies reuse. Update version and digest together
only after qualifying a new archive. Validate fresh cloud sessions without manually
rerunning setup or repairing paths. Run application tests as a non-root user with
normal process reaping; permission and process-lifecycle assertions depend on this.
