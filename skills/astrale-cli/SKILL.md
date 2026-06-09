---
name: astrale-cli
description: Reference for the Astrale CLI (binary `astrale`, package `@astrale-os/astrale`) — CLI setup, kernel lifecycle, graph exploration and querying, calling kernel operations, instance management (local children + remote bookmarks), identity management, delegation tokens, tunnels, and FalkorDB graph maintenance. Use when the user asks about running the CLI, composing `astrale` invocations, authoring/reading paths, debugging the graph, managing local or remote kernel instances, or setting up an Astrale installation.
---

# Astrale CLI

`astrale` is the system CLI for Astrale OS. It drives a local **manager** kernel
(Docker + FalkorDB) and any **child instances** or **bookmarked remote
instances** registered against it.

> **The command surface lives in the code, not here.** `astrale --help` and
> `astrale <cmd> --help` are generated from `cli/bin/astrale.ts` +
> `cli/src/commands/`, so they never drift — that is the source of truth for
> commands, flags, defaults, and per-command behavior (each command's `--help`
> carries a `Behavior:` + `Examples:` block). This skill holds only the
> **cross-cutting model** the help text cannot express: how things resolve,
> what gets signed, the gotchas, and the recipes.

- Binary: `astrale` · npm package: `@astrale-os/astrale` (repo is `astrale-os/cli` — package name ≠ repo name)
- Runtime: Bun · framework: Commander.js · dev: `bun cli/bin/astrale.ts <command>`

## Path syntax

> The table below **mirrors `astrale --help`** (the authoritative grammar). It
> documents the *model*; `astrale --help` stays the source of truth for syntax.

Clients address entities in the kernel graph via **Path**s.

| Form | Grammar | Use when |
|------|---------|---------|
| Absolute path | `/domain` or `/domain/class.Name` or `/domain/interface.Name` | A Domain, a Class node, or an Interface node |
| Static method | `/:domain:class.Name:method` *(preferred)* — or `/domain/class.Name/method` | A class- or interface-level (static) operation; the `/:` **domain path** is the more stable form (see note) |
| Instance method | `<nodePath>::method` (incl. `@id::method`) | A method on a node instance |
| Id reference | `@nodeId` | Reference a node by UID |
| Self reference | `@self` | CLI-side shorthand — expands to your nodeId on the active instance (see below) |

Load-bearing rules — true everywhere:

- The **`class.` / `interface.` prefix is required** on the namespace segment:
  `/:host.astrale.ai:class.KernelInstance:list`, never `…:KernelInstance:list`.
- A static method declared on an Interface is **not** reachable via
  `class.<ConcreteClass>:<method>` — the kernel looks it up by the declaring
  namespace. Use `interface.<Name>` for interface-hosted statics.
- Instance dispatch uses **double colon `::`**, never single `:`. `::get` and
  `::listChildren` are the universal node methods (`get`/`ls`/`describe`
  dispatch to them).

**Prefer the domain path (`/:…:…:…`) for method calls when you can.** It is a
*MethodPath* — it resolves the operation *semantically* (`installed_in →
of_domain → method_of`), following what the member **is** in its Domain, so it
stays valid even if the domain is re-mounted or its tree layout changes. The
slash form (`/domain/class.Name/method`, an *AbsolutePath*) walks `has_parent`
slugs by tree position and breaks when that layout moves. Both reach the same
node, and both still carry the domain-origin token (which varies per env in
either form) — the domain path is simply the more stable link. Instance methods
already dispatch via `::` and have no slash-only variant. This holds for both
kernel dispatch and remote domain workers reached via `--url` — both resolve the
domain path semantically.

Three concrete forms (origin `blog.acme.com`, installed at Root):

```bash
astrale call /:blog.acme.com:class.Author:list                # static on a Class (domain path, preferred)
astrale call /:blog.acme.com:interface.NoteOps:createNote …   # static on an Interface (domain path)
astrale call /blog.acme.com/alice::deactivate                 # instance method (or @id::deactivate)
```

### `@self` — self-reference shorthand

`@self` is a **CLI-side literal** (expanded before any envelope is signed or
sent) that resolves to the calling identity's nodeId on the resolved active
instance. The kernel and remote workers never see `@self` — they receive the
concrete `@<nodeId>` form.

The expansion is the JWT `sub` claim that the invocation would ship — which,
by construction (`registerIdentity` writes `sub = String(self.id)`), is the
caller's kernel nodeId on the target instance.

