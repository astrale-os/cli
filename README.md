# Astrale CLI

`astrale` is the CLI to manage and interact with Astrale instances.

- Default admin instance: `https://admin.eu.astrale.ai/api`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

The installer places a verified standalone binary at
`~/.astrale/bin/astrale` by default. No local runtime is installed. During the
prerelease period, it follows the beta channel by default.

Optional installer environment:

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_INSTALL_DIR=/usr/local/bin sh
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_CHANNEL=canary sh
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | ASTRALE_VERSION=<version> sh
```

### npm (CLI + Domain Studio)

Alternatively, install from npm — this runs the CLI under Node and additionally
ships the [Domain Studio](studio/README.md) (`astrale studio`):

```bash
npm install -g @astrale-os/cli
```

During the prerelease period, install the current beta explicitly:

```bash
npm install -g @astrale-os/cli@beta
```

The npm build bundles all dependencies, so no private-registry access is needed.
`astrale studio` launches a local web GUI to author and inspect a domain, with
local Claude Code and Codex agent harnesses (`--harness claude|codex`); it runs on
[Bun](https://bun.sh), so install Bun and keep it on `PATH` to use that command
(the rest of the CLI needs only Node ≥ 22). The curl-installed standalone binary
above does not include the studio — use the npm install for `astrale studio`.

> Prereleases use their matching npm dist-tag (`alpha`, `beta`, or `rc`); bare
> `npm install -g @astrale-os/cli` follows the stable `latest` tag. The curl
> installer has separate binary channels with the same names.

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
npx skills add astrale-os/cli            # installs every Astrale skill published by this repository
npx skills add vercel-labs/agent-browser
```

To install just one, select `astrale-cli`, `astrale-domain`, `astrale-frontend-design`, or
`astrale-services`, for example: `npx skills add astrale-os/cli@astrale-frontend-design`.

## Updating

```bash
astrale update --check
astrale update
```

`astrale update` upgrades official script installs, ensures every Astrale agent skill published
from `astrale-os/cli` is installed and healthy, and follows the beta channel by default. It reports
whether the skill pass was unchanged, installed, updated, or repaired. Use `--check`,
`--channel <channel>`, or `--version <version>` to control the CLI release target; skills always
resolve the repository's current `main` once, verify the installed trees against that commit, and
stamp the exact revision/tree binding into the Astrale-owned receipt. A current
`astrale update --check --json` result includes the resolved source revision plus every shipped
skill's Git tree and entrypoint, so runners can retain the actual loadout rather than only
`status: current`. `--no-skills` is the explicit opt-out.

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
| Agent | `browser` |

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

## Development

Contributors use Node.js 26.7.0 by default; Node.js 24 is also supported. pnpm is
pinned to 11.13.1. The source-worktree runtime contract is enforced separately
from the published CLI's Node ≥ 22 contract.

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
