---
name: astrale-cli
description: Reference for the Astrale CLI (binary `astrale`, package `@astrale-os/astrale`) - CLI setup, command composition, graph exploration and querying, kernel calls, instance bookmarks and admin-provisioned instances, identity management, delegation tokens, browser sessions, output behavior, debugging, and local storage.
---

# Astrale CLI

`astrale` is the CLI for connecting to Astrale kernels. It authenticates,
selects an instance, calls kernel operations, inspects graph nodes, mints
delegation tokens, and prepares authenticated browser sessions for agents.

The command surface lives in the code. Use `astrale --help` and
`astrale <cmd> --help` as the source of truth for commands, flags, defaults,
and examples. This skill should only hold cross-cutting model details and
common recipes that help compose those commands correctly.

- Binary: `astrale`
- npm package: `@astrale-os/astrale`
- Runtime: Bun
- Framework: Commander.js
- Dev entrypoint: `bun cli/bin/astrale.ts <command>`

## Command Surface

Current top-level commands:

```bash
astrale whoami
astrale use <name>
astrale update
astrale call <path> [params...]
astrale token
astrale get <path>
astrale ls [path]
astrale describe <path>
astrale query <cypher>
astrale logs <service>
astrale status
astrale browser
astrale instance ...
astrale domain ...
astrale admin ...
astrale identity ...
astrale auth ...
astrale idp ...
```

Command groups:

| Group | Commands |
|---|---|
| Kernel | `call`, `token`, `get`, `ls`, `describe`, `query`, `logs` |
| Context | `status`, `whoami`, `use` |
| Management | `admin`, `instance`, `domain`, `identity`, `auth`, `idp`, `update` |
| Agent | `browser` |

Shared kernel options are merged onto kernel-touching commands at registration
time: `--format`, `--json`, `--raw`, `--url`, `-i/--instance`, `--timeout`,
`--as`, `--creds`, and `--debug`. Check `astrale <cmd> --help` before relying
on an option for a specific command.

## Path Syntax

Clients address graph entities and operations with Paths.

| Form | Grammar | Use when |
|---|---|---|
| Absolute path | `/domain`, `/domain/class.Name`, `/domain/interface.Name` | Domain, Class namespace, or Interface namespace |
| Static method | `/:domain:class.Name:method` or `/domain/class.Name/method` | Class-level or interface-level operation |
| Instance method | `<nodePath>::method` or `@id::method` | Operation on a node instance |
| Id reference | `@nodeId` | Reference a node by UID |
| Self reference | `@self` | CLI-side shorthand for the active caller node |

Load-bearing rules:

- Keep the `class.` or `interface.` prefix in namespace segments:
  `/:host.astrale.ai:class.KernelInstance:list`, not
  `/:host.astrale.ai:KernelInstance:list`.
- Static methods declared on an Interface are reached through the declaring
  interface namespace, not through a concrete Class namespace.
- Instance dispatch uses double colon `::`; single colon is for domain-path
  static method syntax.
- Prefer the domain-path form `/:domain:class.Name:method` for static calls
  when possible. It resolves by domain membership rather than tree layout.
- `@<id>` takes a graph node UUID only — `@<slug>` is NOT_FOUND. And a
  permission error naming a node that "should exist" often means the node
  does NOT exist (missing targets surface as permission denied, not
  NOT_FOUND) — verify with `astrale get <path>` before chasing grants.

Examples:

```bash
astrale call /:blog.acme.com:class.Author:list
astrale call /:blog.acme.com:interface.NoteOps:createNote title=Hello
astrale call /blog.acme.com/alice::deactivate
astrale call @f00d...::deactivate
```

### @self

`@self` is a CLI-side literal expanded before a call is signed and sent. It
resolves to the active identity's registered node id on the target instance.
The kernel receives the concrete `@<nodeId>` value.

Supported positions:

- Path head: `@self`, `@self::method`, `@self/child`
- Param value head: `key=@self`, `key=@self::method`

Not expanded:

- `--url`
- `--data`
- stdin JSON
- substrings such as `prefix@self`
- comma lists such as `@self,@other`

For JSON payloads, resolve manually before building the payload.

```bash
astrale describe @self
astrale call @self::deactivate
astrale call /:d:class.X:m owner=@self
```

