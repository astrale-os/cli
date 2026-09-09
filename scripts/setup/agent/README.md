# CLI agent setup

From a standalone CLI checkout (no runtime required beforehand):

```bash
AGENT_HARNESSES=codex bash scripts/setup/agent/setup.sh
AGENT_HARNESSES=codex bash scripts/setup/agent/verify.sh
```

Use `claude` for Claude or `codex,claude` for both. Setup installs Node from `.nvmrc`,
pnpm from `package.json#packageManager`, and the exact Bun from `.bun-version`.
The common bootstrap may reuse another Bun initially; CLI preparation activates its pinned
runtime before building source assets and persists that path for later agent commands.

## Repository preparation

`setup_repo.sh --check` checks the standalone Git root, runtime declarations, workspace,
Studio and both test fixture manifests before installing anything. One root pnpm install
prepares the four workspace packages, preserving the declared native build allowlist and
release-age policy. `pnpm assets:ensure` prepares Viewer, Studio and embedded skills for
source development; its existing digest cache avoids rebuilding unchanged assets on reuse.
It does not build a release executable, link the source CLI globally, or deploy anything.

Development installs use `STANDALONE=true pnpm install --no-frozen-lockfile --prefer-offline`.
They report lockfile changes and preserve branch/HEAD. CI and release installs remain frozen.
The old README's `./setup.sh` did not exist on main; its caller now points to this entry point.
No legacy agent setup scripts or Conductor configuration remained in this revision.
The CLI's product command `astrale setup` is unrelated and remains intact.

## Tools and skills

Browser tools/skills and the published Astrale CLI/skills are **disabled by default**, as
specified by `repo.config.sh`. This repository develops the CLI source; it does not install
its released executable. No additional global skills should be attributed to this setup
in a fresh default session. Existing host tools/skills are not removed.
The distributable skills under `skills/` remain source assets, not global agent installations.

The common optional flags still accept explicit `0`/`1` overrides. Optional tooling is only
verified when enabled. Studio's existing browser CI job owns its own Playwright dependency
and Chromium installation; default agent setup does not download browsers.

`verify.sh` installs nothing. It checks Node/pnpm/Bun versions, root and Studio development
tools, generated assets and the source CLI's `--version`. It does not generate missing assets.
Run source commands with `bun bin/astrale.ts`; the released global `astrale` is not required.

## Cloud

- Codex: select `astrale-os/cli`, disable container caching, use only Setup:
  `AGENT_HARNESSES=codex bash scripts/setup/agent/setup.sh`. No Maintenance script.
- Claude: select `astrale-os/cli`, leave environment Setup empty. The committed SessionStart
  hook handles `startup|resume|clear|fork`, installing and verifying once per physical checkout.
  Only successful verification creates its marker. Subsequent hooks only restore paths through
  `CLAUDE_ENV_FILE`; they do not run pnpm, setup or verification. Local hooks only load paths.
- Use the existing Astrale Claude environment. Default package-manager access plus `nodejs.org`,
  `registry.npmjs.org`, `jsr.io`, `npm.jsr.io`, `github.com`, `api.github.com`,
  `raw.githubusercontent.com`, `codeload.github.com`, and Ubuntu mirrors covers preparation.
  A fresh Linux machine needs Git, Bash and APT/root or passwordless sudo to bootstrap system
  prerequisites; Claude initialization also needs `flock` (util-linux).

For cloud validation, inspect the initial shell and active skill inventory, then run verify.
Do not rerun setup, source env.sh manually or repair PATH: that would mask startup defects.
Record initial installation and prepared-checkout reuse as separate results.

## Shared standard and checks

Eight files are synchronized unchanged from Config revision
`49291648ffb6fcff3247a73251c40c8d7574ec35`. The CI `agent-setup` job compares the copies
against that pinned source and executes shared and repository tests. Make common changes
in Config first and sync them; options, pinned Bun preparation, assets, verification and the
Claude hook are CLI-owned. From the reviewed Config checkout:

```bash
bash agent-setup/sync.sh /path/to/cli
bash agent-setup/sync.sh --check /path/to/cli
node --test agent-setup/*.test.cjs /path/to/cli/scripts/setup/agent/*.test.cjs
```

## Validation

On 2026-09-08, an isolated Ubuntu 24.04 arm64 container passed initial setup,
readiness verification, repeated setup with cached assets, and the Claude hook's initial
preparation followed by paths-only reuse with an unchanged success marker. All 18 shared
and repository setup tests passed on Linux. Browser and published Astrale tools/skills were
not installed. Lint and all CLI/Viewer/Studio typechecks passed. The application suite passed
1,553 tests (one workspace-only skip), followed by 51 script tests, using a non-root test
user and a subreaper for process-lifecycle tests. Running that suite as root or with `sleep`
as container PID 1 invalidates its permission/process-lifecycle expectations.
Real Codex and Claude Cloud session validation is recorded separately from local results.
