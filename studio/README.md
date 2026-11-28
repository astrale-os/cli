# Domain Studio

Domain Studio is a local web application for reading and changing Astrale Domains. It reads a
workspace's Domains from their sources, and any published version of a Domain from the registry,
and draws each one at three levels through four lenses. A comment or a question can be attached
to anything it draws; a local Claude Code or Codex agent, run under your own login, reads those
threads, edits the Domain on disk and answers in place.

- The HTTP server binds loopback only, and answers only the Studio's own page (`server/api/guard.ts`,
  before every route: API, events, page). `Host` is `localhost`, `127.0.0.1` or `[::1]` at the
  server's port (plus a non-wildcard bound host, plus the Vite dev host under `--dev`), and an
  `Origin`, when present, is exactly `http://` one of those. `Sec-Fetch-Site`, when present, is
  `same-origin` or `none` (under `--dev` also `same-site` from the Vite origin); anything else is
  refused (403) on every method. A client with neither header passes on `Host` alone.
- What a Domain id names is read in one place (`domainAddressOf` in
  `shared/contracts/workspace.ts`): a workspace Domain, the Kernel, a Publication, or nothing. A
  Publication and the Kernel are read-only everywhere in the Studio; the server refuses their
  writes in one place (403), all but the reader's own arrangement, and every request to an id that
  names nothing (404). A Publication is arranged only once this Studio has opened it: the write
  asks the registry nothing.
- Every body a route reads is bounded (`REQUEST_LIMITS`, beside `LAYOUT_LIMITS`): a JSON body at
  4 MiB, an upload at 32 MiB; past it the request is refused (413) and changes nothing.
- Reading a Schema never rewrites it. The Studio writes its own state under `.domain-studio/`
  and the Studio home, the `.env.dev` / `.env.prod` files its environment editor saves, and the
  source tree of a Domain it creates. An agent edits sources and runs commands at the access
  level you choose.
- The Studio's Publish runs only after a fresh change report, and never on a Studio started with
  `ASTRALE_STUDIO_PUBLISH=off`. That switch covers the Studio's Publish route only: an agent runs
  commands with your own access and CLI sign-in, and can publish whatever the switch says.

The Studio lives in the CLI repository (`cli/studio`) and is launched by `astrale studio`.

## Run

```bash
astrale studio                 # start the Studio on the current directory and print its URL
astrale studio --open          # …and open it in a browser
astrale studio ./my-domain     # a workspace, a Domain directory or an astrale.config.ts
astrale studio --harness codex # lock this process to one agent harness
astrale studio --port 4400     # an exact port: used as given, or an error if busy
```