If `@self` expands to a deleted or stale id, refresh the registration with
`astrale identity register <name> -i <instance>`.

For IdP-backed identities (`astrale auth login`), `@self` just works: on the
first use against an instance the CLI does ONE kernel `whoami` round-trip,
caches the node id as a registration, and expands locally afterwards. If that
lookup fails (offline, expired session), the error carries the manual recipe:

```bash
astrale call "/:kernel.astrale.ai:interface.Identity:whoami" --json  # → { id }
astrale describe @<that-id>
```

## Instances

`astrale instance` manages admin-provisioned instances and local bookmarks.

Use:

```bash
astrale instance create my-app
astrale instance status my-app
astrale instance use my-app
astrale instance active
astrale instance bookmark staging --url https://kernel.example.com
astrale instance forget staging
```

Important distinctions:

- `instance use` changes the active target instance.
- `instance active` shows the active target instance.
- `instance bookmark` records an existing remote kernel URL locally.
- `instance forget` removes a local bookmark only.
- `instance delete` is destructive for admin-managed instances.
- In scripts, prefer explicit `-i <instance>` over relying on ambient active
  instance state.

## Domain Dev Workflow

**The `astrale` CLI is connect-only — it does not build, run, or deploy
domains.** The `astrale domain` group manages the admin catalog and installs a
running domain onto an instance (`list`, `publish`, `install`); it does NOT
build or run domains. `astrale domain list` shows the published catalog (add
`--check` to probe each URL's reachability, `--default-only` for the
install-on-every-instance set, `-q` to pipe install URLs). Building, running,
and deploying live in two separate tools:

- **`create-astrale-domain`** scaffolds a new standalone domain project
  (`pnpm create astrale-domain <slug>`), writing an `astrale.config.ts`.
- **`astrale-domain`** (the `@astrale-os/sdk` bin, behind the project's
  `pnpm dev` / `pnpm prod` scripts) runs `dev | prod | deploy <env> | build`.

Domains are **installed by URL or catalog origin**, never from a file (there is
no committed `spec.json`). `astrale domain install` has two modes:

- **default (via admin)** — `astrale domain install <origin|url> -i <slug>`
  installs a PUBLISHED domain through the admin control plane
  (`DomainEntry.install`), addressed by its catalog `origin` (the unique
  registry key) or `url`. Run it bare to pick from the catalog interactively.
  The target instance is the active one or `-i <slug>` and **must be
  admin-managed** (otherwise it fails loudly and points you at `--direct`).
- **`--direct`** — `astrale domain install <url> --direct` installs a url
  straight onto the instance kernel (`Root.installDomain`), bypassing the
  catalog. Works on ANY instance you can authenticate to (managed, bookmarked,
  or local), using your own authority, and is the only mode that runs the
  identity-override consent gate. Use it for dev/local instances and
  freshly-deployed, not-yet-published workers.

With the **managed (`astrale`) adapter**, `pnpm prod` publishes the bundle
through the platform AND installs it on the configured instance in one step —
no manual `domain install`. The service serves at
`https://<name>-<hash>.svc.<region>.astrale.ai` (the CLI session is the auth).

For authoring domains end-to-end (schema, handlers, external APIs, deploys),
load the **astrale-domain** skill; for graph-level schema surgery on a live
kernel, **astrale-live-domain-edit**.

## Auth And Credentials

Keep the auth model simple:

- `astrale auth login` authenticates with an IdP and stores an IdP-backed local
  identity/session.
- `astrale identity create <name>` creates a local key-backed identity.
- `astrale identity register <name> -i <instance>` registers that identity with
  a target instance.
- `astrale use <name>` switches the active identity or active instance when the
  name is unambiguous. Use `--identity` or `--instance` when it is ambiguous.
- `--as <identity>` makes a kernel command call as that identity.
- `--creds <token>` sends an already minted credential and skips normal signing.

Useful checks:

```bash
astrale status
astrale whoami
astrale auth status
astrale identity list
astrale identity whoami
```

`astrale auth token --raw` prints a cached IdP provider token for shell use.
That is different from `astrale token`, which mints a delegation token for
kernel/worker calls.

### Session lifetime and refresh