```bash
astrale call @self::deployFunction port=8080 kind=function name=test
astrale describe @self
astrale ls @self/functions
astrale call /:d:class.X:m _self=@self        # in a param value too
```

**Two positions only** are expanded: a path-head token (`@self::…`, `@self/…`,
or `@self` alone) and the head of a `key=value` value (`key=@self::…`,
`key=@self`). Substrings (`prefix@self`, `@selfsuffix`), comma-lists
(`@self,@other`), and JSON payloads passed via `--data` / stdin are sent
verbatim — pre-resolve there with `@$(astrale whoami --raw | jq -r .subject)`.

**Refusal modes** — six fail-loud errors, each pointing at a fix:

| Refusal | Trigger | Fix |
|---|---|---|
| `manager` | Default identity is the bootstrap `manager` (no graph node) | `astrale identity create <name>` then `astrale identity register <name>` |
| `no-registration` | Identity has no registration on the resolved instance | `astrale identity register <name> -i <slug>` |
| `instance-signed` | Signing as the instance itself (per-instance keypair) | Use `--as <name>` or a literal `@<nodeId>` |
| `url-no-slug` | `--url` without `-i` — no slug to look up | Add `-i <slug>` or use a bookmark |
| `creds-no-sub` | `--creds <jwt>` whose `sub` claim is missing | Pass a literal `@<nodeId>` |
| `idp-no-sub` | IdP-backed identity has no cached JWT with a usable `sub` | Re-run `astrale auth login --name <name>` or pass a literal `@<nodeId>` |

If `@self` expanded to a stale id (e.g. the underlying node was deleted and
recreated), the resulting `NotFoundError` carries a hint pointing at
`astrale identity register` to refresh the registration.

`@self` is not available in `--url`, `--data`, or stdin (transport URL or
verbatim JSON, respectively) and there is no `@@self` escape — if you own a
node literally named `self`, reference it via its full id from `ls -q`.

**Sandbox carve-out.** Inside a Blaxel agent sandbox the canonical form is
`@"$ASTRALE_COMPUTER_NODE_ID"` instead — the sandbox prompt opts out of
`@self` for predictability (the env var is always set at boot and avoids the
registration-lookup path). The CLI shorthand remains valid host-side and in
any context where a host identity is registered.

## Instance resolution

Every kernel command picks its target in this order:

**explicit `--url` > `-i/--instance <name>` > active instance
(`~/.astrale/instances.json`) > local manager.**

- Manager URL: `http://localhost:<managerPort>/host` (default port `4400`).
- Child instances are addressed by **direct path-prefix**:
  `http://localhost:<managerPort>/<slug>`. The child authenticates the caller
  itself, so the real principal is preserved in its audit log.
- Remote bookmarks are called directly at their stored `--url`.

The active instance is a process-global file. In parallel/scripted flows pass
`-i <instance>` on every command rather than relying on `astrale instance use`
(see Gotchas).

### Audience (token `aud` claim)

The CLI signs a fresh JWT per call. The audience is **the target kernel's
issuer, not the transport URL**:

| Target | `aud` stamped |
|---|---|
| Manager (`/host`) | `config.issuer` (= `http://localhost:<port>/host`) |
| `-i <child>` with stored `issuer` | that issuer (often a tunneled URL) |
| `-i <child>` not in registry | resolved via `KernelInstance/info`, cached back |
| `--url <arbitrary>` | the URL itself (pass `--creds` to override) |

### Instance kinds

| Kind | Meaning |
|------|---------|
| `manager` | The local manager itself |
| `local-child` | A child kernel behind the local manager |
| `bookmark` | A reference to a remote kernel (no local process) |
| `managed-cloud` | Astrale-cloud-managed (v1: not wired; stubbed) |

`astrale instance create` is the **managed-cloud** path — it calls
`Instance.alphaCreate` on the configured admin kernel (requires WorkOS login
via `astrale auth login`). There is no `--local` mode in this CLI; for a
local-child kernel use the raw `KernelInstance/{register,boot}` calls against
the manager domain (or the `demo-instance` skill for multi-domain setup).
See `astrale instance --help`.

## Auth model

- Identity = `(issuer, subject)`. Key-backed identities hold ES256 keypairs
  under `~/.astrale/keys/`; IdP-backed identities hold non-secret identity
  metadata in `identities.json` and token cache entries under
  `~/.astrale/idp-sessions/`.
- The manager (and each child) publishes its JWKS at
  `<issuer>/.well-known/jwks.json`.
