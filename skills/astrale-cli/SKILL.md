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
- Runtime: Node 22 or newer; source development uses Node 24 and Bun
- Dev entrypoint: `bun cli/bin/astrale.ts <command>`

## Command Surface

Primary commands:

```bash
astrale status
astrale whoami
astrale use <name>
astrale get <target>
astrale describe <target>
astrale ls <source> --edge <class>
astrale query [sources...]
astrale mutate
astrale call <path> [key=value...]
astrale token
astrale logs
astrale view [target-or-view]
astrale instance ...
astrale domain ...
astrale identity ...
astrale auth ...
astrale idp ...
astrale admin ...
```

Kernel-touching commands share `--format`, `--json`, `--raw`, `--url`,
`-i/--instance`, `--timeout`, `--as`, `--creds`, `--anonymous`, and `--debug` where
applicable. The CLI creates one public Kernel `Call`, and its Host session owns
remote routing, fresh credentials, and one safe stale-route retry.

Use `--anonymous` to omit a caller credential even when a local or bookmark-default identity exists.
It cannot be combined with `--as` or `--creds`; required callables reject anonymous requests.

## Paths

Use canonical Kernel V2 Paths:

| Form | Example |
|---|---|
| Domain root | `/:notes.example.dev` |
| Class or Interface | `/:notes.example.dev:class.Note` |
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
astrale instance use my-app
astrale instance bookmark staging --url https://kernel.example.com
astrale instance forget staging
```

Use explicit `-i <instance>` in scripts. `instance delete` affects an
admin-managed instance; `instance forget` removes only the local bookmark.

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
```

A deployment-only Publication change does not inherently require reinstalling
the Domain. Reinstall or run a schema plan only when installation/schema intent
actually changes.

## Identity And Delegation

`astrale auth login` stores an IdP-backed identity. `astrale identity create`
creates a local key identity. Registering a key identity on a Kernel is an
atomic V2 provision operation and requires the exact Node Class:

```bash
astrale identity create alice
astrale identity register alice \
  --class /:accounts.example:class.User \
  --props '{"accounts.example:class.User.property.name":"Alice"}' \
  -i staging
```

There is no caller-chosen storage `--path`: Kernel V2 Node IDs are opaque. The
proof is bound to the exact provision fingerprint and target Kernel audience.
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

`astrale token` delegates the selected authenticated identity. TTL defaults to
3600 seconds; audience defaults to the target Kernel issuer. Use `--audience`
for a different receiving service and `--raw` for shell assignment.

```bash
TOKEN=$(astrale token --raw -i staging)
astrale call /:notes.example:class.Note:list --creds "$TOKEN" -i staging
```

`astrale auth token` is different: it prints the cached upstream IdP token.

## Graph Reads

### `get` and `describe`

`get` reads one exact canonical Node:

```json
{ "id": "opaque-id", "class": "/:notes.example:class.Note", "props": {} }
```

Nodes do not carry synthetic `path`, `__labels`, or backend `classId` fields.
`describe` presents the same admitted facts and can omit schema-valued
properties with `--no-schema`; it does not infer operations or children.

```bash
astrale get @note --json
astrale describe /:notes.example:class.Note --no-schema
```

### `query`

`query` executes canonical `astrale.graph.query/v3`. Its result is
`{ graph: { nodes, edges }, cursor? }`.

- Positional Paths create Path source terms.
- `--definition <path>` selects Nodes implementing one exact Class or
  Interface.
- `--edge <class>` adds one exact expansion; direction is `outgoing`,
  `incoming`, or `incident`.
- `--limit` is finite and defaults to 100.
- `--cursor` resumes the same caller-bound query scope.
- `--ast` and `--file` admit a complete canonical Query V3 document.

```bash
astrale query /:notes.example:class.Note --limit 50 --json
astrale query --definition /:notes.example:class.Note --limit 50 --json
astrale query @note \
  --edge /:notes.example:class.references \
  --direction outgoing --limit 25 --json
astrale query --file query.v3.json --cursor "$CURSOR"
```

Raw Cypher, recursive depth, and historical children/edges selector JSON are
not portable Kernel V2 contracts and are not accepted.

### `ls`

Kernel V2 has no universal parent/child edge, so `ls` keeps the familiar name
but requires the relation explicitly:

```bash
astrale ls @note --edge /:notes.example:class.references
astrale ls @note --edge /:notes.example:class.references -q
```

`-l` prints complete canonical Nodes, `-q` prints one `@id` per line, and
`--count` prints only the returned count. There is no generic recursive mode.

## Mutations

`astrale mutate` accepts canonical `astrale.graph.mutation/v2` or its exact
`{ preconditions, operations }` authoring input from `--data`, `--file`, or
stdin. The transition is atomic. `--dry` admits and prints the canonical
document without opening a Kernel connection.

```bash
astrale mutate --file mutation.v2.json
astrale mutate --data '{"preconditions":[],"operations":[]}' --dry
```

The result is `{ createdNodes }`. Historical PatchData arms and
`createdEdges` are not emulated.

## Calls

`astrale call` creates one Path-targeted Call. Input priority is `--data`,
piped stdin, `key=value`, then `{}`. `--describe` reads the callable Node
without invoking it; `--dry-run` prints the call input. Value, binary, and
stream results are handled explicitly, and `--output` writes binary data.

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
`{ records, cursor? }`. Filters are exact, not legacy glob lowering:

```bash
astrale logs -i staging --limit 50
astrale logs --topic op:function.failed
astrale logs --topic-prefix op:function. --follow
```

Use `--principal`, `--since`, `--until`, or an opaque `--cursor` as needed.
`--follow` retains one Host session and advances only with returned cursors.
Application-service console buffers are not part of this command.

## Views And Browser Sessions

`astrale view` opens one resolved View through an emulated Host shell:

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
- `--json` is always valid JSON.
- `--raw` unwraps scalars and writes raw binary bytes.
- `--format yaml|json` selects structured rendering.
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
callable input/output shape, use `astrale call <path> --describe`.

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
