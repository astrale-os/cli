# Astrale CLI

`astrale` — the system CLI for Astrale OS. Drive a local **manager** kernel
(Docker + FalkorDB), manage **instances** and **identities**, explore the kernel
graph, and call operations.

- Binary: `astrale`
- Package: `@astrale-os/astrale`

## Installation

The `@astrale-os/*` packages are published to GitHub Packages. Add to your
`~/.npmrc`:

```
@astrale-os:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then install globally:

```bash
npm install -g @astrale-os/astrale
```

### Local development

```bash
# From the workspace root
pnpm install

# Run directly with Bun
bun cli/bin/astrale.ts <command>

# Or alias it
alias astrale="bun /path/to/cli/bin/astrale.ts"
```

## Quickstart

```bash
# 1. Set up keys, config, Docker, FalkorDB
astrale init

# 2. Start the manager
astrale start

# 3. Check everything is running
astrale status

# 4. Explore the graph
astrale ls /
astrale describe /kernel.astrale.ai
astrale call /manager.astrale.ai/class.KernelInstance/list

# 5. Boot a local child instance and target it
astrale instance create my-app --local
astrale instance use my-app
```

## Command reference

The authoritative, always-current command surface is the built-in help —
it is generated from the code, so it never drifts:

```bash
astrale --help                 # all commands + path syntax + examples
astrale <command> --help       # flags and arguments for one command
astrale instance --help        # a command group
```

Command groups at a glance (run `--help` on any of them for details):

| Group | What it covers |
|-------|----------------|
| Lifecycle | `init`, `start`, `stop`, `restart`, `status`, `reset` |
| Graph | `ls`, `get`, `call`, `query`, `describe`, `logs`, `token` |
| `instance` | Local children + remote bookmarks (create, bookmark, use, …) |
| `identity` | CLI identities & delegation keypairs |
| `auth` | Astrale cloud authentication (stubbed in v1) |
| `tunnel` | Machine-level cloudflared tunnels |
| `graph` | FalkorDB graph maintenance |
| `server` | Manager Docker image + container logs |
| `domain` | Domain lifecycle (`init`, `build`, `deploy`, `dev`, …) |

### Path syntax (summary)

```
/domain                        Domain node
/domain/class.Name             Class node
/domain/class.Name/method      Static (class-level) Method  — single slash
/domain/class.Name::method     Instance method dispatch     — double colon `::`
@nodeId                        Reference a node by its ID
```

The block above is a **summary subset**; the full, authoritative path grammar
is `astrale --help`. The `class.` / `interface.` prefix on the namespace
segment is **required**. Instance-method dispatch uses **`::`** (double
colon), never a single `:`.
For the full conceptual model — instance resolution, token audience, the auth
model — see the `astrale-cli` agent skill; for invariants and design rationale
see [`DESIGN.md`](./DESIGN.md).

## Configuration

Everything lives under `~/.astrale/`:

| File / dir | Purpose |
|------------|---------|
| `config.json` | Ports, graph name, issuer URL |
| `identities.json` | Identity registry |
| `instances.json` | Instance registry (`active` + registered instances) |
| `keys/` | Per-identity ES256 keypairs |
| `logs/` | Event journals (`events.ndjson`, per-instance subdirs) |
| `data/` | FalkorDB volume |
| `tunnels.json` | Registered cloudflared tunnels |
| `docker-compose.yml` | FalkorDB + manager service defs |
| `manager.pid` | Host-mode manager daemon PID |

`config.json` schema:

```json
{
  "managerPort": 4400,
  "falkorPort": 6379,
  "graphName": "astrale-manager",
  "issuer": "http://localhost:4400/mngt"
}
```