- `--as <name>` signs a fresh JWT (`iss`, `sub`, `aud`) per call; `--creds <jwt>`
  passes a token you already minted (skips `--as` signing).
- If `--as <name>` names an IdP-backed identity, or the default identity is
  IdP-backed, kernel commands pass the cached OAuth/OIDC access token instead
  of signing a local JWT. Expired sessions are refreshed when a refresh token
  is cached.
- Whether an unknown `(issuer, subject)` is auto-created depends on the target
  kernel's provisioning policy. The manager defaults to allow-all; a child may
  be stricter.

See `astrale identity --help` for identity/keypair management.

### OIDC / IdP workflow

`astrale idp` manages OpenID Connect providers. The CLI stores discovery
metadata in `~/.astrale/idps/<name>/metadata.json` and non-secret client
metadata in `client.json`. Client secrets and WorkOS API keys are never stored;
store only env var names with `--client-secret-env` / `--workos-api-key-env`.

```bash
# If WORKOS_CLIENT_ID or VITE_WORKOS_CLIENT_ID is set, this works immediately:
astrale auth login --idp workos --device

# Or persist the WorkOS profile explicitly:
astrale idp add workos --workos-authkit --client-id client_...

astrale idp add workos-connect --issuer https://example.authkit.app \
  --client-id client_... --scope "openid profile email offline_access"
astrale idp add workos-connect --issuer https://example.authkit.app \
  --workos-app app_... --workos-api-key-env WORKOS_API_KEY
astrale idp list
astrale idp show workos
astrale idp refresh workos
```

`astrale auth login` turns an IdP token into a local IdP-backed identity:

```bash
astrale auth login --idp workos --client-credentials \
  --client-secret-env WORKOS_CLIENT_SECRET --audience https://api.example.com
astrale auth status
astrale call /:some.domain:class.Thing:list --as <idp-identity>
```

WorkOS AuthKit CLI Auth uses `--workos-authkit` and needs only the public
`client_id`. The `workos` IdP is built in when `WORKOS_CLIENT_ID` or
`VITE_WORKOS_CLIENT_ID` is set; login or refresh persists it as a built-in IdP.
The WorkOS API key is only needed for management API operations such as
`--workos-app`. Authorization-code login is supported with `--code` +
`--redirect-uri`; there is no automatic browser callback listener yet. `auth
logout` clears local cached tokens only.

## Delegation tokens

`astrale token` mints a delegation credential against the active instance +
identity (flags: `astrale token --help`). The result is a **two-layer
envelope**: an outer JWT signed by the kernel's system key (`sub: __system__`)
wrapping an inner ES256-signed delegation credential for the requested
identity. Remote domain workers receive it via `--creds` and verify it against
the issuer's JWKS. The token's `aud` must match the worker's expected audience
or the worker rejects it.

End-to-end — mint and call a remote worker:

```bash
export TOKEN=$(astrale token --audience dist.astrale.ai --raw)
astrale call /:dist.astrale.ai:class.BlaxelComputer:init name=test … \
  --url https://dist.astrale.ai --creds "$TOKEN"
```

`astrale token` is a convenience wrapper over the universal syscall:

```bash
astrale call @__system__::mintDelegationCredential \
  audience=<aud> delegation='{"kind":"identity","self":true}' ttl=3600 -i <instance> --raw
```

- `delegation={"kind":"identity","self":true}` = self-delegation (no subject
  expansion).
- `_self=<ref>` on a static path is equivalent to instance dispatch:
  `/:<domain>:class.X:<method> _self=<ref>` ≡ `@<nodeId>::<method>`. Accepted
  `<ref>`: bare `<uuid>`, `@<uuid>`, or `/tree/path`. **Remote workers only
  accept the `class.X + _self=` form** — bare `@<uuid>::method` doesn't resolve
  the syscall on a worker.

## Instance lifecycle gotchas

- **No `uninstall` verb.** `instance install` does not replace existing
  `Function.binding`s on re-install; the only way to remove an installed spec
  is `astrale reset` (**destructive and broad**: stops the containers *and*
  wipes every CLI-owned path under `~/.astrale/` — not just the graph; see
  `cli/src/commands/reset.ts:280`). When iterating on schema in dev,
  `astrale reset` between installs.
- **`instances.json:active` is a process-global shared file.** Concurrent
  commands or parallel test runs can rewrite it under you. In
  scripted/parallel flows pass `-i <instance>` on every command.
