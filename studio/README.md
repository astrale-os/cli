# Domain Studio

A local, **read-only** GUI for working with Astrale **domains**. Point it at a
domain (or a workspace) and it parses the whole thing — the **schema** above all —
and renders it far more legibly than raw code. Attach **comments / open-questions**
to any element, then hit **Submit to agent**: a *local* coding-agent harness
(Claude Code or Codex, using your existing local login) reads the context, edits
the domain code on disk, and **replies straight back into the comment threads** —
live, no copy/paste. The studio re-renders as the code changes and still never
edits domain code itself. **Copy for agent** + paste-back remain as manual
fallbacks. See
[`AGENT_LOOP.md`](./AGENT_LOOP.md).

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
`--schema-dir <name>` (default `schema`) · `--harness claude|codex` · `--open` ·
`--dev`.

By **default** it serves the **prebuilt client** (fast, always works — and what a
published/global install runs). `ASTRALE_STUDIO_DIR` points the command at an
out-of-tree studio checkout.

**`--dev` — live-edit the studio itself.** From the source checkout (`cli/studio`,
with Vite installed), `astrale studio --dev` runs a Vite dev server (client HMR) +
a watched Bun server (`bun --watch`, reloads on edits), so changes to the studio
reflect instantly. (`@astrale-os/shell` resolves to workspace source here, so Vite
pre-bundles it — `optimizeDeps` in `vite.config.ts` — and the HMR WebSocket targets
Vite directly via `STUDIO_VITE_PORT`.)

> **Requires [Bun](https://bun.sh)** — the studio server uses Bun APIs, and the
> schema introspector imports the domain's `schema/index.ts` (Astrale packages use
> Bun-only ESM that Node can't resolve). The target domain's deps must be installed
> (`pnpm install` at the workspace root) for full-fidelity schema rendering;
> otherwise the studio falls back to a static parse.

### Local agent harness

Studio detects both local harnesses and lets you choose one per domain in
**Settings → Agent → Harness**. Their resumable conversations are stored
independently, so switching harnesses does not overwrite the other one's thread.
`--harness` (or `DOMAIN_STUDIO_HARNESS`) locks the whole Studio process to one
harness and disables the selector.

- **Claude Code:** install `claude` and authenticate normally. Studio can also
  route this harness through its Anthropic-compatible model-gateway settings.
- **Codex:** install `codex` and run `codex login`. Main turns use
  `codex exec --json`; **Ask** side questions fork the current Codex thread through
  App Server without mutating the parent conversation.

The Agent settings also choose the reasoning effort and access level. **Workspace**
uses the harness's workspace-write sandbox. **Full automation** preserves the
existing deploy/install workflow and permits unrestricted local commands. Studio
remains loopback-only by default because either harness can edit files and run
commands with the authority you select.

Model selection is also remembered independently per domain and harness. Leaving
**Model** on **Default** preserves the harness's own resolution rules. Claude
reports its effective model from the runtime init event. Codex resolves its
project/profile/user/system config plus catalog default through App Server and
shows the authenticated account's live model list. Choosing an explicit model
passes `--model` to new turns, resumed turns, and isolated Ask forks without
rewriting the user's global harness config.

Codex custom providers require the OpenAI Responses API. Astrale's current
AI-gateway surface exposes Chat Completions and Anthropic Messages, so Studio does
not present the existing gateway card for Codex yet; Codex uses its own login.

### View previews

Opening a SPA view lazily starts that domain's `client` `dev:hmr` script. Studio
asks the OS for a free loopback port, so several domain frontends can run at once
without inheriting or competing for their Vite config ports. The process is reused
while a view stays open, stops after 10 minutes without a view heartbeat, and is
always terminated with Studio. Set `DOMAIN_STUDIO_VIEW_IDLE_MS` to override the
idle window (minimum 30 seconds). The frontend is local, but its `astrale view` shell session is minted
for the active Studio instance, so graph data and permissions remain instance-real.

## What it does

| Section | What it shows |
|---|---|
| **Overview** | origin, deploy adapter, prod target, `postInstall`, package + `@astrale-os` versions, schemaHash, deps/git badges |
| **Schema** ★ | classes grouped by **module** (schema/ folders), interface chips on each class, only real relationship edges (cross-module ones highlighted); click a class → props (types + JSDoc), methods (signatures, handler file, kernel calls, core refs) |
| **Methods** | flat list: `Class.method → handler file`, kernel ops, port, `contract-only`/`unlinked` badges |
| **Surfaces** | views (kind/auth/mount/viewFor), functions, client tree + routes |
| **Data** | sample rows per class, versioned by schemaHash, additive/breaking migration |
| **Context** | deliberate **user** context vs auto-computed digests (separate, opt-in to handoff) |
| **Integrations** | independent, hand-maintained list (+ a shallow `integrations/` dir hint) |
| **Cross-domains** | `requires` + non-kernel imports + kernel mixins + a wishlist |
| **Comments** | open-questions & comments; **Submit to agent** live loop (drives the selected local Claude Code or Codex harness, streams its work, merges its replies back into the threads) + **Copy for agent** / **Merge reply** manual fallback |
| **Changes** | baseline-first diff (git as enrichment); **Mark reviewed** |

## How it's built

```
shared/types.ts          the one contract (DSL IR mirror + studio overlay/state)
server/
  view-dev-server.ts     lazy per-domain Vite supervisor (ports · reuse · teardown)
  introspect/            extractor (Bun import → D.$.ir) · runtime driver · ts-morph
                         overlay (handler links, source spans, JSDoc) · anatomy · hash · diff · bundle
  state/                 store (write-allowlist) · comments · copy · baseline · git
                         · context · integrations · crossdomains · data
  detect · domain · cache · api · watch · sse · index
client/src/
  schema-studio/         the isolated visualization module (graph + detail + modules)
  sections/              the read-only section components
  components/ lib/        shadcn primitives, anchor/composer, copy-merge, hooks, store
```

Schema parsing uses the Astrale DSL's own output: a Bun subprocess imports the
domain's `schema/index.ts` and reads the compiled `D.$.ir` (the canonical
`SchemaIR`) — no hand-rolled parser. A ts-morph overlay adds what the IR can't
carry (handler-file links, source spans, JSDoc). All state lives in a
`.domain-studio/` dotted folder in each domain; the server's only write path is
allow-listed to that folder, so domain source is never modified.
