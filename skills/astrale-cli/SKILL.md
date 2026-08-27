---
name: astrale-cli
description: Reference for the Astrale CLI (binary `astrale`, package `@astrale-os/cli`) - setup, graph reads and mutations, kernel calls, instances, domains, identities, delegation, journals, views, output, debugging, and local storage.
---

# Astrale CLI

`astrale` connects to existing Astrale Kernels. It selects an instance and
identity, performs graph reads and mutations, invokes callables, installs
running domains, reads the Kernel journal, and opens authenticated views.

The rendered command help is authoritative for flags and defaults:

```bash
astrale --help
astrale <command> --help
```

- Binary: `astrale`
- Package: `@astrale-os/cli`
- Runtime: Node 22 or newer; source development defaults to Node 26 and also supports Node 24 and Bun
- Dev entrypoint: `bun cli/bin/astrale.ts <command>`

## Command Surface

Primary commands:

```bash
astrale status
astrale whoami
astrale use <name>
astrale get <target>
astrale query [sources...]
astrale introspect <origin-or-path>
astrale mutate
astrale call <path> [key=value...]
astrale token
astrale logs
astrale view [target-or-view]
astrale ui ...
astrale instance ...
astrale domain ...
astrale identity ...
astrale auth ...
astrale idp ...
astrale admin ...
```

Kernel-touching commands share `--format`, `--json`, `--raw`, `--url`,
`-i/--instance`, `--timeout`, `--as`, `--creds`, `--anonymous`, and `--debug` where
applicable. The CLI creates one public Kernel `Call`, and its Client session owns
remote routing, fresh credentials, and one safe stale-route retry.

`astrale ui` is local project tooling and never takes Kernel, instance, identity,
or credential options.

Use `--anonymous` to omit a caller credential even when a local or bookmark-default identity exists.
It cannot be combined with `--as` or `--creds`; required callables reject anonymous requests.

## UI Projects

Astrale UI is one tree-shakeable runtime package plus consumer-owned pattern,
block, and theme source. Initialize a React and Tailwind CSS v4 project with the exact
published UI release:

```bash
astrale ui init --preset astrale
astrale ui list chart
astrale ui add pattern/chart/line-basic
astrale ui add theme/observatory
astrale ui add ./my-playground-export.css
astrale ui doctor
astrale ui doctor --project ./apps/web
astrale ui preset apply compact
```

Initialization writes Base UI + Nova shadcn configuration, theme and preset CSS
imports, and `astrale-ui.lock.json`. The lock records the exact package version,
Git tag, resolved commit SHA, shadcn version, Base UI version, preset, and hashes
of installed source. Registry metadata, included manifests, and item files are
always read from that single commit snapshot.

Run `astrale ui add` without item arguments for an interactive picker. In CI,
provide canonical addresses explicitly. Ordinary add refuses locally edited
installed files; review those files, then use `--overwrite --yes` only when
replacement is intentional. `--dry-run` leaves project files and the lock
unchanged. Use `astrale ui list --json` when registry metadata is needed by a
script or agent.

Patterns, blocks, and themes are application-owned source after installation. A
theme is copied to `components/astrale/theme/` and activated through one relative
import in the configured host stylesheet; local playground exports require no
registry fetch or shadcn invocation. Composition root
`className`, inline `style`, controlled values/actions, and stable `data-slot`
anatomy remain open to the host. The package owns reusable runtime behavior;
neither the CLI nor the SDK embeds the UI package or Base UI.

## Paths

Use canonical Kernel Paths:

| Form | Example |
|---|---|
| Domain root | `/:notes.example.dev` |
| Class | `/:notes.example.dev:class.Note` |
| Static callable | `/:notes.example.dev:class.Note:list` |
| Instance callable | `@node-id::archive` |
| Node ID | `@node-id` |
| Active caller shorthand | `@self` |

Static dispatch uses one colon before the method. Instance dispatch uses `::`.
`@self` is expanded by the CLI before signing when it appears at the head of a
call Path or a bare `key=@self` value. It is not rewritten inside `--data`,
stdin JSON, URLs, or arbitrary substrings.

```bash
astrale get @self --json
astrale call /:blog.example:class.Author:list limit=10
astrale call @self::deactivate
```

## Instances And Domains

`astrale instance` combines admin-provisioned instances and local bookmarks:

```bash
astrale instance create my-app
astrale instance status my-app
astrale instance status staging --bookmarked
astrale instance use my-app
astrale instance bookmark staging --url https://kernel.example.com
astrale instance forget staging
```

