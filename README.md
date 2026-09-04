# Astrale CLI

`astrale` is the CLI to manage and interact with Astrale instances.

- Default admin instance: `https://admin.eu.astrale.ai/api`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

The installer places one verified standalone toolchain at `~/.astrale/bin` by
default: the public `astrale` executable and its private, release-pinned
`astrale-cloudflared` companion. The companion's Apache 2.0 license is retained
at `~/.astrale/licenses/cloudflared.txt`. The CLI executable contains the CLI,
[Domain Studio](studio/README.md), its Bun 1.4 runtime, the viewer, and the
Astrale skills. Running the CLI, Studio, viewer, and Astrale skill manager does
not require Node, npm, npx, or a separate Bun install. During the prerelease
period, it follows the beta channel by default.

Optional installer environment:

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_INSTALL_DIR=/usr/local/bin sh
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_CHANNEL=canary sh
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_VERSION=<version> sh
```

The CLI is distributed only as this standalone executable; the npm package is
deprecated. If a package-managed copy is still on `PATH`, remove it with that
package manager, run the installer above, and verify that `command -v astrale`
resolves to `~/.astrale/bin/astrale` (or your explicit `ASTRALE_INSTALL_DIR`).

Generated Project Environments deploy remotely with either adapter. `pnpm dev`
watches `development`; `pnpm dev staging` selects another Environment. The
Environment declares its deployment and optional Kernel installation target.
The Astrale adapter uses Services on the configured instance; the Cloudflare
adapter uses the author's Cloudflare account. Domain development runs no local
Worker or ingress. Stopping orchestration leaves deployment and installation alive.

## Quickstart

```bash
# 1. Log in to your Astrale account.
astrale auth login

# 2. Create a managed alpha instance.
astrale instance create my-app

# 3. Check local CLI context.
astrale status

