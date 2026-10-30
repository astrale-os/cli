---
name: astrale-cli
description: Reference for the standalone Astrale CLI (`astrale`) - setup, graph reads and mutations, kernel calls, instances, domains, identities, delegation, journals, views, output, debugging, and local storage.
---

# Astrale CLI

`astrale` targets existing Kernels: instance and identity selection, graph reads and mutations,
callable invocation, Domain installation, the Kernel journal, authenticated Views. It never builds
or runs Domains: the SDK's `astrale-domain` binary owns `build`, `deploy`, `publish`, `diff`,
`yank`, `list`, `lint`, `package` and tests.

`astrale --help` and `astrale <command> --help` are authoritative for flags and defaults.

- Standalone executable embedding its Bun runtime: needs no Node, npm or Bun. No npm distribution.
- Source development: the repository's pinned toolchain; dev entry `bun cli/bin/astrale.ts <command>`.

## Command Surface

```bash
astrale status
astrale whoami
astrale use <name>
astrale get <target>
astrale download <node> <property> -o <file>
astrale query [sources...]
astrale introspect <origin-or-path>
astrale mutate
astrale call <path> [key=value...]
astrale execution ...
astrale token
astrale logs
astrale view [domain-or-view]
astrale ui ...
astrale instance ...
astrale domain ...
astrale identity ...
astrale auth ...
astrale idp ...
astrale admin ...
astrale issue "Title" --body "Context and details"
```

- Shared Kernel options, where applicable: `--format`, `--json`, `--raw`, `--url`, `-i/--instance`,
  `--timeout`, `--as`, `--creds`, `--anonymous`, `--debug`. A command creates one public Kernel
  `Call`; its Client session owns remote routing, fresh credentials and one safe stale-route retry.
- `--anonymous` omits the caller credential even when a local or bookmark-default identity exists;
  it excludes `--as` and `--creds`; an `authenticated` or `authorized` callable refuses it.
- `astrale ui` is local project tooling without Kernel, instance, identity or credential options,
  except `astrale ui request`, an authenticated Kernel command with the shared options.

## Report an issue

Report unprompted when both hold:

- it blocks the task, cost significant time, or forced an unsatisfactory workaround;
- the evidence places the cause in Astrale (CLI, SDK, Kernel, Admin, a native Domain), not the
  project: a minimal reproduction, or Astrale contradicting its own docs, help or errors.

Never for your own code or configuration error, or a correct refusal. Once per problem
(`astrale issue list` shows your reports); give the user the printed reference and continue with
the workaround if one exists.

```sh
astrale issue "Factual title" --body "$BODY"   # or pipe the body on stdin
```

- Add `--project <directory>` and `-i <affected instance>` when known; never ask for them. Local
  versions are attached automatically. Redact credentials, tokens, keys and customer data.
- Needs an account with access to Admin (a Console account).
- Only `ISSUE_NOT_CONFIRMED` (outcome unknown) keeps the request: run the printed `--retry`
  command. Any other error is a refusal naming its code and failing input: fix it and report again;
  if the report cannot be sent, give the user the drafted issue.
- Title: the observed fact, at most 100 characters, not a request: "`domain install` fails with 5000
  on a published release", not "Fix domain install".

Body, one field per line, `none` when empty:

```text
Type: bug | limitation | friction
Context: goal, command or callable, Domain, instance.
Scenario:
1. exact command or input
2. …
Observed: what happened, with the error code and message.
Expected: what should happen; for a bug, the doc or help that says so.
Impact: what it blocks or costs.
Workaround: what you did instead.
Evidence: request id, short log excerpt or stack trace.
```

| Type | Use when |
| --- | --- |
| `bug` | Astrale contradicts its docs, help, error contract, or an earlier version. |
| `limitation` | Astrale works as designed but cannot do what the task needs, including capability requests. |
| `friction` | The task succeeds, but the path is needlessly hard: misleading error, missing doc, extra steps. |

The report prints its reference (`ASTRALE-12`). The reporter sees and changes only its own reports;
status, priority and comments belong to triage.