Without `--port`, the Studio binds the first free loopback port in 4319–4338. It serves the
prebuilt client embedded in the standalone executable, whose Bun 1.4 runtime it also uses: an end
user installs neither Bun nor Node. `--dev` is the live-edit loop for working on the Studio itself
(see [Run from source](#run-from-source)).

A Domain is found through the default-exported `defineProject` of its `astrale.config.ts`, read
statically: no adapter or runtime code runs. The Studio follows the Project's `domain` binding to
its `defineDomain` module, then that module's `schema` binding to the authored Schema. Datasets
come from `tests: tests({ datasets: [...] })`, Environments from `environments`. Local bindings
and SDK import aliases are followed; dynamically constructed values are not. A Domain whose
dependencies are installed is read through its own SDK; without them, its source anatomy is
drawn.

## Levels and lenses

The Studio reads at three levels. Past the Workspace, a lens chooses the question the canvas
answers. The breadcrumb in the header (Workspace › Domain) opens the Workspace or another Domain;
the **Schema | Data** switch beside it chooses whether the Domain's Schema or one of its datasets
is read (`S` and `D`, or ⌘K); `1` to `4` switch lens. Scenarios follow the lenses in the switch,
locked.

| Lens | Question it answers |
| --- | --- |
| **Structure** | What exists |
| **Behavior** | What happens |
| **Rules** | What is allowed and what must hold |
| **Views** | What people see |

Every level has the same layout: an **Index** listing what the canvas draws, the **Scene canvas**,
and a panel that reads the selection in sentences (the **Inspector** at the Domain level). The
canvas and the Index draw one Scene, projected from the level's data by the lens; a selection made
on either, from ⌘K, or from a comment is the same selection.

**Workspace level** (no lens). One card per workspace Domain: its declared version, where it stands
against its last Publication, the version bump its changes require, and its build state. Each
dependency is a link labelled with the version built against and how many of the dependency's
Publications it holds against; a dependency outside the workspace (the Kernel, Shell) is a quieter
card. The panel reads the Workspace, a Domain, a dependency link or an outside Domain, and starts a
Publish. Every fact read from the registry keeps its own state: one that cannot be read is marked,
and nothing else is blanked.

**Domain level**, one Domain's Schema:

| Lens | What it draws |
| --- | --- |
| Structure | Node Classes as cards and relationships as links, grouped by module. Classes of another Domain or of the Kernel that a relationship end accepts are drawn quiet, framed by their Domain. The **Domains** control draws other Domains whole beside the open one (below). An option draws inheritance. |
| Behavior | Integrations, functions and the Classes they change, in three bands: each function links to the Classes it creates, updates, deletes, transitions, links or unlinks, and to the Integrations it calls. What the source reading cannot follow is said on the node. |
| Rules | The Structure map with each Class card listing the rules on it: who may read, create, update, delete or call (Policies) and what must hold (constraints). The Index lists the rules. A rule opens on a page drawn by `@astrale-os/visual`. |
| Views | Each View the Domain declares as a card: what it says of itself, how it is built (single-page app, inline HTML), where it mounts, the entrypoint first and marked, and where its sources do not back it (no code found, no client route). Views in more than one module are framed by module. A client route no View mounts is counted, not drawn. Where the sources say what a View's code reaches, the canvas reads in three bands: the Views, the functions their code calls, and the Classes those functions change, under the ids Behavior gives them; the `reads` option also draws the Classes each View reads, dashed. A View whose code cannot be read in full says so on its card. |

The **Domains** control of the Structure canvas lists the open Domain, every other Domain of the
Workspace and each Domain outside it the open one depends on (the Kernel, Shell). Each other
Domain is drawn one of three ways:

- **Hidden**: none of its Classes; each relationship that reaches it ends on one card for it.
- **Reached**, the default: the Classes the open Domain's relationships accept, quiet, in its frame.
- **Whole**: every Class it declares, in an area of its own beside the open Domain's. Only a
  Domain whose Schema the Studio reads (a Workspace Domain, the Kernel) can be drawn whole: the
  Classes the open Domain imports never stand in for one.

Each Domain drawn whole is a framed area named with its version, its modules framed inside it, laid
out as its own canvas lays it out; the areas are packed apart, the open Domain's first. The
relationships between two areas are drawn across them, parallel ones on one route. An area drags
whole by its name, and a card dragged stays in its area. The choice and the arrangement are the
Domain's (`layout.json`), and **Auto-arrange** lays the composed canvas out again. The Index lists
one top group per Domain. A Class of another Domain reads on that Domain's own page, which names
it and opens it there; a comment on it is filed under that Domain.

Behavior, Rules and Views read the open Domain alone, and so does the Data level. A selection
only a Domain drawn whole declares is let go on leaving Structure.

**Data level**, one dataset of a Domain. **Data** opens the dataset last read on the Domain while
the Domain still declares it, else the Domain's one readable dataset, else its **Datasets** page,
which lists every dataset with why one cannot be read, or says what a Dataset is when there is
none. The dataset last read is kept per Domain in the browser. **Schema** comes back with the lens
and the selection kept. A Publication carries no dataset: its Data segment is disabled and says so.

A bar stands over the map through every lens. Its first line names the open dataset in the Data
accent, which also marks the switch's Data segment and the Index (clicked, the name opens the
Datasets page), says how many Nodes and Edges it holds, and sets the size it is read at. Its second
line is the question the lens answers.

> A dataset read at ×20 or ×100 is **faked**: the dataset as written, laid down that many times
> with its identities shared, to read the level at a size nobody wrote by hand. It is not a
> generated dataset, and the bar says so.

| Lens | What it draws |
| --- | --- |
| Structure | Never the dataset whole. At rest, the dataset **measured against its Schema**: each Class with the Nodes it holds, each relationship with its Edges and, at each end, the links a Node really has against what the end declares; an end a Node breaks warns. The Index lists the Domain's **Queries**; one picked is **asked**: the map draws the slice it reaches from the Nodes its parameters hold, and the panel lists its answer. |
| Rules | The dataset read as one of its identities, or as anyone: per Node and per Edge, what that identity may do and by which rule. Each verdict can be pinned to a Scenario. The Index also lists the Domain's Policies: one selected says how many pairs (an identity, or anyone, and a Node or Edge it is decided over) it admits, each pair a sentence, and the map lights what it admits. A Policy selected on the Schema's Rules lens opens here on a dataset of its Domain. |
| Behavior | The dataset's Scenarios, each step judged on the dataset as written. |

**Asking a Query.** Each parameter of the Query is a chip on the bar. A chip holds a Node, several,
or a value; opened, it lists what it can take with what asking with each gives, and a value's chip
lists the values the dataset holds for the Property it is compared with. A parameter the Query
requires is filled when the Query opens: with the Node selected on the map when it takes one, else
a Node the dataset names by a variable, else the one whose answer is fullest; an answer too large to
read holds one optional parameter the same way. A value the Studio picked wears a mark and says why,
and is changed like any other. **Read as** asks as one of the dataset's identities: the answer keeps
what that identity may read, and counts what it withholds.

> Asking is **approximate**: the Studio runs no Kernel. The answer follows what the Query reads
> from the Nodes its parameters hold; the Query's own filters beyond those values, its order and
> its bounds are not applied. A parameter the source reading cannot place is shown and not applied.

The Data level does not read Views: a View renders on an instance, not over a dataset. Its tab
stays in the switch, disabled, and says so.

### Scenarios

A Scenario is a named list of steps written against one dataset. A step is one sentence: as an
identity (or anyone), read a Node or an Edge, traverse an Edge, or call a function, and expect it
allowed or refused. Each step names what it acts on as the dataset writes it — a Node by its path,
an Edge by its ends and relationship, a function by its handler key — so it outlives an edit that
keeps what it names.

Every step is judged again whenever the dataset or the Schema changes, and stands as expected, not
as expected, gone (what it names is absent), or can't tell, with why. Can't tell is
neither a pass nor a failure and is counted apart. Every Scenario states its limit:

> Each step is judged on the dataset as written; changes are listed as declared, not applied.

What a call is declared to change is read from its source, in the Behavior lens's words, and is
never applied: every step of a Scenario is judged on the same written dataset. Scenarios are stored
in the Domain's `.domain-studio/scenarios.json`; a Scenario holds at most 200 steps, and a Domain
keeps at most 500 Scenarios (`SCENARIO_LIMITS` in `shared/contracts/scenarios.ts`).

## Publications

Any published version of a Domain opens at `/publication/<origin>/<version>`, from the Workspace
level or by address. The CLI reads the registry's index and downloads and verifies the release's
bundle; the Studio decodes it with an installed `@astrale-os/sdk` (the workspace Domain of that
origin, else the workspace's newest installed SDK) and projects it into the same render IR as a
workspace Domain.

- It is read-only: it takes no comment, import request or agent edit, and every surface that would
  write says so in place. Ask answers from its Schema. That an Ask about a Publication or the
  Kernel changes no file is an instruction to the agent, in its prompt, not an enforcement: the
  fork runs at the access level you chose, like any turn.
- A published bundle holds the Schema alone. Behavior draws each function's declaration — the
  Class a Method works on, the Classes its input takes and its output returns — and none of its
  effects. The Views lens draws the Views the Schema declares, with no View code to open.
  The Data level says that a Publication carries no dataset.
- A registry read shows its elapsed time. Past `REGISTRY_READ_LIMIT_MS` (index 1 min + bundle
  2 min + judgement 3 min) it says the limit it reached and offers **Read again**; an answer that
  arrives later still lands.
- One release is opened once per process: a second read of it joins the first, and the eight most
  recent projections are kept in memory. Downloaded bundles live in a temporary directory removed
  when the process exits. Only the canvas layout persists, in the Studio home.

## The Kernel

The Kernel (`@kernel`) is read-only like a Publication. Its Classes come onto a Schema's canvas
where that Schema builds on them, quiet, and read in the Inspector like any other; the Structure
option **Inheritance** also draws the parents no relationship end accepts. The Studio reads the
Kernel Schema shipped by a workspace Domain's installed `@astrale-os/sdk`, through the same
extractor island as an authored Schema, so it is the Kernel that Domain is built against.

## Addresses

The URL names the place, so a reload, a pasted link, Back and Forward land where the reader was.

| Address | Place |
| --- | --- |
| `/workspace` | The Workspace level. `?domain=<id>`, `?origin=<origin>` or `?domain=<id>&dependency=<alias>` names the map's selection. |
| `/domain/<id>?lens=<lens>&select=<ref>` | A workspace Domain's Schema. |
| `/domain/<id>/data?dataset=<path>&lens=<lens>&select=<id>&as=<identity>&verdict=<id>&scenario=<id>&step=<id>` | The Data level. Without `dataset`, the Domain's Datasets page. The retired `/domain/<id>/tests?dataset=<path>` lands here, on the same dataset under Rules, and says so. |
| `/publication/<origin>/<version>?lens=<lens>&select=<ref>` | One Publication, read-only. |
| `/` | No place: the Workspace's saved UI state decides. |

`<lens>` is `structure`, `behavior`, `rules` or `views`; the Data level does not read `views`, and
an address naming it there opens the dataset without it and says so. A part of an address that
names nothing is reported, and the rest still opens.

## Comments and Ask

`C` toggles comment mode and `A` Ask mode: pick an element, then comment on it or ask the agent
about it. An Ask runs in an ephemeral fork of the conversation.

A comment or an Ask lands on the element it was made on: a target is located by the surface it was
made on and its owning Domain, never at a namesake on another surface or Domain
(`client/src/lib/targets.ts`). Threads live in the Domain's `.domain-studio/comments.json`. Threads
waiting on the agent ride along with its next turn, and it answers them in place.

## Work panel and chats

The work panel docks at the bottom (the default), left or right, and holds two tabs:

| Tab | What it holds |
| --- | --- |
| **Agent** | The chat tabs and the selected conversation. Each tab is its own conversation, agent and model. Documents dropped in join the Domain's `.domain-studio/context/docs/`, and every turn lists them by path. |
| **Comments** | Open threads; opening one takes the canvas to what it points at. Resolved threads are hidden. |

A workspace holds several conversations at once. Each tab keeps its own transcript, model,
harness-native session id and running turn, persisted under `$ASTRALE_HOME/studio/agent/`: two tabs
can work at the same time, and both survive a restart.

The model and the agent are picked from one control in the composer. A model of this chat's agent
switches this conversation's model in place. A model of the other agent opens a new chat on it,
never an existing tab: a harness session id means nothing to the other harness. The new chat
carries a summary of the one it continues (what was asked, what the agent answered, which files it
touched), sent with its first message and kept at the top as a collapsible chip. The original chat
is left as it was and stays resumable.

`+` opens a chat on the preferred model, the one starred in that menu; one star names both the
model and the agent. With nothing starred, a new tab continues with the agent in use, each agent
falls back to its own default (`opus[1m]` for Claude Code, `gpt-5.6-sol` for Codex), and the Studio
opens on whichever of the two this machine has.

Beside the model sits the chat's reasoning level. Its rungs are the ones the agent reports over ACP
for the model in use: Claude ends at Max plus the Studio's Ultracode, Codex goes to Ultra, and a
model without reasoning (Haiku) shows no meter. Left untouched, it runs the level the agent's own
configuration sets; a fork to the other agent carries the level to its nearest rung there.

**New domain**, on the Workspace page, opens one composer: a name and a first message. Sending runs
`create-astrale-domain <name> --yes` through `npx` in the workspace root (at `SCAFFOLDER_RANGE` in
the CLI's `src/lib/scaffolder.ts`; the scaffold names no instance), then `pnpm install` in the new
Domain, stages the attached files into its `.domain-studio/context/docs/`, and opens its first turn
with the message as the Domain's creation brief. A name alone does not send. A refusal (a taken
name, an invalid slug) keeps the message and files as typed; a Domain created without its brief
still opens, with the message in its composer. The name is the slug and, until changed, the origin:
`crm` scaffolds `crm.example.dev` with a comment marking it a placeholder; a dotted name
(`crm.acme.dev`) is taken as the origin.

## Local agent harness

The Studio detects both local harnesses. `--harness` (or `DOMAIN_STUDIO_HARNESS`) locks the process
to one; the composer then offers only its models, and Settings says what holds the lock.

- **Claude Code:** authenticate with `claude /login`. The Studio can also route this harness through
  its Anthropic-compatible model-gateway settings.
- **Codex:** authenticate with `codex login`. Codex custom providers require the OpenAI Responses
  API, which the Astrale gateway does not expose, so Codex uses its own login.

The Studio runs the exact agent build each bundled ACP adapter is written for, not the `claude` or
`codex` on PATH: each adapter speaks a private protocol to its CLI and checks no version. The
versions come from `pnpm-lock.yaml`; `pnpm run agents:pin` regenerates
`server/agent/harness/acp/pinned-binaries.ts`, and `pnpm test` fails while it is stale. The first
turn, Ask or probe that needs an agent downloads its platform package from the npm registry,
verifies it against the lockfile's integrity and unpacks it under `$ASTRALE_HOME/cache/agents`; the
chat shows the progress. Logins and configuration are shared with your own install (`~/.claude`,
`~/.codex`). Every process running a build leases it, and a build no live process holds is removed
when a Studio starts or installs one. Conversations live in the agents' own homes, so removing a
build loses none. `astrale update` fetches the new release's builds of the agents the Studio has
installed, in the background.

`DOMAIN_STUDIO_CLAUDE_BIN` / `DOMAIN_STUDIO_CODEX_BIN` run a local executable instead
(`DOMAIN_STUDIO_CODEX_BIN=codex` for the one on PATH). Settings → Agent then shows its `--version`
and warns when it strays from the pinned build.

Every turn goes through the Studio's Agent Client Protocol (ACP) adapter: one short-lived stdio
connection per turn, using `session/new`, `session/resume`, configuration, prompt, update,
permission and cancel. Health checks and diagnostics use ACP directly; a re-probe opens a disposable
session, reads the agent's identity and model configuration and deletes the session without a
prompt. An Ask forks its parent conversation (`session/fork`) and deletes the fork afterwards; a
server that does not advertise fork, or a fork that fails before answering, gets a fresh ephemeral
session instead.

Model and reasoning level are remembered per chat. Both are set through the ACP session
configuration for new turns, resumed turns, Ask sessions and diagnostics, without rewriting the
harness's global configuration; the reasoning ladder is read after the model is set, since the
model decides which rungs exist. A level the model does not offer lands on its nearest rung.

### Access levels

Settings → Details holds the access level. **Workspace** runs the harness in its workspace-write
sandbox. **Full automation** (the default) permits unrestricted local commands, deploy and install
included. Either level lets the agent edit files and run commands with the authority you select,
which is why the server binds loopback only and answers only the Studio's own page.

## Views

A Domain's Views are drawn by its Views lens (`4`, or ⌘K → Views). A View selected there, or from
the Index, opens its page in the Inspector: how it is built, where it mounts and is declared, what
its code calls and reads as read from its sources (or that it is not read, and why), and one
action, **Open**, beside the active instance it opens on, chosen there. When it cannot open, **Open** is disabled and the reason stands beside it: no
active instance, an active instance you do not own, or a Publication, whose bundle holds no View
code. A function, Class or definition selected under Views lists the Views whose code reaches it.

A View opens by its canonical
ViewPath, `/:<origin>:view.<name>`, through `astrale view` as the instance owner: the CLI resolves
the installed, verified View placement and owns the loopback Shell session, identity, delegation and
cleanup.

The Studio opens Views only on an instance you own in Admin (the Admin Policy
`OwnInstanceOrAdministerAdminInstance`). The instance choice beside **Open** lists the others —
instances you only use, local bookmarks such as a dev Kernel — greyed with the reason, and they
cannot be picked; an active instance set from a terminal that you do not own carries a warning,
and its Views are refused with the reason. On an owned instance, a View opens as the Admin
back-office opens it: resolved as the instance root and run as **Root**. Its **Open as** picker
lists Root, the instance's Users and its other Identities; **Switch & reload** impersonates the
selected one and reloads only the preview. The root and impersonation tokens stay in the CLI's
session server; the preview receives only its per-View grant.

## On-disk state

Per Domain, under `<domain>/.domain-studio/`:

| Path | Holds |
| --- | --- |
| `comments.json` | Comment threads. |
| `layout.json` | Each lens's canvas arrangement: positions by box id, folded groups, folds opened by hand. |
| `scenarios.json` | The Domain's Scenarios, every dataset's. |
| `context/user/`, `context/auto/` | Context handed to the agent: items you add, and items the Studio composes (mirrored as `.md` files). |
| `context/docs/<readable-name>` | Dropped documents. Their index is `context/documents/index.json`. |
| `.cache/` | Derived data, ignored by Git (its `.gitignore` is `*`). |
| `.cache/schema-bundle.json` | The last bundle built from the Domain's sources. |
| `.cache/baseline/` | The baseline that "changes since" is computed against: `ir.json`, `schema-root.json`, `files.json`, `meta.json`. |

The bundle cache is keyed by everything a bundle is derived from: the extractor program, the
Domain's anatomy files, the lockfiles that govern it (the nearest directory above the Domain that
has any), its installed SDK and the Studio's own extraction inputs. A persisted bundle is read only
under the same key and entry version, every build whose inputs held still while it ran replaces it,
and a failed build stands for 60 s at most. Program and SDK identity is read from file size and
modification time, so a reinstall that keeps both is not seen.

The baseline is the first bundle that holds a Schema, captured once. A failed extraction captures
nothing, and a baseline written in another format or projection version is captured again.

The Studio home is `$ASTRALE_HOME/studio/` (`~/.astrale/studio/` by default):

| Path | Holds |
| --- | --- |
| `settings.json` | Studio settings. |
| `harness-gateway.json` | The model-gateway configuration, mode `0600`. |
| `agent/` | Chats, transcripts, attachments and session ids, for every workspace. |
| `workspaces/<name>-<hash>/` | One workspace's UI state (`ui.json`), the Workspace map's arrangement (`layout.json`) and its active chat. |
| `kernel/` | The Kernel canvas's arrangement. |
| `publications/<origin>/` | A Publication's canvas arrangement. |

Pinned agent builds live under `$ASTRALE_HOME/cache/agents`. `ASTRALE_HOME` moves all of it.

The files outside `.cache/` are user data, not caches. Settings and the gateway configuration are
decoded field by field: an unknown or malformed field is dropped, and the next save writes the
current shape. Documents keep their index at `context/documents/index.json` beside the files in
`context/docs/`; removing `context/documents/` loses the index.

## Layout and contracts

```
shared/
  contracts/        the wire and disk contracts both sides import (see contracts/README.md)
  schema/           canonical reference identity helpers
server/
  index.ts          process composition and lifecycle
  api.ts, api/      the HTTP router and one handler per capability
  domain/           Domain registration, boot and file watching
  introspect/       extraction islands, canonical projection, source overlay, bundle cache, diff
  workspace/        workspace scan, Domain creation, updates, Git
  workspace/versions/  registry reads, Publications, change reports, compatibility, Publish
  state/            the allow-listed store under `.domain-studio/` and the Studio home
  agent/            harness adapters, chats, runs, Ask and their routes
  handoff/          what an agent turn is handed
  instances/        active-instance discovery and selection
  views/            View sessions through `astrale view`
  environment/      `.env.dev` / `.env.prod` editing
client/src/
  app.tsx           header, level routing, Publications
  studio/           the three levels: bar, canvas, scene, lenses, index-rail, inspector,
                    rules, data, workspace, schema-level.tsx, rule-page.tsx
  schema-studio/    the Imported domains overview, and detail panels
  components/       shared UI: work panel, comments, Ask, command palette, settings
  lib/              API client, queries, store, addresses, targets, read-only rule
```

`shared/contracts/` holds each definition once, in its semantic owner: `schema.ts` (render IR and
introspection results), `workspace.ts` (persisted and workspace state), `agent.ts` (the agent
protocol), `runtime.ts` (runtime configuration, events), `versions.ts` (the Workspace level:
Publications, change reports, compatibility, Publish, registry read limits) and `scenarios.ts`.
Contracts never import server or client code.

The server parses each JSON body once as an untrusted record; a capability route admits only the
fields it owns before calling a typed repository or workflow. The client handles server-sent events
through one event-to-effects table behind one subscription.

Schema parsing delegates admission, semantic resolution, revisioning and dependency reachability to
the SDK the Domain installs: a Bun subprocess, started outside the Domain, bundles the authored
Schema module with that SDK and projects the admitted root into the Studio's render IR. A ts-morph
overlay adds only what the SDK does not carry: handler links, source spans and JSDoc.

Rules pages are drawn by `@astrale-os/visual` from the admitted root and its closure. `package.json`
takes it as a `file:` dependency on the built copy at
`workbench/.worktrees/visual-studio-host/modules/visual/.cache/package` in the Astrale workspace,
which must exist before `pnpm install`; its theme is mapped onto the Studio tokens in
`client/src/studio/rules/rules.css`.

## Run from source

Use the Bun that the CLI's `.bun-version` names (1.4.4), first on PATH: in `--dev`, the Studio
server runs on the PATH `bun`, and the Schema extractor runs on the Bun that launched the CLI.
From the CLI checkout root:

```bash
bun --version                                        # 1.4.4
pnpm install
bun bin/astrale.ts studio --dev <workspace>          # Vite HMR + a watched server
ASTRALE_STUDIO_PUBLISH=off bun bin/astrale.ts studio --dev <workspace>
```

`--dev` runs a Vite dev server (client HMR) and `bun --watch server/index.ts` (server reload), and
extracts Schemas through this checkout's CLI. `ASTRALE_STUDIO_DIR` points `--dev` at another Studio
checkout.

`ASTRALE_STUDIO_PUBLISH` is `on` or `off`; unset is `on`. Any other value (`OFF`, `0`, `false`, an
empty value) stops the Studio at its start with a sentence that says so, rather than guess.

- `off` starts a Studio whose Publish route refuses every Publish (`publish-disabled`); the Publish
  dialog says why, and the Studio publishes nothing. Every other read, registry reads included,
  works as usual.
- It does not cover the agent. An agent turn runs commands with your own access and your own CLI
  sign-in, within the agent access level you choose, so it can publish from a Studio started with
  `off`.

## Tests

From the CLI checkout root:

```bash
pnpm --dir studio test        # every Studio unit test: bun test --isolate client/src server shared
pnpm --dir studio typecheck   # the server/client/shared boundary
pnpm --dir studio test:e2e    # the Chromium suite
STUDIO_E2E_PORT=4399 pnpm --dir studio test:e2e e2e/published.spec.ts
pnpm test                     # the CLI suite and every Studio unit test
```

`test:e2e` first builds the client into its own folder, `client/dist-e2e/<port>`
(`STUDIO_E2E_PORT`, 4397 by default), so a run never serves a build that `pnpm build` or another run
is rewriting. Playwright then starts the real server (`e2e/server.ts`) on the fixture in
`e2e/fixture`, with:

- `ASTRALE_HOME` at `test-results/astrale-home`, so no run reads or writes your home;
- `ASTRALE_STUDIO_PUBLISH=off`;
- `e2e/registry-cli.ts` as the server's CLI: the real CLI, except that the registry index and bundle
  reads of an origin a spec serves are answered from `test-results/registry/<origin>.json`. An
  origin no spec serves reaches the real CLI, which that fresh home has signed in to nothing. No
  test reaches the network.

Before each run, `e2e/reset-state.ts` clears what the suite writes into the fixture (layouts,
comments, Scenarios, documents) and keeps `.cache/`. Outside CI, Playwright reuses a server already
answering on the port; stop it to test a change to the server. The first run on a machine needs
`pnpm --dir studio exec playwright install chromium`.