# 4. Read your identity node on the active instance.
astrale get @self --json
```

If you already have a kernel URL, create a local bookmark:

```bash
astrale instance bookmark staging --url https://kernel.example.com
astrale instance use staging
```

Kernel developers can create or reconnect a child through a Host bookmark:

```bash
astrale instance create development --host astrale-kernel-bryan
astrale get @self -i astrale-kernel-bryan-development
astrale instance root import development --host astrale-kernel-bryan --yes
```

Child bookmarks and root identities are Host-qualified, so identical child
slugs on different Kernels do not collide. This flow uses the selected Host's
caller directly and does not change the active CLI instance.

## Agent Browser

`astrale browser` prepares an authenticated GUI session for your coding agent.
It keeps a persistent per-instance browser profile, handles the one-time login,
and then lets `agent-browser` drive the live page.

```bash
astrale browser --check
astrale browser
agent-browser --profile <profile-dir> snapshot
```

Install the browser driver once:

```bash
npm install -g agent-browser && agent-browser install
npx skills add vercel-labs/agent-browser
```

Astrale manages its own skills without npx. The installer opens an agent picker,
preselects detected or previously configured agents, installs the canonical copy
globally under `~/.agents/skills`, and creates only the selected global links.

```bash
astrale skills configure
astrale skills status
astrale skills update
```

The global `.skill-lock.json` uses the same v3 schema and Git tree hashes as
`skills@1.5.23`, so it remains interoperable with that ecosystem.

## Updating

```bash
astrale update --check
astrale update
```

`astrale update` checksum-verifies and upgrades the standalone CLI, pinned
companion, license, and install metadata as one cohort, then invokes the new CLI
to install, update, or repair the skills embedded in that exact release. A
same-version update repairs a missing or mismatched companion. It follows the
beta channel by default. Use `--check`,
`--channel <channel>`, or `--version <version>` to control the release target;
`--no-skills` is the explicit opt-out.

An old package-managed or source build never overwrites files it does not own.
It directs you to migrate to the official standalone executable instead, while
still updating installed Astrale skills and project SDK dependencies.

On ordinary interactive launches, Astrale checks for CLI updates at most once
per 24 hours and offers **Update now**, **Later**, or **Do not offer this version
again**. It also detects stale local Astrale skills and offers to repair them.

## Commands

The authoritative command surface is generated from the code:

```bash
astrale --help
astrale <command> --help
astrale instance --help
```

Main command groups:

| Group | What it covers |
|-------|----------------|
| Kernel | `get`, `call`, `query`, `introspect`, `logs`, `view`, `token` |
| Context | `status`, `whoami`, `use` |
| Management | `admin`, `instance`, `identity`, `auth`, `idp`, `update` |
| Agent | `browser`, `skills` |

## Path Syntax

```
/domain                        Domain node
/domain/class.Name             Class node
/:domain:class.Name:method     Static method (semantic domain path)
<nodePath>::method             Instance method dispatch
@nodeId                        Reference a node by UID
@nodeId::method                Instance method on a node by UID
```

The full grammar and examples are in `astrale --help`.

## Configuration

CLI state lives under `~/.astrale/`:

- `config.json`
- `instances.json`
- `identities.json`
- keypairs
- cached IdP sessions
- `sessions/` — local work-session telemetry (see below)

### Session telemetry and analyzer

Each invocation appends one redacted event to a local session under
`~/.astrale/sessions/`; `astrale session list` shows the retained sessions. The
opportunistic session analyzer is disabled by default. No detached analyzer or
Claude process is launched unless its dedicated toggle is explicitly enabled.

To opt in persistently, enabling analysis of local CLI events and overlapping
Codex or Claude Code transcripts after 30 minutes of inactivity:

```jsonc
// ~/.astrale/config.json
{
  "telemetry": {
    "enabled": true,
    "analyzerEnabled": true,
    "maxAgeDays": 30,     // default
    "maxBytes": 52428800  // default: 50 MB
  }
}
```

For a shell or one invocation, use `ASTRALE_TELEMETRY_ANALYZER=1`; accepted
opt-in values are `1`, `true`, and `on`. Set it to `0` (also `false` or `off`)
to override an enabled config. An unrecognized value does not opt in.

`ASTRALE_TELEMETRY=0` disables session recording and therefore also prevents
automatic analysis. Manual `astrale session analyze` remains an explicit way to
analyze a retained session while the automatic analyzer is disabled.

The retained store is swept automatically even while telemetry is disabled:
sessions idle past `maxAgeDays` are dropped, then the store is trimmed to
`maxBytes`, oldest first. `ASTRALE_TELEMETRY_MAX_AGE_DAYS` and
`ASTRALE_TELEMETRY_MAX_BYTES` override those bounds for one invocation. Values
that are not positive numbers are ignored in favour of the default, so a typo
cannot leave the store unbounded.

Once a session has been analyzed it is reduced to its durable artifacts —
`meta.json`, `events.jsonl`, `report.md`, the marker and a clamped
`analyzer.log`. The analyzer runs an agent with write access to the session
directory, so anything else it leaves there is scratch and is removed. The
prompt is kept only when the analysis failed, which is the one case where what
the analyzer was asked still matters.

### Browser-profile retention

`astrale browser` keeps one persistent Chromium profile per host under
`~/.astrale/browser/`, so the sign-in cookie survives between runs. That cookie
is a few kilobytes; the cache Chromium piles up around it is not, and Chromium
does not bound it (`--disk-cache-size` is ignored for a profile's HTTP cache).

Every `astrale browser` therefore sweeps the profiles first: one untouched for
longer than `maxProfileAgeDays` is removed outright — its cookie has expired
anyway — and one whose cache exceeds `maxCacheBytes` has its cache directories
emptied. Cookies, Local Storage, Preferences and Local State are never touched,
so you stay signed in. A profile held by a running browser is skipped.

```jsonc
// ~/.astrale/config.json
{
  "browser": {
    "maxCacheBytes": 52428800,  // default: 50 MB, per profile, cache only
    "maxProfileAgeDays": 30     // default
  }
}
```

Overridable per invocation with `ASTRALE_BROWSER_MAX_CACHE_BYTES` and
`ASTRALE_BROWSER_MAX_PROFILE_AGE_DAYS`.

Global skills live under `~/.agents/skills`. Their ecosystem-compatible lock is
`$XDG_STATE_HOME/skills/.skill-lock.json` when XDG state is configured, otherwise
`~/.agents/.skill-lock.json`.

## Development

Contributors use Node.js 26.7.0 by default and pnpm 12.0.0. Release executables
are compiled and qualified with Bun 1.4.0.

```bash
# From the workspace root
pnpm install

# Run directly with Bun
bun cli/bin/astrale.ts <command>

# Build the CLI
pnpm -C cli build
```

The first source command that needs embedded Skills, Studio, or Viewer assets
generates `cli/src/generated/embedded-assets.ts` automatically. Its input digest
is cached under `cli/node_modules/.cache/astrale-cli`, so unchanged commands are
fast. The generated archive is local build output: do not commit it. Run
`pnpm -C cli assets:ensure` to prepare it explicitly.

### Testing local changes live: `astrale-dev`

When developing inside the [workspace](https://github.com/astrale-os/workspace),
`astrale` stays the official released CLI. To run your local CLI source live
(no build, no global link), use `astrale-dev`:

```bash
astrale-dev <command>   # execs `bun <workspace>/cli/bin/astrale.ts` of the
                        # workspace/worktree you are currently in
```

It resolves the workspace from your current directory, so each worktree runs its
own source, and outside a workspace it refuses (use `astrale`). It is installed
by the workspace's `./scripts/init-machine.sh`.