Use explicit `-i <instance>` in scripts. `instance delete` affects an
admin-managed instance; `instance forget` removes only the local bookmark.
`instance status` reports Admin-owned lifecycle by default; add `--bookmarked`
to probe one local bookmark's exact issuer, JWKS, and TLS trust instead.
Without a deployed Admin Domain, `astrale instance list` cannot fetch managed
instances (key-backed identities have no Admin token). Use
`astrale instance list --bookmarked`.

The CLI is connect-only: it does not build or run domains. The SDK's
`astrale-domain` binary owns `dev`, `prod`, `build`, and deploy workflows.

`astrale domain install` has two modes:

- Default: install a published catalog origin or URL through the admin control
  plane onto an admin-managed instance.
- `--direct`: call the public Kernel install syscall with a running domain URL.
  This works for any instance you can authenticate to and owns the explicit
  identity-override consent prompt.

```bash
astrale domain install crm.example -i staging
astrale domain install https://crm.example --direct -i staging
astrale domain uninstall crm.example -i staging
```

A replacement cannot change an installed Domain issuer. If that identity
change is intentional, uninstall the origin first and then install it again.
Uninstall removes the installed Domain but never deletes business data. It
requires typing the exact origin interactively (or `--yes` in automation), and
is refused by the Kernel while dependents or business data remain.

Bookmarks retain their own TLS trust (`--ca`). `instance use` probes OIDC and
JWKS with that exact CA. If two bookmarks point to the same normalized URL with
different CA settings, the CLI warns and `instance list --bookmarked --json`
shows each bookmark's `caFile`, issuer, and default identity.

A deployment-only Publication change does not require reinstalling the Domain.
Reinstall only when installation or Schema intent changes.

## Identity And Delegation

`astrale auth login` stores an IdP-backed identity. `astrale identity create`
creates a local key identity. Registering a key identity on a Kernel is an
atomic provision operation and requires the exact Node Class. Registration
never creates or replaces the local identity or its keypair:

```bash
astrale identity create alice
astrale identity register alice \
  --class /:accounts.example:class.User \
  --props '{"accounts.example:class.User.property.name":"Alice"}' \
  -i staging
```

The Kernel assigns Node IDs. They are returned by reads and creation results
and can be reused through the `@node-id` Path form; do not derive application
meaning from their contents. The proof is bound to the exact provision
fingerprint and target Kernel audience.
For an application-owned Identity Class, direct Kernel submission is correctly
denied unless the caller owns that Class. Name the Domain's authorizing
registration callable explicitly; the CLI sends the same self-proven request
through it and stores only the admitted target-bound result:

```bash
astrale identity register operator \
  --class /:operations.example:class.Operator \
  --props '{"operations.example:class.Operator.property.name":"Operator"}' \
  --via /:operations.example:function.provisionOperator \
  -i staging
```

`astrale token` issues an audience-bound credential for the selected authenticated identity. When
the audience is the target Kernel issuer (the default), it mints a top-level Grant credential that
can be reused with `--creds`. A different `--audience` creates a delegated service envelope for that
receiver instead. TTL defaults to 240 seconds so it remains below the five-minute local key proof;
an explicit TTL still cannot outlive the selected source credential. Use `--raw` for shell
assignment.

```bash
TOKEN=$(astrale token --raw -i staging)
astrale call /:notes.example:class.Note:list --creds "$TOKEN" -i staging
```

`astrale auth token` is different: it prints the cached upstream IdP token.

## Graph Reads

### `get`

`get` reads one exact canonical Node:

```json
{ "id": "node-id", "class": "/:notes.example:class.Note", "props": {} }
```

The structured Node result is exactly `{ id, class, props }`.

```bash
astrale get @note --json
astrale get /:notes.example:class.Note
astrale get /:kernel.astrale.ai --schema
```

Method Paths identify callables rather than Nodes; use `call` to invoke them or
`introspect` to inspect their Schema. Schema-valued properties are omitted
unless `--schema` is passed.

### `introspect`

`introspect` reads the Kernel Schema syscall for one installed Domain.

```bash
astrale introspect kernel.astrale.ai
astrale introspect /:kernel.astrale.ai --bundle
astrale introspect /:kernel.astrale.ai:class.Identity:whois
```

A method or Function Path projects that callable's input/output from the
installed bundle.

### `query`

`query` executes canonical `astrale.graph.query/v6`. Its structured result is
`{ kind: "graph", graph: { nodes, edges }, page?: { next } }`; pass the opaque
`page.next` value to `--cursor` until it is absent.

- Positional Paths create Path source terms.
- `--class <path>` selects Nodes implementing one exact Class.
- `--edge <class>` adds one exact expansion; direction is `outgoing`,
  `incoming`, or `incident`.