```sh
astrale issue list --json                              # archived ones only with --all
astrale issue show ASTRALE-12
astrale issue edit ASTRALE-12 --body "Updated details" # --title, --body (replaces), or both
astrale issue archive ASTRALE-12                       # withdraws it; triage keeps its history
```

## UI Projects

One tree-shakeable runtime package plus consumer-owned pattern, block and theme source, for React
and Tailwind CSS v4, initialized at the exact published UI release:

```bash
astrale ui init --preset astrale
astrale ui search "editable chart with export"
astrale ui request "accessible async combobox with creation"
astrale ui add pattern/chart/line-basic
astrale ui add theme/observatory
astrale ui add ./my-playground-export.css
astrale ui doctor
astrale ui doctor --project ./apps/web
astrale ui preset apply compact
```

- `init` writes Base UI + Nova shadcn configuration, theme and preset CSS imports, and
  `astrale-ui.lock.json`: exact package version, Git tag, resolved commit SHA, shadcn and Base UI
  versions, preset, hashes of installed source. Registry metadata, manifests and item files are
  always read from that one commit.
- `add` without items opens an interactive picker; CI passes canonical addresses. It refuses
  locally edited installed files: `--overwrite --yes` only for an intended replacement.
  `--dry-run` changes neither project files nor the lock.
- `search <text> --json`: a short ranked candidate list with exact demo code and its `command` or
  runtime `packageImport`.
- `request <text>`, when search does not satisfy the need: calls `/:ui.astrale.ai:function.request`
  on the selected instance with one intent of 1–512 characters and prints the receipt
  `{ state: "submitted", requestId, collaborationUrl }` or
  `{ state: "pending" | "outcome-unknown" | "failed" | "conflict", requestId }`.
- Installed patterns, blocks and themes are application-owned source. A theme is copied to
  `components/astrale/theme/` and activated by one relative import in the configured host
  stylesheet; a local playground export needs no registry fetch or shadcn invocation. Root
  `className`, inline `style`, controlled values/actions and stable `data-slot` anatomy stay open
  to the host. The package owns reusable runtime behavior; neither the CLI nor the SDK embeds it or
  Base UI.

## Paths

| Form                    | Example                                                 |
| ----------------------- | ------------------------------------------------------- |
| Domain root             | `/:notes.example.dev`                                   |
| Class                   | `/:notes.example.dev:class.Note`                        |
| Static callable         | `/:notes.example.dev:class.Note:list`                   |
| Instance callable       | `@node-id::notes.example.dev:class.Note.method.archive` |
| Node ID                 | `@node-id`                                              |
| Active caller shorthand | `@self`                                                 |

- Static dispatch: one `:` before the method. Instance dispatch: `::` and the complete
  Domain-qualified Method key.
- `astrale introspect <origin> --bundle` lists methods. Introspection accepts a Class receiver for
  an instance contract; calling needs an observed instance Path.
- `@self` is expanded before signing only at the head of a call Path or as a bare `key=@self`
  value; never inside `--data`, stdin JSON, URLs or substrings.

```bash
astrale get @self --json
astrale introspect /:notes.example:class.Note::notes.example:class.Note.method.archive
astrale call /:blog.example:class.Author:list limit=10
astrale call /:admin.astrale.ai:class.Instance:list --admin
```

## Instances And Domains

### Instances

`astrale instance` combines Admin-provisioned instances and local bookmarks:

```bash
astrale instance create my-app
astrale instance root import development --yes
astrale instance invite my-app person@example.com
astrale instance invitation status @invitation-id
astrale instance status my-app
astrale instance status staging --bookmarked
astrale instance list --include-retired --admin-only --json
astrale instance use my-app
astrale instance bookmark staging --url https://kernel.example.com
astrale instance forget staging
```

- `-i` and `--url` select the instance a command acts on, never the Admin kernel; Admin operations
  (`instance list`, …) refuse them. Admin kernel: `--admin <bookmark>` or `--admin-url <url>`.
  Scripts pass `-i` explicitly. `domain list -i <instance>` lists that instance; without `-i` or
  `--url`, the active one.
