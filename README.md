# Astrale CLI

Manage your local Astrale OS installation, explore the kernel graph, and call operations.

## Installation

### From GitHub Package Registry

Add to your `~/.npmrc`:

```
@astrale-os:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then install:

```bash
npm install -g @astrale-os/cli
```

### Local Development

```bash
# From the workspace root
pnpm install

# Run directly with Bun
bun cli/bin/astrale.ts <command>

# Or add an alias
alias astrale="bun /path/to/cli/bin/astrale.ts"
```

## Quickstart

```bash
# 1. Set up keys, config, and FalkorDB
astrale init

# 2. Start the manager
astrale start

# 3. Check everything is running
astrale status

# 4. Explore the graph
astrale ls /
astrale describe /kernel.astrale.ai
astrale call /manager.astrale.ai/KernelInstance/list
```

## Commands

### Lifecycle

| Command | Description |
|---------|-------------|
| `astrale init` | Set up a new Astrale installation (keys, config, Docker, FalkorDB) |
| `astrale start` | Start the manager (background by default, `--foreground` for dev) |
| `astrale stop` | Stop the manager |
| `astrale restart` | Restart the manager |
| `astrale status` | Show system status (manager, FalkorDB, UI) |
| `astrale reset` | Clear and reboot a kernel instance (wipes graph data) |

### Graph Exploration

| Command | Description |
|---------|-------------|
| `astrale ls <path>` | List children of a node |
| `astrale get <path>` | Get a node by path or ID |
| `astrale call <path> [params...]` | Call a kernel operation |
| `astrale describe <path>` | Describe a node: kind, operations, children, schemas |
| `astrale query <cypher>` | Run a read-only Cypher query |
| `astrale logs` | View kernel event journal |

### Instance Management

| Command | Description |
|---------|-------------|
| `astrale use <name>` | Set the active kernel instance |
| `astrale instance list` | List all registered instances |
| `astrale instance add <name>` | Register a kernel instance (`--url` for remote) |
| `astrale instance remove <name>` | Remove an instance (`--force` to skip cleanup) |
| `astrale instance active` | Show the currently active instance |

### Identity Management

| Command | Description |
|---------|-------------|
| `astrale identity create <name>` | Create a new identity (`--subject` for custom sub) |
| `astrale identity list` | List all identities |
| `astrale identity use <name>` | Set the default identity |
| `astrale identity whoami` | Show the current default identity |
| `astrale identity delete <name>` | Delete an identity |

## Path Syntax

Astrale paths follow the pattern `/domain/Class/method`:

```
/kernel.astrale.ai              Domain node
/kernel.astrale.ai/Root         Class node
/manager.astrale.ai/KernelInstance/list   Syscall (operation) node
```

Two call syntaxes:
- **Slash** (`/domain/Class/method`) — navigates to the Syscall node (static operations)
- **Colon** (`/domain/Class:method`) — calls a method on an instance (instance methods)
- **ID** (`@nodeId`) — reference a node by its ID

## Common Options

Graph commands (`ls`, `get`, `call`, `query`, `describe`) share these options:

| Flag | Description |
|------|-------------|
| `--format yaml\|json` | Output format (default: YAML on TTY, JSON when piped) |
| `--raw` / `--json` | Raw JSON output, no colors |
| `-i, --instance <name>` | Target a specific instance |
| `--timeout <ms>` | Request timeout (default: 30000) |
| `--as <identity>` | Call as a specific identity |
| `--debug` | Print full error diagnostics on failure |

### `ls` extras

| Flag | Description |
|------|-------------|
| `-l, --long` | Full node dump |
| `-q, --quiet` | One path per line (unix-pipeable) |
| `-R, --recursive` | Tree view (recursive) |

### `call` extras

| Flag | Description |
|------|-------------|
| `-d, --data <json>` | Params as JSON string |
| `--describe` | Show operation schema without executing |

### `logs` extras

| Flag | Description |
|------|-------------|
| `-t, --tail` | Live stream new events |
| `-n <count>` | Number of entries (default: 20) |
| `--topic <pattern>` | Filter by topic glob (`*` = one segment, `**` = rest) |
| `--since <time>` | Events since duration (5m, 1h) or ISO timestamp |
| `-c, --compact` | Tab-separated summary for piping |
| `--timing` | Show per-step timing breakdown |

## Examples

```bash
# List root domains
astrale ls /

# Describe what operations a class supports
astrale describe /manager.astrale.ai/KernelInstance

# Call an operation with params
astrale call /manager.astrale.ai/KernelInstance/register id=my-inst graphName=my-graph

# Check what an operation expects before calling
astrale call /manager.astrale.ai/KernelInstance/register --describe

# Browse the graph recursively
astrale ls / -R

# Pipe paths into another command
astrale ls / -q | xargs -I {} astrale get {}

# View recent failed operations
astrale logs --topic 'op:*:failed' -n 10

# Live tail events
astrale logs --tail

# Run a Cypher query
astrale query 'MATCH (n:Domain) RETURN n.slug, n.id'

# Use a specific identity
astrale call /kernel.astrale.ai/Root/query --as admin cypher='MATCH (n) RETURN count(n)'
```

## Configuration

### Global Config

Located at `~/.astrale/`:

| File | Purpose |
|------|---------|
| `config.json` | Ports, graph name, issuer URL |
| `keys/` | ES256 keypair for JWT signing |
| `identities.json` | Identity registry |
| `instances.json` | Instance registry |
| `logs/` | Event journals |

### Config Schema

```json
{
  "managerPort": 4400,
  "falkorPort": 6379,
  "uiPort": 4300,
  "graphName": "astrale-manager",
  "issuer": "http://localhost:4400/mngt"
}
```
