# Domain Studio

A local GUI for inspecting and working with Astrale **domains**. Point it at a
domain (or a workspace) and it parses the whole thing — the **schema** above all —
and renders it far more legibly than raw code. Attach **comments / open questions**
to any element, then hit **Submit to agent**: a local Claude Code or Codex harness,
using your existing login, reads the context, edits the domain code on disk, and
replies in the conversation and straight back into any included comment threads.
Several such conversations can run side by side, as tabs.

Lives in the astrale CLI repo (`cli/studio`) and is launched by **`astrale studio`**.

## Run

```bash
astrale studio                 # start the studio + print its URL (no browser)
astrale studio --open          # …and open it in a browser
astrale studio ./my-domain     # …or a specific domain / workspace / astrale.config.ts path
astrale studio --harness codex # lock this process to Codex
```

`astrale studio` resolves the studio shipped with the CLI, binds the first free
loopback port in **4319–4338** (so a studio already running in another workspace
just takes the next one), and prints its URL — it does **not** pop a browser by
default (pass `--open` for that). Flags: `--port <n>` ·
`--harness claude|codex` · `--open` · `--dev`.

By **default** it serves the **prebuilt client embedded in the standalone
executable**. `ASTRALE_STUDIO_DIR` points `--dev` at an out-of-tree Studio
checkout.

**`--dev` — live-edit the studio itself.** From the source checkout (`cli/studio`,
with Vite installed), `astrale studio --dev` runs a Vite dev server (client HMR) +
a watched Bun server (`bun --watch`, reloads on edits), so changes to the studio
reflect instantly. (`@astrale-os/shell` resolves to workspace source here, so Vite
pre-bundles it — `optimizeDeps` in `vite.config.ts` — and the HMR WebSocket targets
Vite directly via `STUDIO_VITE_PORT`.)

> The standalone CLI embeds Bun 1.4, so end users do not install Bun or Node.
> Bun and Vite are required only for `astrale studio --dev` from a source
> checkout. The target domain's deps must be installed (`pnpm install` at the
> workspace root) for semantic schema rendering; source-only anatomy remains
> available when they are missing.
> Current projects are detected through `astrale.config.ts` and an Application whose
> `schema` binding resolves to authored source.

### Chats

A domain holds several conversations at once, as tabs above the agent panel.
Each tab keeps its own transcript, its own model, its own harness-native session
id and its own running turn, all persisted under `.domain-studio/.cache/agent/`
— two tabs can work at the same time, and they survive a restart.

Both the model and the agent are picked from one control: the discreet model
name in the composer, next to the send button. Its menu lists every harness with
its own models, and the consequence follows from which one you pick:

- a model of **this chat's agent** → this conversation switches model, in place;
- a model of **another agent** → a NEW chat opens on it. Always a new one, never
  a jump to an existing tab of that agent: an older tab is a different
  conversation.

That is the whole reason a chat belongs to its harness for life — a Claude
session id means nothing to Codex. The new tab carries a summary of the
conversation it continues (what was asked, what the agent answered, which files
it touched), sent with its first message and only that one. The summary then
stays at the top of the chat as a collapsible chip, so where the work came from
is never lost. The original chat is left exactly as it was — same session, same
history, still resumable.

**Settings → Agent** holds the domain-wide defaults: which agent and model a new
chat starts on. Picking another agent there forks a tab the same way.

### Local agent harness

Studio detects both local harnesses. `--harness` (or `DOMAIN_STUDIO_HARNESS`)
locks the whole Studio process to one harness and disables the selector.

- **Claude Code:** install `claude` and authenticate normally. Studio can also
  route this harness through its Anthropic-compatible model-gateway settings.
- **Codex:** install `codex` and run `codex login`; Codex keeps using that local
  binary, login, and configuration.

Both execution paths go through Studio's shared **Agent Client Protocol (ACP)**
adapter. The standalone CLI embeds the official Claude and Codex ACP agent
servers, starts one short-lived stdio connection per turn, and uses ACP
`session/new`, `session/resume`, configuration, prompt, update, permission, and
cancel messages. Health checks and Settings diagnostics also use ACP directly.
Re-probe initializes a disposable session, reads the agent identity and model
configuration, applies Studio's optional model override, and deletes the session
without sending a prompt. Studio does not infer unavailable inventories such as
skills, MCP servers, tools, or subagents.

Claude's ACP server advertises `session/fork`, so **Ask** inherits its parent
conversation and deletes the ephemeral fork afterward. The current Codex ACP
server does not advertise fork yet; Codex Ask therefore uses a fresh ephemeral
ACP session and still leaves the main conversation untouched. Capability
detection will use a fork automatically when the Codex server adds it.

The Agent settings also choose the reasoning effort and access level. **Workspace**
uses the harness's workspace-write sandbox. **Full automation** preserves the
existing deploy/install workflow and permits unrestricted local commands. Studio
remains loopback-only by default because either harness can edit files and run
commands with the authority you select.