- **`forget` vs `delete`**: `instance forget` drops a bookmark reference only
  (never destructive); `instance delete` is destructive (kernel-side + local
  registry). Each refuses the wrong target with an actionable hint.
- **managed-cloud** create/auth is stubbed in v1.

For a **local-child kernel** there is no convenience wrapper — the CLI is
connect-only (`astrale instance create` is managed-cloud only since commit
`043bb17 refactor: make cli connect-only`). Hand-roll the raw host
lifecycle: `astrale call /manager.astrale.ai/class.KernelInstance/register`
+ `boot` + `astrale instance install <worker-url> -i <slug>` to install
domains. For multi-domain demo setups, prefer the `demo-instance` skill
which orchestrates the full flow. (ref:
`cli/src/commands/instance/create.ts` — pure `Instance.alphaCreate` path.)

## Manager lifecycle (docker-mode vs host-mode)

`astrale start` runs **docker-mode by default**: manager + FalkorDB as services
in `~/.astrale/docker-compose.yml`. `--host-mode` runs the manager as a bun
process on the host (PID file); `--foreground` applies to **host-mode only**.
`astrale stop` targets both modes by default. `astrale server build|logs`
manage the manager Docker image / container logs. Flags & exact behavior:
`astrale start|stop|restart|reset|server --help`.

