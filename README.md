# Astrale CLI

`astrale` is the CLI to manage and interact with Astrale instances.

- Default admin instance: `https://admin.eu.astrale.ai/api`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

The installer places a verified standalone binary at
`~/.astrale/bin/astrale` by default. The same executable contains the CLI,
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

There is no npm installation mode in v1. This keeps one update path and prevents
two global Astrale versions from competing on `PATH`.

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

`astrale update` atomically upgrades the standalone executable, then invokes the
new binary to install, update, or repair the skills embedded in that exact
release. It follows the beta channel by default. Use `--check`,
`--channel <channel>`, or `--version <version>` to control the release target;
`--no-skills` is the explicit opt-out.

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
- `sessions/` — locally recorded work sessions (see below)

### Session retention

Each invocation appends one line to a local session record under
`~/.astrale/sessions/`; `astrale session list` shows them. The store is swept
automatically against two bounds — sessions idle past `maxAgeDays` are dropped,
then the store is trimmed to `maxBytes`, oldest first. Both are optional:

```jsonc
// ~/.astrale/config.json
{
  "telemetry": {
    "enabled": true,      // false disables recording (the sweep still runs)
    "maxAgeDays": 30,     // default
    "maxBytes": 52428800  // default: 50 MB
  }
}
```

`ASTRALE_TELEMETRY_MAX_AGE_DAYS` and `ASTRALE_TELEMETRY_MAX_BYTES` override the
config for one invocation. Values that are not positive numbers are ignored in
favour of the default, so a typo cannot leave the store unbounded.

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
