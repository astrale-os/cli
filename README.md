# Astrale CLI

`astrale` is the CLI to manage and interact with Astrale instances.

- Default admin instance: `https://admin.eu.astrale.ai/api`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

The installer places a verified standalone binary at
`~/.astrale/bin/astrale` by default. No local runtime is installed.

Optional installer environment:

```bash
ASTRALE_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
ASTRALE_VERSION=<version> curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

## Quickstart

```bash
# 1. Log in to your Astrale account.
astrale auth login

# 2. Create a managed alpha instance.
astrale instance create my-app

# 3. Check local CLI context.
astrale status

# 4. Call a function on the active instance.
astrale call /:dist.astrale.ai:class.Echo:echo message=hello
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
npx skills add astrale-os/cli            # installs both the astrale-cli (ops) and astrale-domain (authoring) skills
npx skills add vercel-labs/agent-browser
```

To install just one: `npx skills add astrale-os/cli@astrale-cli` or
`npx skills add astrale-os/cli@astrale-domain`.

## Updating

```bash
astrale update --check
astrale update
```

`astrale update` upgrades official script installs. Use `--check`,
`--channel <channel>`, or `--version <version>` to control the target release.

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
| Kernel | `ls`, `get`, `call`, `query`, `describe`, `token` |
| Context | `status`, `whoami`, `use` |
| Management | `admin`, `instance`, `identity`, `auth`, `idp`, `update` |
| Agent | `browser` |

## Path Syntax

```
/domain                        Domain node
/domain/class.Name             Class node, or /domain/interface.Name
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

## Development

```bash
# From the workspace root
pnpm install

# Run directly with Bun
bun cli/bin/astrale.ts <command>

# Build the CLI
pnpm -C cli build
```