Model selection is remembered per chat, falling back to the domain default for
that harness. Leaving it on **Default** preserves the harness's own resolution
rules. Claude
and Codex both report the current model and selectable models through the ACP
session configuration. Choosing an explicit model sets that ACP configuration
for new turns, resumed turns, isolated Ask sessions, and diagnostics without
rewriting the user's global harness config.

Codex custom providers require the OpenAI Responses API. Astrale's current
AI-gateway surface exposes Chat Completions and Anthropic Messages, so Studio does
not present the existing gateway card for Codex yet; Codex uses its own login.

### View previews

Studio opens the canonical `/:origin:view.slug` through `astrale view`. The CLI
resolves the installed, verified View placement and owns the loopback Shell
session, identity, delegation, and cleanup. Target-bound Views query the active
instance first so Studio can pass an exact `@id`; Studio does not inject a local
URL or override the View handshake.

## What it does

The header selects the active instance and domain, switches between the two
sections, and exposes settings (including the light/dark theme), environment
values, search, comment mode, and the agent loop:

| Section | What it shows |
|---|---|
| **Schema** ★ | A module tree, relationship canvas and definition details. The canvas reads as DIRECTION by default and has a Cardinality mode; it also exposes canonical Core data plus the Domains, Views and detected Integrations panels, and can compose multiple workspace domains. |
| **Process** | Canonical Core genesis, standalone Functions, class Methods, their auth/handler links and View entrypoints. |

Views are not a section of their own: they belong to the landscape, listed from
the canvas toolbar and opened live through `astrale view`.

Talking to the agent and reading comment threads are not sections either: they
live in the **work panel**, dockable left (default), right or bottom and
resizable. Collapsed, it leaves a rail of tab icons, and the header then offers
to send open threads to the agent.

| Panel tab | What it does |
|---|---|
| **Agent** | The chat tabs and the selected conversation: your message, what the agent did, what it answered. Each tab is its own conversation, agent and model. Documents dropped in join `.domain-studio/context/docs`; every turn lists them with their path, so the agent opens the ones it needs. |
| **Comments** | Open threads; opening one takes the main view to what it points at. Threads still waiting on the agent ride along with the next turn, and it answers them in place. Resolved threads are hidden. |

## How it's built

```
shared/
  contracts/            schema, workspace, agent and runtime wire contracts
  schema/               canonical reference identity helpers
server/
  agent/                 harness adapters, live bridge, run lifecycle and routes
  api/                   capability route handlers behind the thin api.ts router
  introspect/            canonical projection, source overlay, anatomy and structural diff
  state/                 repositories confined to persisted `.domain-studio` state
  instances/             active-instance discovery and selection
  views/                 View model, target selection and verified CLI sessions
  workspace/             domain creation, catalogue, updates and Git inspection
  environment/           explicit `.env.dev` / `.env.prod` editing and preview parsing
  handoff/               agent handoff projection and orchestration
  index.ts               process composition and lifecycle
client/src/
  schema-studio/         canvases plus private graph/detail/Core component owners
  sections/              the Process screen
  components/            shared UI, settings, work panel and comment/agent surfaces
  lib/                   API client, queries, event stream and UI state
```

The domain HTTP boundary parses each non-multipart JSON body once as an untrusted
`JsonRecord`; capability routes then admit only the fields they own before calling
typed repositories or workflows. Agent routes reuse the same response helpers.
Client-side SSE handling follows a pure event-to-effects table behind one stable
subscription, so adding an event does not expand `App` or reconnect the stream.

Canvas bundle, anatomy, layout and visibility queries share one policy module.
Persisted visibility is the sole source for the tree, panels and graph projection,
while comment and Ask targets share domain-qualified identities across composed
workspace canvases.

Schema parsing delegates admission, semantic resolution, revisioning and exact
dependency reachability to the Astrale DSL installed by the domain. Studio resolves
the Application's `schema` binding statically, then a Bun subprocess imports only
that module; Studio keeps a deliberately lossy render projection and derives Core
from the same admitted root. A ts-morph overlay is limited to information absent
from the DSL (handler-file links, source spans and JSDoc).

Schema inspection does not rewrite an existing schema. Studio does perform
explicit writes requested by the user: comments, documents, settings,
layout and visibility are stored under `.domain-studio/`; the environment editor
writes `.env.dev` or `.env.prod`; creating a domain scaffolds a new source tree and
installs its dependencies. A submitted agent may edit source and run commands at
the selected access level, and install/deploy actions can change the selected
Astrale instance. The HTTP server remains bound to loopback.

## Tests

From the CLI root, `pnpm test` runs the CLI suite plus every Studio client,
server and shared unit test. `pnpm --dir studio test` runs only the complete
Studio unit suite, and `pnpm --dir studio typecheck` checks its server/client
boundary. `pnpm --dir studio test:e2e` builds the client and runs the Chromium
smoke against a real canonical fixture; CI runs that browser gate separately.