- `instance delete`: the Admin-managed Instance, plus the matching `<slug>-root` identity and
  unshared key, even with `--keep-bookmark`; retained credentials and cleanup errors are reported.
  `instance forget`: the local bookmark only.
- `instance list`: Instances you own or were invited into, in every Fleet. `--fleet <path>` keeps
  one Fleet, with its whole inventory when you administer it. Fleet administrators add
  `--include-retired`: retired tombstones in the same shape, terminal `state: "deleted"` (excluded
  by default). `issuer` appears only when Admin retained exact evidence. Unreachable ≠ retired.
  `--admin-only` omits local bookmarks from the JSON envelope. `--fleet` and `--include-retired`
  are refused with `--bookmarked`.
- Without a deployed Admin Domain, `instance list` cannot fetch managed instances (a key-backed
  identity has no Admin token): `instance list --bookmarked`.
- `instance status`: Admin-owned lifecycle; `--bookmarked` probes one bookmark's exact issuer, JWKS
  and TLS trust instead.
- A bookmark keeps its own TLS trust (`--ca`); `instance use` probes OIDC and JWKS with that CA.
  Two bookmarks on one normalized URL with different CAs: a warning;
  `instance list --bookmarked --json` shows each `caFile`, issuer and default identity.

Creation:

- `instance create` provisions through the Admin Domain with a WorkOS caller; Admin owns Host
  placement. An existing active target is kept, a concurrent selection included; with none, it
  selects the new instance after verifying owner access. It never repoints a bookmark to another
  endpoint: on conflict it keeps the ready receipt and verified access, reports
  `bookmark.status=pending` with a recovery command under an unused name, and skips automatic root
  import. Switch with `instance use <name>`.
- Automatic root recovery starts only after verified access and completed bookmarking, and replaces
  a root alias only for the same exact issuer claim. Explicit root import keeps its own recovery
  contract. Neither `instance create` nor `instance root import` accepts `--host`.
- `INSTANCE_CAPACITY_UNAVAILABLE`: the Fleet has no ready consumer Host; the creation operation
  fails. A Fleet administrator provisions one (`Fleet.provisionHost`); rerun `instance create`
  without `--operation` (replaying the failed one returns the same refusal).

Root import:

- `instance root import <slug-or-id>` retrieves the owned Instance's root signing identity through
  Admin over an end-to-end encrypted one-use transfer and imports it as `<slug>-root` (not the Admin
  or Host root). `--admin <bookmark>` / `--admin-url <url>` select another Admin. Recovery needs
  `--yes` in automation, replaces a key-backed identity of that name, and refuses to overwrite an
  IdP-backed one.
- It keeps the active instance and the human Admin identity as the bookmark's default: select the
  root with `--as`. Run the import as an authorized human identity. Root success proves execution,
  not an application user's access Policy.

```bash
astrale instance root import development --yes
astrale get @self -i development --as development-root --json
```

Invitations:

- `instance invite` needs authority to manage that exact Instance, grants only Instance member
  access and returns the durable Invitation at once. WorkOS acceptance grants nothing: when the
  recipient signs in from the invitation link, Admin registers the child Shell user with the
  recipient's own credential, then adds Instance membership.
- `instance invitation status <id>`: one read-only observation of the exact Invitation. `user` is
  the Shell User reserved on the Instance, which an Instance administrator can assign to Core
  `admin` (astrale-domain `references/users.md`). Only `completed` means access is materialized;
  `accepted`, `registering`, `registered` are intermediate.
- `instance invitation reconcile <id>`: diagnostic recovery, not the normal invitation journey.

### Domains

A deploy never installs: each deployment URL serves one release for good, and only
`astrale domain install` changes what an instance runs (reinstalling the running release changes
nothing). Project Environments name no instance and ignore the CLI's active instance.

```text
domain install <ref>... [-i <instance>] [--allow-issuer-change[=<origin>]] [--revoke-previous]
               [--mode online|maintenance] [--operation <id>] [--timeout <ms>] [--no-wait]
<ref> = https://… | http://… (local Host)   a deployment URL
      | <origin>@1.5.0 | <origin>@2.0.0-rc.1  exactly that version, pre-release or yanked included
      | <origin>@1.5                           the highest stable 1.5.x that is not yanked
        refused: a major alone (@1), a range, build metadata
domain uninstall <origin>... [--destructive] [--yes] [--operation <id>] [--no-wait]
```

