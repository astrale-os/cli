# @astrale-os/astrale

System CLI for managing a local Astrale installation. Handles FalkorDB, keypair persistence, daemon, and the playground UI.

## Install

```bash
curl -fsSL https://install.astrale.ai | bash
```

This installs Bun (if missing), installs the CLI globally, and runs `astrale init`.

## Commands

```bash
astrale init                # Interactive setup: keys, FalkorDB, daemon, UI
astrale start               # Start the manager + UI (via launchd/systemd)
astrale start --foreground  # Start everything in the current terminal
astrale stop                # Stop the manager daemon
astrale status              # Show manager, FalkorDB, and UI status
astrale call <method> [...] # Call a kernel operation
astrale query <cypher>      # Run a read-only Cypher query
astrale logs [options]      # View kernel event journal
astrale identity <cmd>      # Manage CLI identities
astrale target <cmd>        # Manage kernel connection targets
```

### `astrale call`

Call any kernel operation by its full graph path.

```bash
# List kernel instances
astrale call /manager.astrale.ai/KernelInstance/list

# Register + boot a kernel
astrale call /manager.astrale.ai/KernelInstance/register id=dev graphName=dev-graph
astrale call /manager.astrale.ai/KernelInstance/boot id=dev

# Pass params as JSON
astrale call /manager.astrale.ai/KernelInstance/register -d '{"id":"dev","graphName":"dev-graph"}'

# Pipe from file
cat params.json | astrale call /manager.astrale.ai/KernelInstance/register

# Raw JSON output (for scripting)
astrale call /manager.astrale.ai/KernelInstance/list --raw | jq '.[].id'

# Call as a specific identity
astrale call /manager.astrale.ai/KernelInstance/list --as alice
```

**Options:**

| Flag | Description |
|------|-------------|
| `-d, --data <json>` | Params as JSON string |
| `--raw` / `--json` | Plain JSON output (no colors) |
| `-r, --remote <name-or-url>` | Named target or full WS URL |
| `-i, --instance <id>` | Target a local kernel instance |
| `--timeout <ms>` | Request timeout (default: 30000) |
| `--as <identity>` | Call as a specific identity |

### `astrale query`

Run a read-only Cypher query against the kernel graph. Shortcut for `astrale call /kernel.astrale.ai/Root/query`.

```bash
# Count all nodes
astrale query "MATCH (n) RETURN count(n) AS total"

# List operations
astrale query "MATCH (n:Operation) RETURN n.name LIMIT 10"

# Node distribution by label
astrale query "MATCH (n) RETURN labels(n) AS label, count(n) AS c ORDER BY c DESC"

# Raw output for scripting
astrale query "MATCH (n:Operation) RETURN n.name" --raw | jq '.[].name'
```

Write queries (`CREATE`, `DELETE`, `SET`, `MERGE`) are rejected.

### `astrale logs`

View the kernel event journal. All operation and system events are persisted to `~/.astrale/logs/events.ndjson`.

```bash
astrale logs                              # Tail last 20 events
astrale logs -n 50                        # Last 50
astrale logs -f                           # Live stream (follow)
astrale logs --topic "op:*:failed"        # Filter by topic glob
astrale logs --topic "op:*:completed"     # All completions
astrale logs --since 5m                   # Last 5 minutes
astrale logs --principal alice            # Filter by identity
astrale logs --trace <operationId>        # All events in a trace
astrale logs --raw | jq                   # Pipe-friendly NDJSON
```

### `astrale identity`

Manage CLI identities. The kernel resolves identity by `(issuer, subject)` — different identities use different JWT subjects signed with the same keypair.

```bash
astrale identity list                        # List all identities (* = default)
astrale identity whoami                      # Show current default
astrale identity create alice                # Create identity (subject = name)
astrale identity create admin --subject sys  # Custom subject
astrale identity use alice                   # Set default identity
astrale identity delete bob                  # Delete identity (not the default)
```

### `astrale target`

Manage kernel connection targets. By default, the CLI connects to the local manager (`/mngt/ws`). Targets let you save named connections to remote kernels or local instances.

```bash
astrale target list                                          # List all (* = default)
astrale target whoami                                        # Show current default
astrale target create staging --url ws://staging:4400/mngt/ws  # Named remote
astrale target create dev --instance dev-kernel               # Named local instance
astrale target use staging                                   # Set default target
astrale target delete staging                                # Delete target
```

Use `-r` or `-i` on `call`/`query` to target a specific kernel:

```bash
# Named target
astrale call /some.domain/Op/list -r staging

# Full URL override
astrale call /some.domain/Op/list -r ws://custom:4400/mngt/ws

# Local instance by ID
astrale call /some.domain/Op/list -i dev-kernel
astrale query "MATCH (n) RETURN count(n)" -i dev-kernel
```

## What `init` does

1. Checks Docker + Bun are available
2. Prompts for ports and graph name (sensible defaults)
3. Generates an ES256 keypair at `~/.astrale/keys/` (persisted across restarts)
4. Writes a `docker-compose.yml` and starts FalkorDB
5. Installs a launchd (macOS) or systemd (Linux) daemon
6. Starts the manager kernel + playground UI

## Ports

| Service    | Default | Config key    |
|------------|---------|---------------|
| UI         | 4300    | `uiPort`      |
| Manager WS | 4400    | `managerPort` |
| FalkorDB   | 6379    | `falkorPort`  |

## Layout

```
~/.astrale/
  config.json           # ports, graph name, issuer
  keys/
    manager.private.jwk  # ES256 private key
    manager.public.jwk   # ES256 public key
  data/                  # FalkorDB volume
  logs/                  # Daemon stdout/stderr
  identities.json        # CLI identities (name → subject)
  targets.json           # Connection targets (name → url/instance)
  docker-compose.yml     # FalkorDB service
  kernels.json           # Persisted child kernel metadata
```

## Dev

```bash
# From workspace root
pnpm install
pnpm --filter @astrale-os/astrale typecheck

# Run locally without global install
bun cli/cli-v3/bin/astrale.ts init
```