**UI**: the supported UI is the **GUI**, run separately
(`pnpm -C gui dev` → http://localhost:3400); the CLI never manages its
lifecycle. `containerHealth: unhealthy` can coexist with `running: true` (it is
the Docker healthcheck probe state) — ignore it unless calls actually hang.

## Domain dev workflow model

**The `astrale` CLI is connect-only — it does not build, run, or deploy
domains.** The whole `astrale domain …` command group (`init | dev | build |
deploy | instance-prepare | check | logs`) has been removed. Domain
development now lives in a **separate devkit bin, `astrale-domain`** (from
package `@astrale-os/devkit`), with subcommands `dev | build | deploy`. New
domains are scaffolded by the **`create-astrale-domain`** scaffolder, which
writes an `astrale.config.ts`.

Domains are **installed by URL**, not from a file: run or deploy the domain
service, then `astrale instance install <domain-url>` (the CLI asks the
running service for a signed install bundle). File-based
`astrale instance install <spec.json>`, committed `spec.json`, and
`pnpm build:spec` are all gone.

- New domain: scaffold with `create-astrale-domain`, then build/run/deploy via
  the `astrale-domain` devkit (`astrale-domain dev`, `astrale-domain build`,
  `astrale-domain deploy`).
- The live domains in `domains/*` have **not yet migrated** to the devkit:
  their worker `package.json` still uses a plain `"dev": "wrangler dev"`, so
  in dev you run the worker directly (`cd worker && pnpm dev`). Dev env vars /
  secrets come from `worker/.dev.vars` (read natively by wrangler); in prod
  from `wrangler secret put` / the deploy.
- Install onto an instance: `astrale instance install <domain-url> -i <slug>`.
  There is **no `astrale domain install`** — install lives under the
  `instance` group because it operates on an instance graph.

For domain design, schema, impl, env presets, and deploy details, see the
`astrale-domain-dev` skill.

## Graph exploration gotchas

- **`class.<Name>` materializes as a `Folder` node** (kind `Folder`, name
  prefixed `class.`) whose children are the class's Methods. There is **no
  `Class` node at that tree position** — the Class definition lives inside the
  Domain's serialized `schema` prop. So `--filter Class` returns zero; use
  `--filter Folder`, or descend into `class.<X>` and `--filter Method`.
- `astrale ls /<domain>` may return `NOT_FOUND` even when the Domain exists
  (known CLI inconsistency — `get`/`describe` resolve the same path). Use
  `astrale describe /<domain>` or `astrale ls /<domain>/<child>`.
- `describe` is a raw node-dump (full properties + children); for Domain nodes
  it includes a multi-kB serialized `schema` — pipe to `jq`, use `--no-schema`.
- `query` is read-only; the kernel rejects write keywords (`CREATE`, `DELETE`,
  `SET`, `MERGE`, `REMOVE`, `DETACH`).

## Logs semantics

Two distinct `logs` surfaces:

| Command | Source | Status |
|---|---|---|
| `astrale logs` | Event journal (`~/.astrale/logs/*.ndjson`, manager + child) | OK |
| `astrale server logs` | Manager Docker container logs | OK |

The detail below is for `astrale logs` (the on-disk event journal).

Journal files on disk:
- Manager: `~/.astrale/logs/events.ndjson`
- Child instance: `~/.astrale/logs/<instanceId>/events.ndjson`

`logs` has **no `--format`** flag; for machine output use `--raw`/`--json` or
`-c`. `-c` (compact) is a **TTY-only formatting flag** — silently ignored in
`--raw` / non-TTY output (use `jq` for JSON pipelines). Topic glob: `*` matches
one segment, `**` matches the rest. Flags: `astrale logs --help`.

## Output / TTY behavior

Output is shape-driven and audience-aware (auto-selected from TTY + flags):

- **TTY** → pretty: lists render as an aligned **table**, objects as YAML, scalars bare.
- **Piped / non-TTY / `--json`** → JSON (the kernel's value, denoised — heavy
  `schema`/`icon` blobs stripped). `--format <yaml|json>` overrides.
- **`--json` ≠ `--raw`**: `--json` = valid JSON (for `jq`); `--raw` = unwrapped —
  bare scalar (e.g. `X=$(astrale token … --raw)`), raw bytes for binary.
- `-q` = one path per line (pipeable); `--count` = the number; `-l` = full fields.
- Binary: piped/`--raw` writes raw bytes; `call … -o <file>` saves to a file; a
  TTY shows a `<binary · type · size>` summary instead of spewing bytes.


The common kernel options (`--format`, `--raw`/`--json`, `--url`,
`-i/--instance`, `--timeout`, `--as`, `--creds`, `--debug`) are shared by
`call`, `get`, `ls`, `describe`, `query`, `token`, `instance install`. Full
list and per-command specifics: `astrale <cmd> --help`.

## Driving the GUI (`astrale browser` + agent-browser)

Operate the live GUI through a real browser driven by
[`agent-browser`](https://github.com/vercel-labs/agent-browser); `astrale
browser` owns the authenticated **session** for it. The GUI login is an httpOnly
cookie (no token injection), so you sign in once and the per-instance profile
reuses it.

```bash
npm install -g agent-browser && agent-browser install   # once
npx skills add vercel-labs/agent-browser                # the driving skill
astrale browser                                         # sign in once → reusable session
```

Then drive it (compact `@eN` refs, not a raw a11y tree):

```bash
P=~/.astrale/browser/<host>                  # <host> = active instance origin
agent-browser --profile "$P" open https://<host>/
agent-browser --profile "$P" snapshot        # → @e1, @e2 …
agent-browser --profile "$P" click @e3
```

`astrale browser --check` verifies the session; flags via `astrale browser
--help`, driving commands via `agent-browser skills get core --full`.



## Configuration and storage

Everything lives under `~/.astrale/` by default. `ASTRALE_HOME` is read as a
*fallback* after the resolved home dir and is set by the container entrypoint
(`ASTRALE_HOME=/astrale`, see `cli/src/lib/env.ts:38`). On a standard host
install, leave it unset.

```
~/.astrale/
  config.json        { managerPort, falkorPort, graphName (default astrale-manager), issuer }
  identities.json    { default, identities: { name: { subject, mode, kid, … } } }
  instances.json     { active, instances: { name: { url?, kind, mode, issuer?, … } } }
  browser.json       Last-connected GUI browser session { url, host, profile, cdp, email }
  browser/<host>/    Persistent agent-browser profile (holds the GUI login cookie)
  tunnels.json       Registry: tunnels[name] = { id, name, hostname,
                     ingress[], boundInstance? }. Source of truth for
                     astrale-managed tunnels — `tunnel start` renders
                     tunnels/<id>.yml from this every spawn; the user's
                     `~/.cloudflared/config.yml` is never touched.
  tunnels/<id>.yml   Per-tunnel cloudflared config, regenerated on every
                     `tunnel start`. Do not hand-edit — mutate via
                     `astrale tunnel ingress add`.
  tunnels/<id>.pid   Background cloudflared PID file.
  tunnels/<id>.log   Background cloudflared logs.
  keys/              Per-identity ES256 keypairs
  data/              FalkorDB volume
  docker-compose.yml FalkorDB + manager service definitions
  logs/events.ndjson Manager event journal
  logs/<id>/events.ndjson  Per-child journals
  manager.pid        Host-mode manager daemon PID
```

| Service | Default | URL form |
|---------|---------|----------|
| Manager | `4400` (`managerPort`) | `http://localhost:4400/host` |
| Child instances | same port | `http://localhost:4400/<slug>` |
| FalkorDB | `6379` (`falkorPort`) | — |
| GUI (run separately) | `3400` | `http://localhost:3400` |

The local manager reserves the first path-segment `/host` for its management
API; any other first path-segment is treated as a local-instance slug.

## Tunnel model

For astrale-managed tunnels (`astrale tunnel setup` / `adopt` / `start` /
`stop` / `status` / `ingress add` / `ingress list`):

- **Adapter-agnostic.** Commands resolve a `TunnelAdapter` via
  `resolveTunnelAdapter()` (parity with `resolveDomainPlatform`) — never the
  concrete adapter, and an oxlint rule enforces that. `cloudflared` is the v1
  adapter; `--adapter <id>` on `setup`/`adopt` selects one.
- **Registry first.** `~/.astrale/tunnels.json` is the source of truth for
  ingress (`tunnels[name].ingress: [{hostname, service, path?}]`). Mutate
  with `astrale tunnel ingress add` / `adopt`, not by hand-editing yaml.
  Writes are schema-validated, so the registry can never persist a state
  that won't re-read.
- **http(s) only.** astrale's contract is http(s) `hostname → service`
  routing; `--service` is validated as an http(s) URL.
- **Adopt is strict.** `adopt` imports a tunnel's existing http(s) ingress;
  a tunnel whose `~/.cloudflared/config.yml` carries a non-http(s) service
  (tcp/ssh/…), a per-rule **or** top-level `originRequest`, or `warp-routing`
  is **refused** (`TunnelUnsupportedConfigError`) — no partial import, no
  silent route loss. Primary hostname = `--hostname`, else the first concrete
  (non-wildcard) ingress hostname.
- **Generated config on start.** `tunnel start` renders
  `~/.astrale/tunnels/<id>.yml` from the registry and spawns
  `cloudflared tunnel --config <path> run <id>`. The user's
  `~/.cloudflared/config.yml` is never read or written by astrale.
  `protocol: http2` is forced (reliable behind firewalls/NAT that drop QUIC);
  the `credentials-file` is written into the generated config, auto-resolved
  from `~/.cloudflared/<id>.json` when present (absent → warn; token-auth via
  `TUNNEL_TOKEN` still works).
- **Ingress is a list.** Wildcards (e.g. `*.fn.dist.…`) are preserved; a
  catch-all `service: http_status:404` is always appended last (cloudflared
  requirement).
- **Failure modes.** A corrupt `tunnels.json` throws
  `TunnelRegistryInvalidError` rather than silently re-seeding. An unknown
  tunnel id/name → `TunnelNotFoundError` on `start`/`ingress`; `stop` and
  `status` are idempotent (warn / skip).

## Errors and debugging

The CLI surfaces typed errors with actionable hints (e.g.
`TunnelNotConfiguredError`, `TunnelRegistryInvalidError` (loud failure on
corrupt `tunnels.json` — no silent seed), `TunnelNotFoundError`,
`TunnelUnsupportedConfigError` (adopt refused — non-http(s) service /
`originRequest` / `warp-routing`), `CannotDeleteManagerError`, `AuthError`,
issuer/meta mismatches, slug
validation, reserved-name collisions). Use `--debug` on any kernel command
for full diagnostics, or `--log-level debug` globally. JWKS/iss/aud probing of a
domain is no longer an `astrale` command (the `astrale domain` group is gone);
the OIDC discovery + JWKS reachability check now lives in the `astrale-domain`
devkit. `auth` is stubbed in v1 (NotImplemented, cloud adapter pending).

## Source map

- Entry & top-level routing: `cli/bin/astrale.ts` (registers `default`
  `CommandDefinition`s; merges shared kernel options at the registration site).
- Commands: `cli/src/commands/` — one `export default … satisfies
  CommandDefinition` per command (carrying `summary?` / `afterHelpText?`),
  plus group subfolders (e.g. `instance/`, `identity/`, `idp/`, `auth/`,
  `admin/`). The `domain/` group was removed (CLI is connect-only); domain
  dev/build/deploy lives in the separate `astrale-domain` devkit bin.
- Registry/help wiring: `cli/src/registry.ts`, types in `cli/src/command.ts`.
- Libs: `cli/src/lib/`. Kernel client plumbing: `cli/src/kernel/`.
  Ports/adapters: `cli/src/ports/`, `cli/src/adapters/`.
