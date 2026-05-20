# astrale-domain-client — SPA for domain views

React SPA that renders the `/ui/<slug>` views. Loaded inside an iframe
mounted by the shell; boots a sandboxed `Shell` (see
`src/providers/shell-provider.tsx`) to get the handshake + kernel client
+ `targetNodeId`.

## Add a view

1. Create `src/renderers/<slug>.tsx` — a React component `{ shell, nodeId } => ...`.
   Use `useNode(shell, nodeId)` from `src/lib/node.ts` to fetch the target
   node via `@<id>::get`.
2. Register it in `src/renderers/index.ts` (`RENDERERS[slug] = ...`).
3. In your domain methods (e.g. `Distribution.init`-equivalent), seed a
   `View` node with `url: '<WORKER_URL>/ui/<slug>'` and a `view_for`
   edge (instance-level or class-level).

## Dev loops

### Fast rebuild (default)

```bash
pnpm dev    # vite build --watch → writes to ../dist-client/
```

Worker (`wrangler dev`) serves `dist-client` via `assets:`. Each save
rebuilds in ~300ms, wrangler auto-reloads. No HMR — the iframe reloads.

### HMR (React fast-refresh)

```bash
pnpm dev:hmr    # vite dev on http://127.0.0.1:5173/
```

Plus in the worker's `.dev.vars`:

```
VIEW_DEV_URL=http://127.0.0.1:5173
```

The worker forwards `/ui/*` to `vite dev` — React HMR keeps component
state on save.

## Build

```bash
pnpm build    # → ../dist-client/{index.html, assets/*}
```

Code-splitting is enabled (TanStack Router auto-split) — each slug
route is a lazy chunk.

## Hot-swap (parent → child)

The shell `setTarget` intent lets the parent swap the target node
without remounting the iframe. `ShellProvider` subscribes in
`src/providers/shell-provider.tsx` → `setNodeId`. Consumers just
`useNode(shell, nodeId)` and re-render on `nodeId` change.