IdP sessions refresh themselves: every kernel command silently exchanges the
refresh token when the cached access token is stale, and concurrent `astrale`
processes serialize that exchange on a per-identity file lock (refresh tokens
are single-use — the lock is what makes parallel agent-driven commands safe).
One `astrale auth login` should therefore last until the IdP itself ends the
session. Access tokens are also cached **per audience**, so alternating
commands between instances does not burn a refresh per flip.

Refresh failures come in two distinct flavors — read the error before
re-authenticating:

- "could not be refreshed … run: astrale auth login" — the grant is dead
  (IdP session ended, idle/absolute timeout, logout elsewhere). Re-login is
  the only fix.
- "Could not reach the IdP … retry the command" — transient network/IdP
  outage. The cached session is still valid; do NOT re-login, just retry.

### Agent auth

An agent driving the CLI needs no special flow: it shares `~/.astrale`, so one
human `astrale auth login` is enough and every subsequent command (including
parallel ones) self-refreshes. For fully headless setups with no human login,
use a key-backed identity — `astrale identity create <name>` then
`astrale identity register <name> -i <instance>` — which signs locally and
never expires; or hand the agent a TTL-bound delegation token minted with
`astrale token` and passed via `--creds`.

## Delegation Tokens

`astrale token` mints a delegation token for the active instance and identity.
Use it when another process, script, or worker needs to call with delegated
authority.

Common flow:

```bash
export TOKEN=$(astrale token --audience dist.astrale.ai --raw)
astrale call /:dist.astrale.ai:class.Domain:install \
  --url https://dist.astrale.ai \
  --creds "$TOKEN" \
  -d '{"name":"alice"}'
```

Notes:

- Default TTL is 3600 seconds.
- `--audience <aud>` should match the receiving service or worker expectation.
- `--for <identity>` is an alias for `--as <identity>`.
- Use `--raw` when assigning the token to an environment variable.
- Use `--json` when a machine should parse token metadata.

## Graph Exploration

Use these commands for graph inspection:

```bash
astrale ls /
astrale get /some/path
astrale describe /some/path
astrale query 'MATCH (n) RETURN n LIMIT 5'
astrale call <path> --describe
```

Admin host records are exposed by the concrete provider class, not by the
provider-neutral `Host` interface:

```bash
astrale call /:admin.astrale.ai:class.ScalewayVPS:list -i admin --json
astrale call /:admin.astrale.ai:class.ScalewayVPS:list --describe -i admin
```

Gotchas:

- `query` is read-only; the kernel rejects write keywords such as `CREATE`,
  `DELETE`, `SET`, `MERGE`, `REMOVE`, and `DETACH`.
- `describe` can return large properties such as serialized schemas. Pipe to
  `jq` or use command-specific flags when available.
- `ls` has list-specific output controls such as `-q/--quiet`, `--count`, and
  `-l/--long`; check `astrale ls --help`.
- For operation schemas, prefer `astrale call <path> --describe` before
  executing a call you are unsure about.
- **`class.<Name>` materializes as a `Folder` node** (kind `Folder`, name
  prefixed `class.`) whose children are the class's callable Functions. There
  is no `Class` node at that tree position — the Class definition lives inside
  the Domain's serialized `schema` prop. So `--filter Class` returns zero; use
  `--filter Folder`, or descend into `class.<X>` and filter on `Function`.

## Output / TTY Behavior

Output is selected from stdout shape and flags:

- TTY default: human-readable output, usually YAML for objects and tables for
  lists.
- Pipe, redirect, `--json`, or `--raw`: machine-oriented output.
- `--json`: always valid JSON for tools like `jq`.
- `--raw`: unwrap scalars for shell assignment and write raw bytes for binary
  responses.
- `--format yaml|json`: explicit structured output where supported.
- `call --output <file>` writes binary/raw output to a file.
- Piped stdin is read by `astrale call`; stdin on a TTY is ignored.
- `--data` takes precedence over stdin and `key=value` params.
- `key=value` values are auto-coerced: `true`/`false`/`null`, numeric strings
  → numbers, `{…}`/`[…]` → parsed JSON; everything else stays a string. To
  force a digits-only STRING (or pass nested values), use `--data`.
- **Big payloads go through stdin** — argv caps around 128 KB, so multi-MB
  JSON (e.g. a base64 bundle) must be piped:
  `echo "$PAYLOAD_JSON" | astrale call <path> --json`.

