# Astrale CLI — Design Specification

Status: draft
Scope: the `astrale` CLI binary — command surface, on-disk layout, identity model, and kernel-side contract.

---

## Table of contents

1. [Overview](#1-overview)
2. [Architectural principles](#2-architectural-principles)
3. [Core concepts](#3-core-concepts)
4. [Directory layout](#4-directory-layout)
5. [Command surface](#5-command-surface)
6. [Identity model](#6-identity-model)
7. [IdP configuration](#7-idp-configuration)
8. [Kernel-side contract](#8-kernel-side-contract)
9. [End-to-end flows](#9-end-to-end-flows)
10. [Error model](#10-error-model)
11. [Design decisions & rationale](#11-design-decisions--rationale)
12. [Deferred to post-v1](#12-deferred-to-post-v1)

---

## 1. Overview

The `astrale` CLI is a dual-mode tool:

- **Server + client** — on a machine that runs a local Astrale kernel (dev laptop, self-hosted server), it manages the local kernel process *and* acts as a client against it.
- **Client only** — on a machine with no local kernel (admin workstation, CI runner, remote jumpbox), it is a pure client that connects to one or more remote kernels.

The same binary covers both modes. Server commands degrade gracefully on machines with no local installation.

The CLI has three responsibilities:

1. **Server lifecycle** — initialize, start, stop, reset a local kernel (server-only)
2. **Client orchestration** — register kernel endpoints, manage credentials, make calls
3. **Identity management** — local keypairs and external IdP sessions

---

## 2. Architectural principles

These are the rules every design choice in this document follows. If a future change violates one, it should be reconsidered.

### 2.1 Server vs. client are separable concerns

The CLI's server commands operate on **this machine's local kernel process**. The CLI's client commands operate on **any kernel endpoint**. After `astrale server start`, the local kernel is indistinguishable from a remote one as far as client commands are concerned — it is just another instance at `ws://localhost:<port>`.

This means:

- Client-only installations never need to know that "server" commands exist.
- Server state lives in an isolated subdirectory (`~/.astrale/server/`) that client commands never touch.
- The binary is one; the modes are runtime-detected by whether a server installation exists.

### 2.2 Identities are local, portable, and decoupled from kernels

An "identity" in the CLI is a local keyring entry — a name, a subject, and credential material. It is not tied to any specific kernel. The same identity can be trusted by zero, one, or many kernels independently. Identities are portable: copying an identity directory to another machine is sufficient to use that identity on the new machine.

Kernel trust is a separate, kernel-side concern. How an identity becomes "known" to a kernel depends on the credential source:

- **IdP identities** are auto-provisioned: if the kernel trusts the issuer, presenting a valid JWT is sufficient — the kernel creates the identity node on first authentication.
- **Key identities** require explicit registration by a privileged identity (e.g., the system identity) that creates the identity node and publishes the key.

In both cases, this is kernel state, not CLI state.

### 2.3 The kernel is agnostic about IdPs

The kernel holds a list of **trusted issuers** (`iss` values it will accept JWTs from) plus a JWKS verifier per issuer. It knows nothing about WorkOS, Auth0, Google, or any specific IdP. It just validates signatures, checks standard claims, and maps `(iss, sub)` to a local principal.

The CLI is the side that knows how to run OIDC flows. It holds IdP configurations, runs browser/device-code dances, caches tokens, and relays them on calls. The CLI and kernel meet only at the JWT.

### 2.4 Use standard schemas; do not invent auth contracts

IdP metadata follows **OpenID Connect Discovery 1.0** exactly (`snake_case` field names, standard fields). Client registration follows **RFC 7591**. Tokens follow **RFC 6749** / OIDC semantics. The CLI invents zero schema for authentication.

A consequence: a user can `curl <issuer>/.well-known/openid-configuration > metadata.json` and the CLI will consume it as-is.

### 2.5 One unambiguous source for every value

- **Identity names** come from the user (`--name`) or the kernel (`--verify`). Never from filename.
- **Subjects** come from config or IdP claims. Never inferred.
- **Active instance / identity** come from explicit config or explicit flags, never from environment magic.

When two sources disagree, the CLI errors loudly rather than picking a winner.

### 2.6 No backward compatibility inside unreleased changes

The CLI is pre-1.0. Clean design trumps migration convenience. Where this document changes existing behavior, the old behavior is removed outright. Users re-run `astrale server init` / `astrale login` if state layouts change.

---

## 3. Core concepts

Four first-class nouns. Each maps to a command group. Each has a crisp, single-purpose definition.

### 3.1 Server — the local kernel process

The managed-by-this-CLI kernel process on this machine. Cardinality: 0 or 1 per machine. Created by `astrale server init`, started by `astrale server start`. Owns its own state directory (`~/.astrale/server/`) containing compose files, PID files, data volumes, and the server's own root key.

Server commands are the **only** commands that ever touch `~/.astrale/server/`. Removing that directory removes the server. Client commands (identity, idp, instance, login, call) are unaffected.

### 3.2 Instance — a kernel endpoint

A named WebSocket endpoint pointing at some kernel — local or remote, managed or not. Cardinality: N per machine. Registered via `astrale instance add <name> <url>`. After `astrale server start`, a local instance is automatically registered at the local URL.

An instance carries only endpoint-level metadata: URL, TLS config, discovered trusted issuers. It does not carry credentials — those live on identities.

### 3.3 Identity — a credential a user can call as

A named local keyring entry representing a principal. Exactly two credential sources:

- **`key`** — private key on disk, CLI signs JWTs locally
- **`idp`** — IdP-backed: the CLI obtains tokens from an IdP (via any OAuth2 grant) and relays them on calls

Identity lifecycle is independent of any kernel. One identity can be used against many kernels. `identity list` shows both types side by side.

The grant type used to obtain an IdP token (`authorization_code`, `device_code`, `client_credentials`) is a **property of how the login flow was run**, not a separate source type. All IdP identities are just `source: "idp"` regardless of how their tokens are acquired or refreshed.

Raw pre-issued tokens (`--token $TOK`) are **not** an identity source at all — they exist only in stateless mode (see §5.6) and never create a persistent identity record.

### 3.4 IdP — an external identity provider configuration

The CLI's knowledge of how to talk to a specific OIDC provider: issuer URL, client ID, audience, scopes. IdPs are a CLI-side concept; the kernel has its own independent "trusted issuers" list. An IdP in the CLI and a trusted issuer in the kernel meet only at login time via the JWT's `iss` claim.

IdPs and identities are distinct: one IdP can back many identities (e.g., one WorkOS tenant, two users on the same machine); one identity uses exactly one credential source.

---

## 4. Directory layout

All CLI state lives under `~/.astrale/` (overridable via `$ASTRALE_HOME`).

```
~/.astrale/
├── config.json                # global CLI config (active instance, etc.)
├── instances.json             # registered kernel endpoints
│
├── identities/                # local keyring
│   ├── alice/                 # source: key
│   │   ├── private.jwk
│   │   ├── public.jwk
│   │   └── meta.json          # { source: "key", subject, iss, thumbprint, knownInstances }
│   │
│   ├── alice-work/            # source: idp  (interactive user — refresh-token-backed)
│   │   ├── meta.json          # { source: "idp", idp: "workos", subject, iss, ... }
│   │   ├── tokens.enc         # refresh token + cached access token (0600)
│   │   └── id-token.json      # last id_token claims (for whoami)
│   │
│   └── ci-bot/                # source: idp  (machine — client credentials stored)
│       ├── meta.json          # { source: "idp", idp: "workos", subject, iss, ... }
│       ├── client.enc         # client_id + client_secret reference
│       └── tokens.cache       # cached access token
│
├── idps/                      # IdP configurations (OIDC-standard shape)
│   ├── index.json             # { name → { issuer, source } } enumeration
│   ├── workos/
│   │   ├── metadata.json      # verbatim OIDC discovery document
│   │   └── client.json        # RFC 7591 client registration
│   └── google/
│       ├── metadata.json
│       └── client.json
│
└── server/                    # server-only; does not exist on client-only machines
    ├── compose.yml            # docker-compose for the local kernel
    ├── manager.pid            # PID of the running manager process
    ├── data/                  # kernel volumes
    ├── logs/                  # server process logs
    │   └── events.ndjson      # kernel event journal
    └── keys/
        ├── manager.private.jwk    # server root key (used for bootstrap auth only)
        └── manager.public.jwk
```

### Invariants

- **Identities never live outside `identities/`.** There is no top-level keyring file.
- **`server/` is self-contained.** A client-only installation has no `server/` subdirectory. Deleting `server/` resets the server but leaves identities, IdPs, and instances intact.
- **File permissions:** all files under `identities/*/` and `idps/*/client.json` are `0600`. Directories are `0700`.
- **Secret storage:** `tokens.enc` and `client.enc` are encrypted at rest. On macOS/Linux/Windows with keychain support available, the encryption key lives in the OS keychain. On systems without keychain support (containers, CI), a machine-local key file is used with a warning.

---

## 5. Command surface

### 5.1 Server commands (local kernel lifecycle)

| Command | Description |
|---|---|
| `astrale server init` | Create a fresh local installation. Generates server root key, writes compose file. Idempotent only if no existing installation. |
| `astrale server start [--foreground]` | Start the local kernel manager. Auto-registers `local` instance. |
| `astrale server stop` | Stop the local kernel manager. |
| `astrale server restart` | Stop + start. |
| `astrale server status [--json]` | Report running state, PID, uptime, endpoint URL. |
| `astrale server reset [-y]` | Wipe kernel data, reboot. Preserves server root key. |
| `astrale server uninstall [-y]` | Tear down the installation entirely. Removes `~/.astrale/server/`. |
| `astrale server logs [--tail] [-n N]` | Tail the manager process log (not kernel events — see `astrale events`). |

On a machine with no installation, all of these print `no local installation — run 'astrale server init'` and exit 1.

### 5.2 Instance commands (endpoints)

| Command | Description |
|---|---|
| `astrale instance add <name> <url> [--audience <aud>]` | Register a kernel endpoint. `--audience` sets the expected OAuth audience for tokens targeting this instance (used by `login`). If omitted, the CLI tries to fetch it via `auth.trustedIssuers` introspection. |
| `astrale instance list [--json]` | List registered instances with endpoint URL, audience, and discovered trusted issuers. |
| `astrale instance remove <name>` | Unregister. Does not affect the kernel. |
| `astrale instance inspect <name> [--json]` | Show full metadata: URL, audience, trusted issuers, active identity, last seen. |
| `astrale instance use <name>` | Set the active instance (used when no `--instance` flag is passed). |

If you need to change an instance's URL or audience, `instance remove` + `instance add` handles it. There is no `instance set`: a dedicated field-editor would drift into a generic config editor and the round-trip through remove/add is trivial.

The active instance is stored in `config.json` and can be overridden per-call with `--instance <name>` or `--instance <url>`. A raw URL is accepted wherever a name is accepted; it creates an ephemeral in-memory instance record for the duration of that one command.

### 5.3 IdP commands (OIDC provider configs)

| Command | Description |
|---|---|
| `astrale idp add <name> --issuer <url> [--client-id <id>] [--audience <aud>] [--scopes ...] [--dynamic]` | Register an IdP. Fetches OIDC discovery from `<issuer>/.well-known/openid-configuration` unless `--metadata <file>` is provided. With `--dynamic`, performs RFC 7591 dynamic client registration. |
| `astrale idp list [--json]` | List configured IdPs. |
| `astrale idp show <name>` | Show full IdP config: issuer, discovered endpoints, client ID, audience, scopes. |
| `astrale idp refresh <name>` | Re-fetch OIDC discovery and update `metadata.json`. |
| `astrale idp remove <name>` | Remove the IdP. Fails if any identity references it (must delete those identities first). |

**Defaults:** one or more IdPs ship pre-configured with the CLI binary (e.g., `astrale-default` pointing at Astrale's hosted auth service). Built-in IdPs are read-only — `idp remove astrale-default` fails. Users can add their own alongside.

### 5.4 Identity commands (local keyring management)

The CLI's `identity` subcommand is deliberately minimal. It manages **local keyring state only**: generating/importing keys, listing them, showing them, deleting them.

| Command | Description |
|---|---|
| `astrale identity generate <name> [--subject <sub>]` | Create a new local keypair under `identities/<name>/`. Computes and stores the key's RFC 7638 thumbprint. Does not touch any kernel. |
| `astrale identity import <key-file> --name <name> [--subject <sub>]` | Import an existing private key (PEM or JWK; `-` for stdin). `--name` is required. Filename is never used. |
| `astrale identity list [--json]` | List all local identities with name, source, subject, and cached known-instances. |
| `astrale identity show <name>` | Show full details for one local identity. |
| `astrale identity export <name> --public [--format jwk\|pem]` | Print the public key. Useful when you need to hand it off to an admin. |
| `astrale identity export <name> --private [--encrypt]` | Export the private key for migration (`source: key` only). Refuses on `source: idp`. |
| `astrale identity delete <name>` | Remove the local entry entirely. Does not touch any kernel. |
| `astrale identity rename <old> <new>` | Rename a local keyring entry. Local-only. |

**How identities become known to a kernel — the two paths:**

- **IdP identities** need no explicit registration. If the kernel's provisioning policy trusts the IdP's issuer, the identity is auto-provisioned on first authenticated call. The CLI just presents the IdP token and the kernel does the rest. See §8.3.

- **Key identities** require a privileged identity to sponsor them. The `registerIdentity` syscall demands that the caller already be authenticated with EDIT permission on the target identity node — which means the node must already exist (in `creating` status) and the caller must have created it. In practice this means: an admin (or the system identity) creates the identity node via `createNode`, then calls `registerIdentity` on it with the user's public key. On a local dev server, `astrale server init` handles this automatically via the server's root key.

Identity management operations on the kernel side (`extend`, `constrain`, `exclude`, `grantPerm`, `revokePerm`, etc.) are kernel syscalls on `/kernel.astrale.ai/Identity/…` invoked via `astrale call`.

**Rules:**

- `--name` is **required** on `import`. Filename is never used to derive a name.
- Name collision with an existing local identity is a hard error; pick a different name or `identity delete` first.

### 5.5 Login / Logout (IdP sessions)

`login` creates an IdP-backed identity; `logout` clears it. These are the IdP counterparts to `identity generate` / `identity delete`.

| Command | Description |
|---|---|
| `astrale login --idp <name> [--instance <i>] [--audience <aud>] [--name <local-name>] [--device] [--verify]` | Run an OIDC flow against `<idp>`, store tokens under `identities/<local-name>/`. Default mode is authorization code + PKCE with browser. `--device` uses device code flow. Default `--name` is derived from IdP claims (e.g., email). |
| `astrale login --idp <name> --client-credentials --client-id <id> --client-secret-env <VAR> [--audience <aud>]` | Machine-to-machine variant. No browser, no refresh token. |
| `astrale logout [<name>] [--revoke-at-idp]` | Clear the identity's token cache. With `--revoke-at-idp`, also call the IdP's `revocation_endpoint` (best-effort). Without a name, logs out the active identity. |
| `astrale identity refresh <name>` | Force a token refresh now (for debugging). Normally refresh happens automatically on `call`. |

Login's `--verify` flag checks the resulting token against the target instance immediately and reports whether the kernel will accept it. Without `--verify`, login only validates the IdP flow succeeded — kernel acceptance is confirmed on the first `call`.

#### Audience resolution at login time

The OAuth `audience` parameter is **not** a property of the IdP. It is a property of the target resource. `login` resolves it in this order:

1. **`--audience <aud>` flag** — explicit override, wins over everything else
2. **Target instance's `audience` field** from `instances.json` (set at `instance add` time)
3. **Unset** — no `audience` parameter is sent to the IdP; the IdP decides what to do

This means the same IdP config (e.g., `idp workos`) can be used to log in against multiple instances that require different audiences, without duplicating the IdP. Two common flows:

```bash
# Per-instance default audience
astrale instance add prod    wss://kernel.prod    --audience kernel-prod
astrale instance add staging wss://kernel.staging --audience kernel-staging
astrale login --idp workos --instance prod       # gets a token for kernel-prod
astrale login --idp workos --instance staging    # gets a token for kernel-staging
```

```bash
# Explicit override (e.g., for a one-off or when the instance's default isn't right)
astrale login --idp workos --instance prod --audience custom-audience
```

The resolved audience is recorded in the identity's `meta.json` alongside the resulting tokens, so refresh flows know which audience to request on renewal.

### 5.6 Kernel calls

| Command | Description |
|---|---|
| `astrale call <method> [key=val ...] [--data <json>] [--instance <i>] [--as <identity>] [--timeout <ms>] [--raw\|--json] [--format yaml\|json]` | Invoke a kernel operation. Params from key=value pairs, `--data`, or stdin JSON. |
| `astrale get <path> [--instance <i>] [--as <identity>]` | Get a node by path or ID. |
| `astrale ls <path> [--instance <i>] [--as <identity>]` | List children of a node. |
| `astrale query <cypher> [--instance <i>] [--as <identity>]` | Run a read-only Cypher query. |
| `astrale events [--tail] [-n <count>] [--topic <pattern>] [--since <time>] [--trace <id>] [--instance <i>] [--json]` | View the kernel event journal. |

**Stateless mode:** for CI and one-shot scripts, `call` additionally accepts:

```
astrale call <method> --instance <url> --key <file> --subject <sub>
astrale call <method> --instance <url> --idp <idp> --client-credentials --client-id <id> --client-secret-env <VAR>
astrale call <method> --instance <url> --token <token>
```

Stateless mode reads and writes nothing under `~/.astrale/`. All auth material is passed inline. `--instance` accepts a raw URL here.

### 5.7 Introspection

| Command | Description |
|---|---|
| `astrale whoami [--verbose]` | Show active instance + active identity + what the kernel thinks. `--verbose` shows raw claims. |
| `astrale status` | Overall CLI status: active instance, active identity, server state (if any). |
| `astrale version` | Print CLI version. |

### 5.8 Top-level convenience aliases

For the common local-dev case, a few shortcuts are kept at the top level:

| Alias | Expands to |
|---|---|
| `astrale init` | `astrale server init` |
| `astrale start` | `astrale server start` |
| `astrale stop` | `astrale server stop` |
| `astrale use <name>` | `astrale instance use <name>` |

These are convenience only. The canonical form is always the subcommand.

---

## 6. Identity model

### 6.1 The two credential sources

Every identity has a `source` field with exactly two possible values. The distinction is whether the **JWT signer** is local or remote — nothing else.

| Source | Signer | Where credential material lives |
|---|---|---|
| `key` | **Local**: the CLI holds a private key and signs JWTs itself | `private.jwk` + `public.jwk` in the identity directory |
| `idp` | **Remote**: an external IdP signs; the CLI obtains tokens and relays them | Varies — see §6.3. May be a refresh token, a client credentials pair, or any other material a specific OAuth grant produces |

Both produce the same thing at the kernel boundary: a JWT. The kernel's verifier dispatches on the JWT's `iss` claim.

**Refresh strategy is not recorded; it is inferred.** The CLI decides at runtime how to refresh an `idp` identity by looking at what credential material is present in the identity directory:

- `refresh_token` file present → use `refresh_token` grant against the token endpoint
- `client_id` + `client_secret` present → re-run `client_credentials` grant
- Nothing usable → the identity needs re-login

This rule is deliberate: denormalizing the refresh strategy into a metadata enum (e.g., `grant: "client_credentials"`) would duplicate what the filesystem already says, and the two could drift. It also means new OAuth grant types (CIBA, token exchange, etc.) can be added without any schema change — just new file shapes and new handlers.

**Raw pre-issued tokens** (`call --token $TOK`) are not persisted as identities. They exist only in the stateless call path (§5.6). If a user wants persistence, the right answer is either (a) configure the IdP that issued the token and use `login`, or (b) keep passing it inline in stateless mode.

### 6.2 The (K, R, C) state model

At any moment, an identity has state in three independent places:

| Bit | Meaning | Owner |
|---|---|---|
| **K** | Credential material on this machine | local filesystem |
| **R** | Target kernel(s) have trust for this identity | kernel-side (per-kernel) |
| **C** | CLI config entry names this identity | local `identities/<name>/meta.json` |

Only `(K, R, C) = (1, 1, 1)` is a fully usable state for making calls. All other states are transient or broken:

| State | Name | How to reach it | Resolution |
|---|---|---|---|
| 000 | void | nothing exists | `generate` / `import` / `login` |
| 100 | orphan key | bare key on disk | `import` to create C |
| 010 | remote-only | another machine holds the key | transfer key file, then `import` |
| 001 | ghost config | broken | delete and re-create |
| 110 | trusted but not wired | key + registered, no local CLI entry | `identity import` |
| 101 | local only | in keyring, no kernel trust | IdP: just call the kernel (auto-provisioned on first auth). Key: ask an admin to register, or use `server init` locally. |
| 011 | lost key | config + trust but key missing | generate a new keypair and have it registered again |
| 111 | healthy | fully usable | normal operation |

For IdP identities, "K" is "valid refresh token on disk" rather than "private key on disk" — but the model is identical. An expired refresh token with no re-login flows through is equivalent to a missing K bit.

### 6.3 Identity metadata shape

`identities/<name>/meta.json`:

```jsonc
// source: "key"
{
  "name": "alice",
  "source": "key",
  "subject": "alice",
  "thumbprint": "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs",   // RFC 7638 JWK thumbprint
  "kid": "alice-key",
  "createdAt": "2026-04-08T10:00:00Z",
  "knownInstances": [
    { "instance": "local",   "registeredAt": "2026-04-08T10:01:00Z", "status": "ok" },
    { "instance": "staging", "registeredAt": "2026-04-08T11:30:00Z", "status": "ok" }
  ]
}
```

```jsonc
// source: "idp" — refresh-token-backed (interactive user, device code, etc.)
{
  "name": "alice-work",
  "source": "idp",
  "idp": "workos",
  "subject": "alice@corp.com",            // resolved from id_token claims at login
  "iss": "https://api.workos.com/sso/workos/corp",
  "audience": "kernel-prod",              // resolved at login; refresh reuses this value
  "idpSubject": "alice@corp.com",         // original 'sub' claim
  "createdAt": "2026-04-08T10:00:00Z",
  "expiresAt": "2026-04-08T11:00:00Z",    // current access token expiry
  "refreshExpiresAt": "2026-05-08T10:00:00Z",
  "knownInstances": [
    { "instance": "prod", "firstSeen": "2026-04-08T10:05:00Z", "status": "ok" }
  ]
}
// Refresh strategy: presence of tokens.enc with a refresh_token implies refresh_token grant.
```

```jsonc
// source: "idp" — client-credentials-backed (machine account)
{
  "name": "ci-bot",
  "source": "idp",
  "idp": "workos",
  "subject": "ci@bot.internal",
  "iss": "https://api.workos.com/sso/workos/corp",
  "audience": "kernel-prod",
  "createdAt": "2026-04-08T10:00:00Z",
  "expiresAt": "2026-04-08T11:00:00Z",
  "knownInstances": [
    { "instance": "prod", "firstSeen": "2026-04-08T10:05:00Z", "status": "ok" }
  ]
}
// Refresh strategy: presence of client.enc (client_id + client_secret) implies client_credentials grant.
```

The `knownInstances` cache is a **hint**, not a source of truth. It drives `identity list` display and helps produce actionable errors ("this identity used to work on prod; last seen 3 days ago"). The kernel is always the authority on whether a credential is currently accepted.

### 6.4 The two paths to kernel trust

An identity becomes "known" to a kernel through one of two paths, depending on its credential source. The paths are fundamentally different in who initiates, what permissions are required, and what the kernel does.

#### Path A — IdP identities: auto-provisioned on first call

For IdP-backed identities, the CLI does nothing special beyond presenting the IdP-issued JWT. The kernel handles everything:

1. JWT arrives with `(iss, sub)` from an external IdP (e.g., WorkOS, Google)
2. Kernel verifies the signature against the IdP's JWKS (discovered via `<iss>/.well-known/openid-configuration`)
3. Kernel looks up `(iss, sub)` in its identity store — no match found
4. Kernel evaluates its **provisioning policy** (see §8.3): is this issuer allowed?
5. If allowed → kernel auto-provisions an identity node and completes authentication
6. If denied → kernel returns an auth error

From the CLI's perspective, the first `astrale call` after `astrale login` either succeeds (identity was auto-provisioned) or fails (issuer not trusted). There is no explicit registration step. The CLI's `knownInstances` cache records "first successful call" as the moment the identity became known to that kernel.

#### Path B — Key identities: sponsored by a privileged identity

For key identities, the `registerIdentity` syscall is the mechanism — but it **cannot be called by the key being registered**. The syscall's authorization requirements are:

- **USE** permission on the `registerIdentity` syscall node
- **EDIT** permission on the target identity node
- **USE** permission on the node's class

This means the identity node must **already exist** (in `creating` status), and the **caller** must be an already-authenticated identity with EDIT permission on it. The key holder cannot bootstrap themselves.

The typical flow requires a privileged sponsor — either an admin or the system identity:

1. Sponsor calls `createNode` to create an identity node under the appropriate class
2. Sponsor calls `registerIdentity` on that node, passing the new user's `publicKey` and a bootstrap credential signed by the new user's private key
3. Kernel verifies the bootstrap credential's signature against the supplied `publicKey` (not against any JWKS — the key is right there in the request)
4. Kernel computes `thumbprint` = RFC 7638 JWK Thumbprint of `publicKey`
5. Kernel constructs `iss = <kernelIssuer>/iss/<thumbprint>` and publishes the issuer via `authPort.publishIssuer(iss, publicKey)`
6. Kernel updates the identity node with `(iss, sub, publicKey)`
7. Sponsor calls `grantPerm` to give the new identity initial permissions

On a local dev server, `astrale server init` handles steps 1-7 automatically using the server's root key (the `__SYSTEM__` identity has all privileges). The user never calls `registerIdentity` directly.

#### Case C — kernel-generated keys (not CLI-visible)

The kernel generates keypairs internally for system/root identities at bootstrap time. `iss = <kernelIssuer>`, `sub = nodeId`. This is entirely kernel-internal and not a path the CLI ever uses.

#### Issuer identifiers for key identities

When a `key`-source identity is registered, the kernel derives its `iss` deterministically from the public key:

**The thumbprint is the RFC 7638 JWK Thumbprint of the public key** — a base64url-encoded SHA-256 digest over a canonical JSON representation of the key. This is a well-specified, standard, collision-resistant fingerprint that every JWK library can compute.

```
iss = <kernelIssuer>/iss/<thumbprint>
```

Example:

```
iss = https://kernel.prod.eu.astrale.ai/iss/NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs
```

The kernel is the sole authority constructing this URL. The `iss` claim in the bootstrap token is **ignored** — the kernel verifies only that the holder of the public key possesses the corresponding private key, then derives the real `iss` from the key itself. This prevents clients from dictating the kernel's URL namespace.

#### Reconstructing `iss` on the CLI side

The kernel returns `{ iss, sub }` from `registerIdentity`. However, even without the response, both sides can apply the same deterministic rule:

```
iss = <kernelIssuer>/iss/<RFC 7638 thumbprint of publicKey>
```

The CLI computes this using the public key, the thumbprint (cached at `identity generate` time in `meta.json`), and the kernel issuer (from instance metadata). This is the **one cross-component convention** between CLI and kernel: the URL template `<kernelIssuer>/iss/<thumbprint>`. A stable, documented rule that both sides implement.

#### Why the kernel computes the thumbprint, not the CLI

1. **Authority.** The kernel owns its own URL namespace. It should be the sole authority constructing URLs under that namespace.
2. **Attack surface.** If the kernel trusted whatever `iss` the CLI puts in the bootstrap token, an attacker could register with a crafted `iss` pointing somewhere unexpected. By ignoring the token's `iss` and deriving the real one from the public key itself, the kernel makes that class of abuse impossible.

### 6.5 One identity = (one key OR one IdP session) + one subject

An identity in the CLI maps to exactly one credential source and one subject. If a user wants to sign for two subjects with the same key, they import it twice under two names (with a warning about duplication). If they want to use two IdPs, they run `login` twice.

This is the 1:1 rule — it makes the state model tractable and matches how users think about "accounts."

---

## 7. IdP configuration

### 7.1 OIDC Discovery 1.0 as the wire format

The CLI stores IdP metadata in the exact shape defined by OpenID Connect Discovery 1.0 — `snake_case` field names, standard fields. This is the shape every OIDC provider publishes at `<issuer>/.well-known/openid-configuration`.

**Rule: the CLI invents no field names for IdP metadata.** A user who has access to their IdP's discovery URL can `curl` it directly into `idps/<name>/metadata.json` and the CLI will consume it as-is.

### 7.2 `idps/<name>/metadata.json`

Verbatim OIDC discovery document. Example (truncated):

```jsonc
{
  "issuer": "https://api.workos.com/sso/workos/corp",
  "authorization_endpoint": "https://api.workos.com/sso/authorize",
  "token_endpoint": "https://api.workos.com/sso/token",
  "jwks_uri": "https://api.workos.com/sso/jwks",
  "device_authorization_endpoint": "https://api.workos.com/sso/device",
  "revocation_endpoint": "https://api.workos.com/sso/revoke",
  "end_session_endpoint": "https://api.workos.com/sso/logout",
  "scopes_supported": ["openid", "email", "profile"],
  "response_types_supported": ["code"],
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
    "client_credentials"
  ],
  "id_token_signing_alg_values_supported": ["ES256", "RS256"],
  "subject_types_supported": ["public"]
}
```

### 7.3 `idps/<name>/client.json`

Client registration info — shape per RFC 7591 Dynamic Client Registration, used even for static config:

```jsonc
{
  "client_id": "client_01ABC",
  "client_secret": null,                            // null = public client (PKCE)
  "token_endpoint_auth_method": "none",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "scopes": ["openid", "email", "profile"]
}
```

Field names follow RFC 7591 exactly. **No `audience` field** — audience is a property of the target resource (the kernel instance), not of the IdP. See §5.5 for how audience is resolved at login time.

Rationale: the same IdP can legitimately issue tokens for many distinct resources. One WorkOS tenant can issue tokens for `kernel-prod` and `kernel-staging` — they share an authentication authority but target different audiences. Locking `audience` into `client.json` would force one IdP config per audience, which is wrong.

### 7.4 `idps/index.json`

Index of configured IdPs for fast enumeration:

```jsonc
{
  "workos": {
    "issuer": "https://api.workos.com/sso/workos/corp",
    "source": "discovery",
    "lastRefreshed": "2026-04-08T10:00:00Z",
    "builtIn": false
  },
  "google": {
    "issuer": "https://accounts.google.com",
    "source": "discovery",
    "lastRefreshed": "2026-04-08T10:00:00Z",
    "builtIn": false
  },
  "astrale-default": {
    "issuer": "https://auth.astrale.ai",
    "source": "built-in",
    "lastRefreshed": "2026-04-08T10:00:00Z",
    "builtIn": true
  }
}
```

### 7.5 Dynamic client registration

For IdPs that support RFC 7591 dynamic registration, `astrale idp add <name> --issuer <url> --dynamic` performs the full flow:

1. Fetch discovery at `<issuer>/.well-known/openid-configuration`
2. Read `registration_endpoint` from metadata
3. POST a client registration request
4. Store the returned `client_id` (and `client_secret`, if any) in `client.json`

This lets CLI installations self-bootstrap against conformant IdPs with zero manual copy-paste.

### 7.6 Built-in defaults

The CLI ships with one or more pre-configured IdPs baked into the binary. These are indistinguishable at runtime from user-added IdPs except:

- `builtIn: true` in `index.json`
- `idp remove <name>` refuses with a clear error
- `idp refresh <name>` still works and updates the cached metadata

**Rationale:** users of the Astrale-hosted product should never need to configure an IdP. `astrale login` Just Works out of the box because `astrale-default` is already there.

---

## 8. Kernel-side contract

This section lists what the kernel must expose for the CLI to work. The kernel's authentication layer has three responsibilities: verify JWTs, resolve identities, and auto-provision identities from trusted issuers.

### 8.1 Trusted issuers introspection (optional, nice UX)

An operation — e.g., `auth.trustedIssuers` — that returns the list of `iss` values the kernel will accept. Used by `astrale instance inspect` to show users which of their configured IdPs match what a given kernel trusts.

```jsonc
// kernel.call('auth.trustedIssuers', ...) →
{
  "issuers": [
    "https://auth.astrale.ai",
    "https://api.workos.com/sso/workos/corp",
    "https://kernel.prod.eu.astrale.ai/iss/*"   // pattern for registered key identities
  ]
}
```

This is **read-only**. It is a pure UX aid — the kernel is still the final authority, and the CLI works without this op (it just can't preemptively warn the user that a login won't succeed).

### 8.2 JWT verifier dispatch

The kernel's auth layer dispatches JWT verification based on the `iss` claim:

- `iss = <external IdP URL>` (Path A of §6.4) → kernel fetches the IdP's JWKS via OIDC discovery at `<iss>/.well-known/...`, verifies the signature, checks `aud`
- `iss = <kernelIssuer>/iss/<thumbprint>` (Path B of §6.4) → kernel looks up the public key it published at registration time via `authPort.publishIssuer`, verifies the signature against that key
- `iss = <kernelIssuer>` (Case C of §6.4) → kernel-internal identities; not a CLI-visible path

All cases end in the same place: a verified `(iss, sub)` that the kernel maps to an identity node.

### 8.3 Auto-provisioning (identity creation on first auth)

After JWT verification succeeds, the kernel resolves `(iss, sub)` to an identity node. If no identity node exists, the kernel evaluates its **provisioning policy** to decide whether to create one automatically.

The provisioning pipeline:

1. **Policy evaluation** — the `ProvisioningPolicyEvaluator` matches rules against `(issuer, subject, claims)`. First matching rule's `effect` wins; falls back to `defaultDecision`.
2. **Identity creation** — if policy allows, the identity store creates a new identity node with `(iss, sub)` properties.
3. **Permissions** — a provisioned identity starts with **no permissions**. The provisioning policy (or a post-provisioning hook) determines what initial permissions to grant.

The provisioning policy is configured per-kernel at deployment time. It controls which issuers are allowed to auto-provision identities. Example shapes:

```jsonc
// Allow everything (development default)
{ "defaultDecision": "allow" }

// Allow only specific issuers
{
  "defaultDecision": "deny",
  "rules": [
    { "issuer": { "equals": "https://auth.astrale.ai" }, "effect": "allow" },
    { "issuer": { "equals": "https://id.corp.com" }, "effect": "allow" }
  ]
}
```

**Current implementation status:** the provisioning infrastructure (policy evaluator, trust store, provisioning store) is fully implemented in the runtime. The in-memory adapter provisions identities correctly. The graph-backed (Cypher) adapter's `provisionIdentity()` is not yet implemented — it returns `null`, meaning auto-provisioning does not yet work against the real graph backend. This is a separate kernel-side work item (see §12.8).

This is the critical kernel-side contract for the CLI: **if the kernel's provisioning policy trusts an issuer, presenting a valid JWT from that issuer is sufficient to become a known identity.** The CLI does not need an explicit registration step for IdP-backed identities.

### 8.4 Registration (key identities, kernel-side)

For key identities registered via the `Identity/registerIdentity` syscall, the kernel:

1. Verifies the bootstrap token's signature against the supplied `publicKey` (not against any JWKS)
2. Computes `thumbprint` = RFC 7638 JWK Thumbprint of `publicKey`
3. Constructs `iss = <kernelIssuer>/iss/<thumbprint>` using its own issuer URL
4. Publishes via `authPort.publishIssuer(iss, publicKey)`
5. Persists `iss`, `sub`, and `publicKey` on the identity node

The `iss` claim in the bootstrap token is **ignored**. This prevents clients from dictating the kernel's URL namespace and makes the thumbprint the single source of truth for issuer identity.

The kernel returns `{ iss, sub }` from the syscall. The CLI also independently reconstructs `iss` by applying the same deterministic rule. Both sides share the URL template `<kernelIssuer>/iss/<thumbprint>` as a documented convention — the one cross-component contract between CLI and kernel. See §6.4.

**Important:** this syscall requires the caller to be an already-authenticated identity with EDIT permission on the target identity node, and USE permission on the syscall and the node's class. The target node must already exist in `creating` status. See §6.4 Path B for the full flow.

---

## 9. End-to-end flows

### 9.1 Fresh dev laptop — server + client

```bash
astrale server init
astrale server start                  # local instance auto-registered as 'local'

astrale identity generate bryan       # new keypair under identities/bryan/
                                      # thumbprint = RFC 7638 thumbprint, computed locally at generate time

# server init automatically registers the first identity using the system identity:
# 1. __SYSTEM__ calls createNode to create an identity node in 'creating' status
# 2. __SYSTEM__ calls registerIdentity on that node with bryan's public key
# 3. __SYSTEM__ calls grantPerm to give bryan initial permissions
# The user never calls registerIdentity directly.

astrale call /foo/bar key=value       # signs with bryan's key, iss = published one
```

End state: one server running, one local instance, one key identity registered via the system identity. The kernel has published `<kernelIssuer>/iss/<thumbprint>` via `authPort.publishIssuer`, and the CLI has independently reconstructed the same URL for future token signing.

### 9.2 Client-only machine connecting to a hosted kernel via SSO

```bash
astrale instance add main wss://kernel.astrale.ai
astrale instance use main

astrale login --idp astrale-default --verify
# → browser opens → user authenticates via hosted IdP
# → tokens stored under identities/alice/
# → --verify makes a test call to the kernel:
#     kernel sees (iss, sub) from the IdP token → no matching identity
#     → kernel evaluates provisioning policy → issuer trusted → auto-provisions
# → "✓ logged in as alice@corp.com on main"

astrale call /foo/bar
# subsequent calls skip provisioning — identity already exists in the graph
```

End state: no server, one instance, one IdP-backed identity auto-provisioned by the kernel. Nothing under `~/.astrale/server/`. No explicit registration step was needed.

### 9.3 Client-only with corporate SSO (self-hosted kernel)

Admin side (one-time, kernel deployment):

```
(admin configures kernel with trusted issuer: https://id.corp.com + jwks_uri + audience)
```

User side:

```bash
astrale instance add prod wss://kernel.prod.corp
astrale instance inspect prod
# trusted issuers:
#   - https://id.corp.com   (no matching local IdP — configure one)

astrale idp add corp --issuer https://id.corp.com --client-id astrale-cli
astrale login --idp corp --instance prod --verify
# → browser → auth → tokens stored → kernel accepts
# → identity 'alice-corp' ready
```

### 9.4 Headless runner (CI) with machine IdP

```bash
astrale instance add prod wss://kernel.prod.corp
astrale idp add corp --issuer https://id.corp.com --client-id ci-astrale

astrale login --idp corp --client-credentials \
  --client-id ci-astrale \
  --client-secret-env CI_CLIENT_SECRET \
  --name ci-bot \
  --instance prod

astrale call /deploy/run version=1.2.3
```

Or fully stateless:

```bash
astrale call /deploy/run \
  --instance wss://kernel.prod.corp \
  --idp corp \
  --client-credentials \
  --client-id ci-astrale \
  --client-secret-env CI_CLIENT_SECRET \
  version=1.2.3
```

Stateless mode writes nothing to disk.

### 9.5 Second machine — existing identity, already registered

On laptop A:

```bash
astrale identity export alice --private --encrypt > alice.enc
scp alice.enc laptop-b:~/
```

On laptop B:

```bash
astrale instance add prod wss://kernel.prod.astrale.ai
astrale identity import ./alice.enc --name alice
# local entry created. Same thumbprint (deterministic from the public key),
# so calls against prod will use the same issuer URL as on laptop A.
astrale call /foo/bar --instance prod
```

No re-registration needed: the issuer was already published by the kernel when alice was first registered from laptop A, and the public key hasn't changed, so the same `iss` URL still resolves to the same JWKS on the kernel side.

### 9.6 Key rotation

Rotation requires a privileged identity to register the new key. The typical flow is:

```bash
astrale identity generate alice-new                                 # new local keypair
astrale identity export alice-new --public                          # hand the public key to the admin

# An admin (or the system identity on a local server) performs:
# 1. createNode to create a new identity node (or reuse the existing one if the kernel supports key update)
# 2. registerIdentity on that node with alice-new's public key
# 3. grantPerm to transfer permissions

astrale identity delete alice                                       # drop the old local entry
```

Rotation with grace periods, revocation semantics, etc. are handled entirely kernel-side via identity operations on `/kernel.astrale.ai/Identity/…`.

### 9.7 Delete an identity locally

```bash
astrale identity delete alice
```

This removes `~/.astrale/identities/alice/` and nothing else. The kernel still trusts the published `iss` until an admin explicitly revokes it via a kernel syscall. If you want to untrust as well, call the appropriate kernel op directly before deleting locally.

---

## 10. Error model

Every CLI error must tell the user (a) what went wrong, (b) why, and (c) what to do next. Errors are typed and use consistent exit codes.

### 10.1 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Invalid arguments / usage |
| 3 | Authentication failure (no valid credential, refresh failed, kernel rejected) |
| 4 | Authorization failure (valid credential but insufficient permission) |
| 5 | Not found (instance, identity, IdP, node path) |
| 6 | Conflict (name collision, already exists) |
| 7 | Network error (kernel unreachable, IdP unreachable) |
| 8 | Server lifecycle error (server not installed, not running, etc.) |

### 10.2 Error families and their actionable messages

**Credential missing/expired:**
```
✘ Credential for identity 'alice-work' has expired.
  Reason: refresh token expired at 2026-04-07T10:00:00Z
  Fix:    astrale login --idp workos --name alice-work
```

**Kernel doesn't recognize identity (key):**
```
✘ Kernel 'prod' does not recognize identity 'alice'.
  Reason: issuer https://kernel.prod.eu.astrale.ai/iss/NzbLs...
          is not published on this kernel.
  Fix:    ask an admin to register your public key on this kernel,
          or export it for them:
            astrale identity export alice --public
```

**Kernel doesn't recognize identity (IdP — issuer not trusted):**
```
✘ Kernel 'prod' rejected identity 'alice-work'.
  Reason: issuer https://api.workos.com/sso/workos/corp
          is not in this kernel's provisioning policy.
  Fix:    ask the kernel admin to add this issuer to the trusted list,
          or use a different IdP:
            astrale login --idp <trusted-idp> --instance prod
```

**Name conflict on import:**
```
✘ Cannot import as 'alice': an identity named 'alice' already exists.
  Fix:    astrale identity import <file> --name alice-2
          or:
          astrale identity import <file> --name alice --overwrite
```

**Verification disagreement:**
```
✘ Verification mismatch.
  You passed:   --name bob
  Kernel says:  this key belongs to 'alice'
  Fix:          pass --force to alias it locally as 'bob',
                or remove --name to accept the kernel's answer.
```

**Server not installed (on client-only machine):**
```
✘ No local installation found.
  Fix:  astrale server init && astrale server start
        — or —
        if you meant to connect to a remote kernel, use:
        astrale instance add <name> <url>
```

### 10.3 Error output rules

- Errors go to **stderr**; success output goes to **stdout**.
- In non-TTY mode (`--json`, `--raw`, or piped output), errors are emitted as JSON on stderr:
  ```json
  {"error": "credential_expired", "identity": "alice-work", "reason": "...", "fix": "astrale login --idp workos --name alice-work"}
  ```
- TTY mode uses the styled format shown in 10.2.
- Fatal errors always exit with a non-zero code; the CLI never swallows errors silently.

---

## 11. Design decisions & rationale

Non-obvious choices that future changes should not casually revisit.

### 11.1 Why `server`, not `host` or `daemon`

`host` was ambiguous with "remote host." `daemon` is implementation detail (the thing `server start` boots may or may not be a daemon). `server` matches user vocabulary — "start the Astrale server" is how people describe it. The nuance that "server" also colloquially refers to the thing an instance points at is acceptable because the subcommand group (`astrale server …`) disambiguates.

### 11.2 Why `idp`, not `provider`

"Provider" is generic and overloaded (cloud provider, data provider, service provider). "IdP" is industry-standard vocabulary specific to identity federation. Anyone doing auth work reads `astrale idp add` immediately; `astrale provider add` invites "provider of what?"

### 11.3 Why identities are local and kernel trust is separate

Identity as a local keyring matches SSH, GPG, git, kubectl mental models. Coupling identity to a specific kernel would break portability (same user, multiple kernels) and muddle the state model (what does "delete alice" mean if alice is on three kernels?). Keeping them separate means each axis has clean semantics.

### 11.4 Why `--name` is required on `import`

Deriving from filename is a footgun: filename is storage metadata (how it happens to be on disk), not identity metadata (what the key represents). A key downloaded from a secret manager named `download.jwk` should not silently become an identity named `download`. The one legitimate auto-derivation is a kernel lookup via `--verify`, which is an authoritative source.

### 11.5 Why OIDC Discovery 1.0 as the IdP storage shape

Every sane IdP publishes this document. It is versioned, stable, and well-known. Inventing our own schema creates migration pain for zero gain. Using snake_case field names breaks TS convention but means users can `curl` discovery documents directly into config without translation.

### 11.6 Why the kernel knows nothing about IdPs

Coupling kernel auth to specific providers (WorkOS, Google) would require the kernel to ship provider-specific code. Keeping the kernel to "verify JWTs against an issuer allow-list" is simpler, more secure, and lets CLI-side innovation proceed independently of kernel changes.

### 11.7 Why one identity = one credential source

A unified identity abstraction that spans `key` and `idp` credentials keeps the user's mental model simple: "who am I to the kernel?" has one answer. Allowing one identity to have multiple credential sources would require a selection UI on every call. Users who legitimately want both can maintain two identities. Keeping the taxonomy at exactly two values (rather than splitting IdP into interactive/machine/static subtypes) means new OAuth grant types or token flows become enum extensions on `grant`, not new source types.

### 11.8 Why key registration requires a privileged sponsor

`registerIdentity` is a kernel syscall that requires EDIT permission on the target identity node, and the node must already exist in `creating` status. A key holder cannot register themselves because they don't exist in the graph yet — they have no permissions, and no identity node to register against. This is by design: the kernel's authorization model requires every mutation to be traceable to an authenticated principal. Self-registration would require an unauthenticated code path in the syscall dispatcher, which breaks the authorization model.

IdP identities avoid this problem because auto-provisioning happens inside the kernel's authentication layer, before the authorization check — the kernel trusts the IdP and creates the identity as part of resolving the credential. Key identities have no external trust anchor, so they need an already-trusted sponsor.

### 11.9 Why contexts are deferred

The common case is "one instance, one identity" or "one identity across instances." Adding a context concept (kubectl-style named `(instance, identity)` tuples) is justified only when a user has two identities on one instance or needs to bundle per-endpoint overrides. Until that use case is demonstrated, `active instance + --as <identity>` is enough.

### 11.10 Why stateless mode exists

CI runners, ephemeral containers, and scripts often cannot or should not write to `~/.astrale/`. Stateless mode (`--instance <url> --key <file>` / `--token <token>` / `--client-credentials`) lets the CLI be used without any on-disk state. It is the same code path as persistent mode, just without the storage.

### 11.11 Why `audience` is instance-scoped, not IdP-scoped

OAuth `audience` identifies *the resource a token is intended for*, not the authority that issued it. One IdP can legitimately issue tokens for many resources — a single WorkOS tenant can produce tokens for `kernel-prod` and `kernel-staging`, which are different audiences but share the same authentication authority.

Putting `audience` in `client.json` would lock each IdP config to one audience, forcing users to maintain duplicate IdP entries per target instance. Putting it in `instances.json` matches the actual semantics: each instance declares what audience it expects, and `login` resolves that audience when requesting a token from any IdP. The `--audience` flag exists as an explicit override for edge cases.

### 11.12 Why built-in IdPs are first-class

Users of the Astrale-hosted product should experience zero configuration friction. Shipping `astrale-default` as a built-in IdP means `astrale login` Just Works on a fresh install. Self-hosters add their own IdPs alongside without special-casing.

---

## 12. Deferred to post-v1

These are intentionally out of scope for the first implementation of this design. Each has a clear trigger for when it should be added.

### 12.1 Contexts (named `(instance, identity)` tuples)

**Trigger:** first user request for "two identities on one instance" or "two different endpoints with different identities I switch between fast."

**Shape:** `astrale context create <name> --instance <i> --identity <d>`, `astrale context use <name>`, `contexts.json` at the root.

### 12.2 HSM / hardware-backed keys

**Trigger:** enterprise customer requirement for keys that never touch disk.

**Shape:** extension to `source` field (e.g., `source: "pkcs11"`, `source: "yubikey"`) with a handler interface for each backend.

### 12.3 Federated identities across kernels

**Trigger:** multi-tenant or multi-region deployments where one identity should be valid on many kernels without per-kernel registration.

**Shape:** kernel-side federation between trusted kernels — a deployment concern, not a CLI one. CLI impact is minimal (`identity list` shows federated status).

### 12.4 Encrypted identity bundles for migration

**Trigger:** users asking for a standard way to move identities between machines.

**Shape:** `astrale identity export <name> --bundle --passphrase` producing an encrypted tarball; `astrale identity import-bundle <file.tar>` on the other side.

### 12.5 IdP groups and role claims

**Trigger:** requirement to map IdP group membership to kernel permissions automatically.

**Shape:** kernel-side claim mapping in trusted issuers config, surfaced read-only by `whoami --verbose`.

### 12.6 Multi-factor for `key`-source operations

**Trigger:** security requirement for requiring a second factor before signing certain operations locally.

**Shape:** `identities/<name>/mfa.json` configuring a second factor; `call` prompts when the operation matches a sensitive pattern.

### 12.7 Key expiration and scheduled rotation

**Trigger:** compliance requirement for mandatory key rotation intervals.

**Shape:** `expires_at` field on `key` identities; `rotate` auto-prompts when expiring soon; kernel-side policy can reject expired keys.

### 12.8 Graph-backed auto-provisioning

**Trigger:** deploying against the real graph backend (FalkorDB/Cypher) rather than the in-memory adapter.

**Current state:** the provisioning infrastructure (policy evaluator, trust store, provisioning store) is fully implemented in the runtime, and the in-memory adapter provisions identities correctly. The Cypher `CypherIdentityStore.provisionIdentity()` is a stub that returns `null` — graph-backed provisioning requires creating nodes + composition edges + permission structure, not just a bare node. Until this is implemented, IdP auto-provisioning only works against the in-memory backend.

**Shape:** implement `CypherIdentityStore.provisionIdentity()` to create an identity node in the graph with the correct class, parent edges, and initial permission structure. The provisioning policy evaluator and trust store are already wired up — only the graph write path is missing.

---

## Appendix A — Quick reference

### Full top-level command listing

```
astrale server   init | start | stop | restart | status | reset | uninstall | logs
astrale instance add | list | remove | inspect | use
astrale idp      add | list | show | refresh | remove
astrale identity generate | import | list | show | export | delete | rename
astrale login    --idp <name> [--instance <i>] [--name <n>] [--device] [--client-credentials] [--verify]
astrale logout   [<name>] [--revoke-at-idp]
astrale call     <method> [params] [--instance <i>] [--as <id>] [--data <json>]
astrale get      <path> [--instance <i>] [--as <id>]
astrale ls       <path> [--instance <i>] [--as <id>]
astrale query    <cypher> [--instance <i>] [--as <id>]
astrale events   [--tail] [-n N] [--topic P] [--since T] [--instance <i>]
astrale whoami   [--verbose]
astrale status
astrale version
```

Identity management operations (extend, constrain, exclude, grantPerm, revokePerm, etc.) are kernel syscalls on `/kernel.astrale.ai/Identity/…` invoked via `astrale call`. Registration of key identities requires a privileged caller (see §6.4 Path B). IdP identities are auto-provisioned — no explicit registration needed (see §6.4 Path A, §8.3).

### Directory quick reference

```
~/.astrale/
  config.json          # active instance, global prefs
  instances.json       # endpoint registry
  identities/<name>/   # per-identity keyring entries (source: key or idp)
  idps/<name>/         # per-IdP OIDC config (metadata.json + client.json)
  idps/index.json      # IdP enumeration
  server/              # local server state (server-only; absent on client-only machines)
```

### JWT issuer → verifier dispatch

```
iss = <external IdP URL>                     → kernel fetches JWKS via OIDC discovery; auto-provisions if trusted
iss = <kernelIssuer>/iss/<thumbprint>        → kernel uses the key published at registration
iss = <kernelIssuer>                         → kernel-internal identities
iss = anything else                          → rejected
```
