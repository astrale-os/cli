# Domain Studio

A local, **read-only** GUI for working with Astrale **domains**. Point it at a
domain (or a workspace) and it parses the whole thing — the **schema** above all —
and renders it far more legibly than raw code. Attach **comments / open-questions**
to any element, then hit **Submit to agent**: a *local* AI agent (Claude Code —
your own auth, no cloud key) reads the context, edits the domain code on disk, and
**replies straight back into the comment threads** — live, no copy/paste. The
studio re-renders as the code changes and still never edits domain code itself.
**Copy for agent** + paste-back remain as manual fallbacks. See
[`AGENT_LOOP.md`](./AGENT_LOOP.md).

Lives in the astrale CLI repo (`cli/studio`) and is launched by **`astrale studio`**.

## Run

```bash
astrale studio                 # open the studio for the current workspace
astrale studio ./my-domain     # …or a specific domain / workspace / astrale.config.ts path
```

`astrale studio` resolves the studio shipped with the CLI, binds the first free
loopback port in **4319–4338** (so a studio already running in another workspace
just takes the next one), and opens your browser. Flags: `--port <n>` ·
`--schema-dir <name>` (default `schema`) · `--no-open` · `--dev`.

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
| **Comments** | open-questions & comments; **Submit to agent** live loop (drives a local Claude Code, streams its work, merges its replies back into the threads) + **Copy for agent** / **Merge reply** manual fallback |
| **Changes** | baseline-first diff (git as enrichment); **Mark reviewed** |

## How it's built

```
shared/types.ts          the one contract (DSL IR mirror + studio overlay/state)
server/
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