- `--limit` is finite and defaults to 100.
- `--cursor` resumes the same caller-bound query scope.
- `--ast` and `--file` admit a complete canonical Query V6 document.

```bash
astrale query /:notes.example:class.Note --limit 50 --json
astrale query --class /:notes.example:class.Note --limit 50 --json
astrale query @note \
  --edge /:notes.example:class.references \
  --direction outgoing --limit 25 --json
astrale query --file query.v6.json --cursor "$CURSOR"
```

Use `query` with `--edge` for an exact neighborhood.

## Mutations

`astrale mutate` accepts canonical `astrale.graph.mutation/v3` or its exact
`{ preconditions, operations }` authoring input from `--data`, `--file`, or
stdin. The transition is atomic. `--dry` admits and prints the canonical
document without opening a Kernel connection. The result is `{ createdNodes }`.

```bash
astrale mutate --file mutation.v3.json --dry
astrale mutate --file mutation.v3.json
```

## Calls

`astrale call` creates one Path-targeted Call. Input priority is `--data`,
piped stdin, `key=value`, then `{}`. `--dry-run` admits the Path and prints
the call input. Value, binary, and stream results are handled explicitly, and
`--output` writes binary data. A streaming binary is drained with backpressure
while the command-scoped Client session is live, then presented through the same
raw/file/JSON paths as buffered binary. JSON preserves application status and
encodes the body as text or base64. Callable input/output is
`astrale introspect <path>`.

```bash
astrale call /:blog.example:class.Author:list limit=10
astrale call /:blog.example:class.Author:create \
  --data '{"name":"Ada"}' --json
astrale call /:assets.example:class.Asset:render id=123 --output asset.png
```

Top-level `key=value` values coerce booleans, null, numbers, arrays, and
objects. Use `--data` for nested or digits-only string values.

## Journal

`astrale logs` reads the public Kernel journal syscall and returns
`{ records, cursor? }`. Filters match exact values; use `--topic-prefix` for
prefix matching:

```bash
astrale logs -i staging --limit 50
astrale logs --topic op:function.failed
astrale logs --topic-prefix op:function. --follow
```

Use `--principal`, `--since`, `--until`, or an opaque `--cursor` as needed.
`--follow` retains one Client session and advances only with returned cursors.
Structured output retains the admitted `correlation` object, including invocation root and
parent identifiers, and includes `correlationId` as a projection of `invocationId`.
With `--json`, `--follow` emits NDJSON with one complete admitted record per line; combining
`--yaml` with `--follow` is rejected.

## Views And Browser Sessions

`astrale view` opens one resolved View through a local browser shell:

```bash
astrale view @customer --list
astrale view @customer --snapshot
astrale view /:crm.example:view.dashboard --target @customer
astrale view --sessions
astrale view --close <session-id>
```

`astrale browser` prepares a persistent authenticated GUI browser profile.
Use `astrale browser --check` to verify it, then drive the printed profile with
`agent-browser`.

## Output And Automation

- TTY defaults are human-readable.
- `--json` emits one JSON document for finite commands; `logs --follow` emits an NDJSON stream.
- `--raw` unwraps scalars and writes raw binary bytes.
- `--format yaml|json` selects finite structured rendering; `logs --follow` supports JSON/NDJSON only.
- Use `--ci --no-prompt` for automation.
- Use explicit `-i`, `--as`, and `--timeout` rather than ambient state.
- Pipe large JSON through stdin; command-line argument size is limited by the
  operating system.

## Debugging

Start with:

```bash
astrale status
astrale instance active
astrale auth status
astrale whoami
```

Add `--debug` for full Kernel error diagnostics. A missing and an
authorization-masked graph Node may intentionally be indistinguishable. For
callable input/output shape, use `astrale introspect <path>`.

## Storage

State lives under `ASTRALE_HOME`, or `~/.astrale` by default:

```text
config.json
instances.json
identities.json
idps/
idp-sessions/
keys/
browser.json
browser/
```

Optional roots are `ASTRALE_HOME`, `ASTRALE_KEYS_DIR`, and
`ASTRALE_DATA_DIR`.

## Source Map

- Entry: `cli/bin/astrale.ts`
- Program and shared options: `cli/src/program/`
- Public Kernel connection boundary: `cli/src/connection/`
- Query/Mutation document preparation: `cli/src/graph/`
- Commands: `cli/src/commands/`
- Shared presentation and local stores: `cli/src/lib/`
- Studio bridge: `cli/studio/server/`
- Tests: owner-local `__tests__/` directories