- Versions resolve in the Admin registry under your own identity; a private Domain needs
  `domain_installer` or `domain_admin`, directly or through a Group.
- Install and uninstall are Kernel syscalls sent as you, decided by Kernel Roles, not by those Admin
  rights. Install: `domain.installer` plus the right to grant every Kernel Role membership the
  release requests (a scope toward a Kernel target needs Root). Uninstall: `domain.uninstaller` plus
  the right to revoke them. Root passes all; a release's Roles and scopes:
  [Policies](../astrale-domain/references/policies.md).
- Several references install in ONE atomic operation, URLs and versions mixed: every Domain moves
  or none does (dependent Domains move together). The CLI pins the release digest it read and
  verifies the installed pins once the install completed.
- An advisory pre-check reports installed Domains the change would break and proposes compatible
  published versions with the grouped command (`--json`: `precheck`). The install is still sent;
  the Kernel decides.
- An issuer change is never silent: `--allow-issuer-change` for a new deployment of the same line,
  `--allow-issuer-change=<origin>` for any other change, or type the origin at a terminal. The
  replaced issuer keeps serving its in-flight work; `--revoke-previous` cuts it at the activation.
- Uninstall removes the selected origins atomically. Safe mode (default) deletes nothing and is
  refused while their Classes hold facts; `--destructive` retires their Classes at the activation
  whatever their number of facts, then purges those facts (never an unselected Domain's). A
  surviving dependent blocks it, as does an Edge of a surviving Class whose lifetime restricts the
  deletion. Confirm at a terminal or pass `--yes`.

```bash
astrale domain install https://crm.example -i staging
astrale domain install https://projects.example https://teams.example -i staging
astrale domain install crm.example@1.5 -i production
astrale domain install <new-deployment-url> --allow-issuer-change -i staging
astrale domain uninstall crm.example -i staging
astrale domain uninstall app.example shared.example --destructive --yes -i staging
```

An install or uninstall is a durable Execution. The CLI waits up to `--timeout` (110 s by default;
`--no-wait` returns at once) and reports success only from a completed outcome. Never rerun it to
learn the outcome: `astrale execution status <execution>` or `result <execution> --wait`.

| Exit | Meaning |
| --- | --- |
| 0 | Completed, or still running when the wait ended (`--json`: `execution`, `status`, `follow`, `observe`, no `changed`). |
| 1 | Refused before any Execution (the operation is unused), cancelled, paused, or another error. |
| 2 | Ended `failed`, for example `DATA_MIGRATION_REQUIRED`. |
| 5 | Operation conflict, or another schema change holds the Instance (`SCHEMA_CHANGE_ACTIVE`). |
| 75 | A `result` read of an Execution that has not ended: try again later. |
| 130 | Interrupted: the Execution goes on. |

- `--operation <id>` (automation) replays only the exact same request (`--json`: `replayed: true`);
  any other request under a used id is refused, exit 5.
- Existing data the new schema refuses, maintenance repair sessions (`--mode maintenance`, then
  `domain installation apply|abort`) and destructive uninstalls:
  [schema evolution and data migration](../astrale-domain/references/migration.md).

`astrale domain versions <origin>`: published versions from the Admin registry, read with your own
credential (`domain_installer` or `domain_admin` on the Domain, directly or through a Group).

- Lists pre-releases and yanked versions; a line such as `@1.5` never selects a yanked one.
- Absent and unreadable Domains give the same `REGISTRY_DOMAIN_NOT_FOUND`.
- `--json`: one `astrale.registry-index` document; a refusal prints
  `{ "error": { "code", "message", "details" } }` on stdout, exit 1. Rerunning is always safe and
  helps only when `details.retryable` is `true`.

```bash
astrale domain versions issues.astrale.ai
astrale domain versions issues.astrale.ai --json --as ci
```

`astrale domain list` (active instance, `-i <instance>` or `--url <kernel>`): each installation
that instance's Kernel pins to a deployment you can read.

- Release digest from the Kernel pin. Version from the Admin registry: the one naming that exact
  release, else the one naming the same build from the same issuer (`1.5.0 · staging`); a build
  digest alone never names a version. Otherwise the preview name from the deployment's public
  record (`1.4.2 + 7 commits · a1b2c3d · staging`, printed as computed). Plus the highest stable
  version above it.
- Partial by nature: built-in, local and unreadable Domains never appear; an absent origin is
  unknown, not "not installed".
- The registry is read as you (`--as` or your default identity) on the Admin kernel; `--creds` and
  `--anonymous` apply to the instance only. `--json`: one `astrale.installed-list` document.

```bash
astrale domain list -i staging
astrale domain list -i staging --json
```

The hidden `astrale __domain-registry bundle|claim|publish|yank` commands are JSON plumbing for
`astrale-domain diff`, `publish` and `yank`; never call them by hand. `astrale-domain publish`
claims an unclaimed origin before its first deployment: its first claimer administers it.

## Identity And Delegation

- `identity import` admits a versioned IdentityExport V1 or V2 envelope, plaintext JSON or
  passphrase-encrypted compact JWE. `identity export` writes V2, which carries the identity's
  Kernel registrations: the import signs in wherever the original was registered; V1 imports none.
  An unversioned export is refused; never strip the version or invent identity metadata or
  registrations. Transfer options: `identity import|export --help`.
- `auth login` stores an IdP-backed identity; `identity create` a local key identity.
- `identity register` targets an existing Identity Node: it never creates a Node, changes business
  properties, assigns a Group, or replaces the local identity or keypair. It needs Kernel
  `identity.registrar` and update authority on that Node. `--via <callablePath>` names a Domain
  callable that supplies that authority; the CLI sends the same request and verifies the returned
  Node and Authentication. A caller that already has the authority needs no `--via`. The primary
  self credential is signed for the target Kernel audience.
- The Kernel assigns Node ids; reads and creation results return them, reusable as `@node-id`.
  Never derive application meaning from their contents.

```bash
astrale identity create alice
astrale identity register alice --node @existing-user-id -i staging
astrale identity register operator --node @existing-operator-id \
  --via /:operations.example:function.registerOperator -i staging
```

`astrale token [--audience <aud>] [--ttl <sec>] [--for <identity>]` (`--for` = `--as`):

- Audience = the target Kernel issuer (default): a top-level Kernel bearer credential for the
  selected identity, reusable with `--creds`. Any other `--audience`: a delegated service envelope
  for that receiver.
- TTL 240 s by default, below the one-hour local operator proof; never beyond the source
  credential's remaining life. `--raw` for shell assignment.
- `astrale auth token` differs: it prints the cached upstream IdP token.

```bash
TOKEN=$(astrale token --raw -i staging)
astrale query /:notes.example:class.Note --creds "$TOKEN" -i staging
```

Executor and caller:

- A minted token makes the identity both executor and caller: it acts for itself, the callable's
  Policy alone decides, no delegation ceiling applies.
- `call` without `--creds` exchanges the identity's credential at the callable's declaring Domain:
  the Domain is the executor, the identity the caller, and the Policy is evaluated against the
  identity.
- A Kernel syscall has no Domain to exchange through: every command presents the identity itself,
  admitted as a member of the syscall's Kernel Role: Query `graph.reader`, Mutation `graph.writer`,
  Download `blob.reader`, Journal `journal.reader`, Register `identity.registrar`, Install
  `domain.installer`. Membership = extending the Role (`extends_with`), directly or through an
  extended Identity such as a Group; Root holds every Role. Deprecated: a `can_use` Edge on the
  syscall, posed by a release in the legacy requirements shape, still admits its holder.

| Selection                                                    | Executor                        | Effect                                                                                                       |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `call` with `--as <identity>` or the default identity        | the callable's declaring Domain | the Domain's ownership meets the ceiling; the Policy is evaluated against the identity                       |
| `get`, `query`, `mutate` on any instance, the Admin included | the identity                    | `graph.reader` or `graph.writer` admits the syscall; each Class's Policies then decide, with no Domain scope |
| `--creds "$(astrale token --raw)"`                           | the identity                    | the callable's Policy alone decides; a Kernel syscall admits the members of its Kernel Role                  |

A minted token serves anything the identity may do itself; `call --as` presents the Domain's
credential, for a Domain that must act for the identity.

## Graph Reads

### `get`

`get <target> [--schema]` reads one exact canonical Node. Result exactly `{ id, class, props }`;
Schema-valued properties only with `--schema`. A Method Path is a callable, not a Node: `call` or
`introspect`.

```bash
astrale get @note --json
astrale get /:notes.example:class.Note
astrale get /:kernel.astrale.ai --schema
```

### `download`

A blob Property read shows only its Ref,
`{ "digest": "sha256:…", "mediaType": "application/pdf", "size": 48213 }`. `download` streams the
bytes it names, reading as `get` does.

```bash
astrale download @doc content -o report.pdf
astrale download @doc notes.example:class.Document.property.content -o report.pdf --json
astrale download @doc content > report.pdf
```

- `<property>`: the Property key, or a name when the Node holds one file by that name; otherwise
  the error lists the files the Node holds.
- Bytes are checked against the Ref's size and digest; `-o` writes `<file>.part`, renamed only when
  complete. `--json`: `{ node, property, mediaType, size, digest, file }`. Without `-o`, a
  redirected stdout (`-o -` forces it); a terminal is refused.
- Missing and unreadable files are indistinguishable: `BLOB_NOT_FOUND` or `FILE_NOT_FOUND`.

### `introspect`

Reads the Kernel Schema syscall for one installed Domain. A method or Function Path projects its
input/output from the installed bundle. An instance Method's qualified key selects the schema even
behind an `@id` receiver, which is neither read nor invoked; a bare `@id` has no schema origin.

```bash
astrale introspect kernel.astrale.ai
astrale introspect /:kernel.astrale.ai --bundle
astrale introspect /:kernel.astrale.ai:class.Identity:whois
astrale introspect @note::notes.example:class.Note.method.archive
```

### `query`

Executes canonical `astrale.graph.query/v6` →
`{ kind: "graph", graph: { nodes, edges }, page?: { next } }`; pass the opaque `page.next` to
`--cursor` until it is absent.

```text
query [<path>...]                    positional Paths = Path source terms
  --class <path>                     Nodes implementing one exact Class
  --edge <class> [--direction outgoing|incoming|incident]   one exact expansion (exact neighborhood)
  --limit <n>                        finite; default 100
  --cursor <token>                   resumes the same caller-bound query scope
  --ast <json> | --file <path>       a complete canonical Query V6 document
```

```bash
astrale query /:notes.example:class.Note --limit 50 --json
astrale query --class /:notes.example:class.Note --limit 50 --json
astrale query @note \
  --edge /:notes.example:class.references \
  --direction outgoing --limit 25 --json
astrale query --file query.v6.json --cursor "$CURSOR"
```

## Mutations

`astrale mutate` takes canonical `astrale.graph.mutation/v3` or its exact
`{ preconditions, operations }` authoring input from `--data`, `--file` or stdin. Atomic. `--dry`
admits and prints the canonical document without opening a Kernel connection. Result
`{ createdNodes }`.

```bash
astrale mutate --file mutation.v3.json --dry
astrale mutate --file mutation.v3.json
```

## Calls

`astrale call` creates one Path-targeted Call; its input/output contract is
`astrale introspect <path>`.

- Input precedence: `--data`, `key=value`, piped stdin, then `{}`. `--dry-run` admits the Path and
  prints the input.
- Top-level `key=value` values coerce booleans, null, numbers, arrays and objects; nested or
  digits-only strings go in `--data`. `--data` also takes `-` (piped stdin only; a terminal is
  refused) or `@<file>`, parsed like inline JSON: pass secrets only these ways, never in argv or
  shell history.
- Value, binary and stream results are handled explicitly; `--output` writes binary data. A
  streaming binary is drained with backpressure while the command's Client session is live, then
  presented like a buffered binary (raw, file or JSON). JSON keeps the application status and
  encodes the body as text or base64.
- A durable callable answers with the Execution it started: `call` prints the receipt, not a value.
  Save it (`--json > receipt.json`) and follow with `astrale execution status|result receipt.json`
  as the same identity (an `execution.reader` member reads any Execution); never repeat the call to
  learn its outcome. `call --wait` waits up to `--timeout` (110 s by default): the value once
  completed; the Kernel's error, exit 1, once failed or cancelled; still running: the receipt,
  exit 75.
- `astrale execution status|result|cancel|resume|signal` takes an Execution id or a receipt file.
  `cancel` is cooperative, open to whoever started the Execution and to `execution.terminator`
  members. `resume` and `signal <name> --value <json>` are Root only from the CLI; `signal`
  resolves one durable promise the run awaits, once, and the Kernel checks neither name nor value.

```bash
astrale call /:blog.example:class.Author:list limit=10
astrale call /:blog.example:class.Author:create \
  --data '{"name":"Ada"}' --json
astrale call /:assets.example:class.Asset:render id=123 --output asset.png
astrale call /:blog.example:class.Author:create -d @author.json
astrale call /:admin.astrale.ai:class.Instance:list --admin --json
```

Admin target:

- `--admin [<bookmark>]` or `--admin-url <url>` (with `--domain-issuer <url>`) runs the call on the
  Admin kernel, selected as `domain` commands select it. Usage error, exit 2: `-i` or `--url` with
  them, `--admin` with `--admin-url`, `--domain-issuer` without `--admin-url`.
- The call is otherwise unchanged: it exchanges at its callable's declaring Domain as the Admin
  kernel's installation names it; the Admin Domain issuer only completes the Admin target.
- Put `key=value` params before `--admin`, or write `--admin=<bookmark>`.

Rotating one secret of a Service's current deployment is such a call. With
`@astrale-os/adapter-astrale` ≥ 0.5.0-beta.171, `astrale-domain list --json` exposes `current`,
`callTarget.service` (the `CloudflareService` target, for rotation) and the deployment's
`callTarget.path` (for retirement). `SERVICE_NODE_ID` is the bare id between `@` and `::` in
`callTarget.service`. Input from a protected file outside the repository or a pipe, never argv.

```bash
astrale call "@${SERVICE_NODE_ID}::services.astrale.ai:class.CloudflareService.method.setSecret" \
  --admin -d @rotate.json --json
```

- The current deployment keeps its URL, issuer and key; provider propagation takes a few seconds.
- The reply names only the secret and cannot identify the rotated deployment if a promotion raced
  the call: recheck `current`, then verify intended behavior after propagation.
- It always follows current; a historical deployment has no `setSecret` Method. Identical-release
  redeploy and promotion effects:
  [deployment secrets](../astrale-domain/references/deployment.md#secrets-of-a-deployment).

## Journal

`astrale logs` reads the public Kernel journal syscall as the selected identity (Kernel
`journal.reader`) → `{ records, cursor?, frontier?, gap? }`.

```bash
astrale logs -i staging --limit 50
astrale logs --topic function.invoke
astrale logs --topic-prefix function. --follow
```

- Filters match exact values; `--topic-prefix` matches prefixes. Function invocation records use
  `function.invoke`, with their outcome in `payload.outcome`. Also `--principal`, `--caller`,
  `--since`, `--until`, an opaque `--cursor`.
- `--principal` filters in the Kernel by the executor: a Domain acting for a user (Console,
  `astrale call` through a Domain token exchange) is the executor of its records.
- `--caller` keeps the records whose caller (the identity whose authority the operation exercised)
  matches; it filters each returned page, so `--limit` bounds the page first. The Kernel records
  `caller` only when it differs from the executor: effective caller = `caller`, else `principal`.
- Both accept `@self`. The table shows PRINCIPAL and the effective CALLER; JSON keeps `caller` only
  where the Kernel recorded it.
- `--follow` keeps one Client session and advances only with returned cursors; with `--json`, NDJSON
  of one complete admitted record per line; `--format yaml` with `--follow` is refused.
- Structured output keeps the admitted `correlation` object (invocation root and parent ids) and
  adds `correlationId`, a projection of `invocationId`.

## Views And Browser Sessions

`astrale view` opens one resolved View through a local browser shell. Every View belongs to its
Domain: pass a Domain origin (its entrypoint, or `--view <name>`) or an explicit ViewPath. A View is
never opened for a node; a View that shows one node routes to it itself.

```bash
astrale view crm.example --list
astrale view crm.example --snapshot
astrale view crm.example --view dashboard
astrale view /:crm.example:view.dashboard
astrale view --sessions
astrale view --close <session-id>
```

`astrale browser` prepares a persistent authenticated GUI browser profile; `astrale browser --check`
verifies it; drive the printed profile with `agent-browser`.

## Output And Automation

- TTY: human-readable. `--json`: one JSON document for finite commands; `logs --follow`: NDJSON.
- `--raw` unwraps scalars and writes raw binary bytes.
- `--format yaml|json`: finite structured rendering; `logs --follow` supports JSON/NDJSON only.
- Automation: `--ci --no-prompt`, explicit `-i`, `--as`, `--timeout`, never ambient state. Pipe
  large JSON through stdin: argv size is OS-limited.

## Debugging

```bash
astrale status
astrale instance active
astrale auth status
astrale whoami
```

- `--debug`: full Kernel error diagnostics.
- Missing and authorization-masked Nodes are indistinguishable. Kernel Nodes are masked by family
  Role: Class, Function and Policy Nodes need `domain.reader`, Views `view.reader`, Executions
  `execution.reader`, composition and scope Edges `authority.reader`.
- `2004 ACCESS_DENIED` from `get`, `query` or `logs`, rather than an empty answer: the identity
  lacks that syscall's Kernel Role. `mutate` also answers it when a Class write Policy refuses.
- A Path also needs access to its intermediate nodes and edges: a Node readable by `@id` or a Class
  query may have an unavailable Domain-rooted Path. Check `-i` and `--as`; this alone does not
  prove corrupt data. `introspect` for callable schemas.

## Storage

State lives under `ASTRALE_HOME` (default `~/.astrale`); `ASTRALE_KEYS_DIR` optionally moves keys.

```text
config.json
instances.json
identities.json
idps/
idp-sessions/
keys/
browser.json
browser/
exchange/credentials.json
session/routes.json
session/installations.json
```

- Owner-private caches; deleting one costs only a re-read or a new exchange, never access:
  `exchange/credentials.json` (Domain-exchanged credentials until expiry), `session/routes.json`
  (learned Domain routes and their short-lived carriers), `session/installations.json` (each
  Domain's installed issuer per Kernel).
- Before a callable or managed-Instance command uses a credential from a remembered issuer, a
  read-only Kernel call confirms it. After a Domain reinstall and the previous issuer's drain, a
  2002 refusal of that confirmation re-reads the installation and exchanges at the new issuer in the
  same command, before any application call. Application calls are never replayed by this
  recovery.
- `idp-sessions/`: sign-ins whose refresh tokens work once, each owned by the home that wrote it. A
  copy in another `ASTRALE_HOME` may use its cached access token but refuses to refresh
  (`IDP_SESSION_COPIED`) while the original home holds the sign-in. Give another home its own
  `astrale auth login`.
- Studio preferences, under `<ASTRALE_HOME>/studio/`, are not caches: `settings.json` holds
  `agentModel: { harness, model } | null`; `harness-gateway.json` holds gateway
  `auth: { mode: "mint", instance? } | { mode: "token", token }`, so it may hold a credential.

## Source Map

- Entry: `cli/bin/astrale.ts`
- Program and shared options: `cli/src/program/`
- Public Kernel connection boundary: `cli/src/connection/`
- Query/Mutation document preparation: `cli/src/graph/`
- Commands: `cli/src/commands/`
- Shared presentation and local stores: `cli/src/lib/`
- Studio bridge: `cli/studio/server/`
- Tests: owner-local `__tests__/` directories
