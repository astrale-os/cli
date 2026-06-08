# Astrale CLI

`astrale` connects to Astrale kernels, authenticates with WorkOS, provisions
managed alpha instances through the Astrale admin control plane, and calls
domain functions on the selected instance.

- Binary: `astrale`
- Alpha installer: `curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh`
- Default admin kernel: `https://admin.eu.astrale.ai/api`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
# or, on minimal Linux images without curl:
wget -qO- https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

The installer downloads the standalone binary from GitHub Releases, verifies
its SHA-256 checksum, and installs it to `~/.astrale/bin/astrale` by default.
It does not install Bun, npm packages, Docker, or a local manager.

Optional installer environment:

```bash
ASTRALE_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
ASTRALE_VERSION=0.4.0-alpha.7 curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
ASTRALE_CHANNEL=canary curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh
```

## Alpha Quickstart

```bash
# 1. Log in with your WorkOS account.
astrale auth login

# 2. Create a managed alpha instance.
#    The admin control plane selects your assigned host when you have exactly one.
astrale instance create my-app

# 3. Confirm the instance is active.
astrale instance active

# 4. Call a function on the active instance.
astrale call /:dist.astrale.ai:class.Echo:echo message=hello
```

An Astrale admin must grant your WorkOS user access before `instance create`
can succeed. If your account has no assigned host, or more than one host is
eligible, the admin kernel returns a clear placement error.

## Updating

```bash
astrale update --check
astrale update
```

`astrale update` works for official script installs. It downloads the selected
release channel, verifies the asset checksum, tests the new binary, and then
replaces the current binary. Alpha installs default to the `alpha` channel.
Use `--channel canary` to move channels or `--version 0.4.0-alpha.7` to install
an exact release.

## Command Reference

The authoritative command surface is generated from the code:

```bash
astrale --help
astrale <command> --help
astrale instance --help
```

Command groups:

| Group | What it covers |
|-------|----------------|
| Kernel | `ls`, `get`, `call`, `query`, `describe`, `token` |
| `update` | Check for and install CLI updates |
| `admin` | Configure the admin control-plane kernel |
| `instance` | Managed alpha instances and local bookmarks |
| `identity` | Local identities and delegation keypairs |
| `auth` | WorkOS/OIDC login, token status, logout |
| `idp` | OIDC provider configuration |

## Path Syntax

```
/domain                        Domain node
/domain/class.Name             Class node
/:domain:class.Name:method     Static method (semantic domain path)
<nodePath>::method             Instance method dispatch
@nodeId                        Reference a node by UID
```

The full grammar and examples are in `astrale --help`.

## Local Development

```bash
# From the workspace root
pnpm install

# Run directly with Bun
bun cli/bin/astrale.ts <command>

# Build a standalone binary
bun build --compile cli/bin/astrale.ts --outfile /tmp/astrale
```

Configuration lives under `~/.astrale/`: `config.json`, `instances.json`,
`identities.json`, keypairs, and cached IdP sessions.