Examples:

```bash
astrale ls / --json | jq .
TOKEN=$(astrale token --audience dist.astrale.ai --raw)
astrale call /:d:class.Asset:render id=123 --output asset.png
astrale call /:d:class.X:m -d '{"name":"alice"}'
```

## Driving The GUI

Use `astrale browser` to prepare an authenticated GUI browser session that an
agent can drive with `agent-browser`.

Install once:

```bash
npm install -g agent-browser && agent-browser install
npx skills add vercel-labs/agent-browser
```

Connect and verify:

```bash
astrale browser
astrale browser --check
astrale browser --login
astrale browser --cdp 9222
```

After `astrale browser` connects, it prints the exact `agent-browser --profile`
command to use. Driving the page is agent-browser's job:

```bash
agent-browser --profile <dir> snapshot
agent-browser --profile <dir> open <url>
agent-browser --profile <dir> click @e3
agent-browser --profile <dir> eval '<js>'
```

The GUI session uses an httpOnly cookie. There is no token-injection shortcut;
the persistent browser profile is the session boundary.

## Debugging And Common Errors

Start with local context:

```bash
astrale status
astrale admin status
astrale instance active
astrale auth status
astrale whoami
```

Use diagnostics:

- Add `--debug` to kernel commands for full error diagnostics — including
  the server-side cause chain (`data.cause`), which shows the ROOT failure
  inside wrapped errors (e.g. what actually failed under a
  `Delegation mint failed` or `KERNEL_ERROR`).
- Use global `--log-level debug` for verbose CLI logging.
- Use global `--log-format json` when an agent or script should parse logs.
- Use `--json` or `--raw` for structured command output.
- Use `--ci` and `--no-prompt` in non-interactive automation.
- Use `--timeout <ms>` when a kernel call is valid but slow.
- Use `astrale logs <service-slug> [--tail N]` to tail a MANAGED SERVICE's
  runtime logs — console output, 5xx accesses, and uncaught exception stacks
  (the readable side of `internal error; reference = …` responses). The slug
  is the first label of the service's `…svc.<region>.astrale.ai` URL (also
  accepts the full URL). In-memory, last ~500 lines, resets on runtime
  restart; services deployed before log capture need one redeploy.

Common error classes and first checks:

| Error shape | First check |
|---|---|
| Connection error | `astrale status`; verify the instance URL and network path |
| Authentication error | `astrale auth status`, `astrale whoami`, active identity |
| Permission denied | Does the named node actually exist (`astrale get`)? Then active identity and target operation permissions |
| Not found | Path spelling, active instance, installed domain |
| Validation error | `astrale call <path> --describe` |
| Timeout | Target availability and `--timeout <ms>` |

If a command fails only in a script, compare TTY vs non-TTY behavior and pass
explicit `--json`, `--raw`, `-i <instance>`, and `--as <identity>` as needed.

## Storage

CLI state lives under `ASTRALE_HOME` when set, otherwise `~/.astrale`.

Core paths:

```text
~/.astrale/
  config.json            CLI and admin config
  install.json           Script-install metadata for `astrale update`
  instances.json         Active instance and local instance records
  identities.json        Active identity and identity metadata
  idps/                  IdP provider metadata
  idp-sessions/          Cached IdP sessions
  keys/                  Local identity keypairs
  data/                  Local data directory used by local adapters
  browser.json           Last connected GUI browser session
  browser/<host>/        Persistent browser profile for GUI auth
```

Optional overrides:

- `ASTRALE_HOME`: root for CLI state.
- `ASTRALE_KEYS_DIR`: keypair directory.
- `ASTRALE_DATA_DIR`: data directory.

Keep storage references centralized in this section. Other sections should
describe behavior, not repeat file locations.

## Source Map

- Entry: `cli/bin/astrale.ts`
- Program and help wiring: `cli/src/program.ts`
- Command registration helpers: `cli/src/registry.ts`, `cli/src/command.ts`
- Commands: `cli/src/commands/`
- Shared output, auth, browser, paths, and local helpers: `cli/src/lib/`
- Kernel command plumbing and error formatting: `cli/src/kernel/`
- Tests for help and command behavior: `cli/src/commands/__tests__/`
