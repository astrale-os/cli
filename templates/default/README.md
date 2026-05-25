# default — full-feature Astrale remote-domain scaffold

The default scaffold (`astrale domain init <slug>`). Demonstrates every
common feature in one minimal, working domain:

- One **Interface** (`NoteOps`) with one static method (`createNote`) —
  impl lives in the `interface:` bucket of `defineMethods` (the kernel CLI
  emits subs for `interface.X:M` since the `MEMBER_NS_PREFIXES` fix, so
  this works end-to-end).
- One **Class** (`Note`) implementing the interface + `Container`, with
  one class-hosted **instance method** (`reference`) that uses `self.path`
  to create a real edge to another Note, and a real `authorize` returning
  `[{ nodes: [self.path], perm: USE }]` (the kernel-runtime permission shape).
- One **edge class** (`references`) linking `Note` → `Note` — actually
  created at runtime by `reference` (worker uses `kernel.call('…::link')`,
  fixture uses `kernel.graph.createEdge`).
- One **`core.ts`** — install-time genesis data via `defineCore` + `node()`.
- One **`lifecycle.ts`** — zero-config stub exposing `extraDevVars`.
- One **`View`** (`ui-note`) — auto-materialized from the `views:` map in
  `domain.ts` via `defineView`. Uses `@astrale-os/distribution-domain`'s
  `View` / `view_for` classes.
- One **`RemoteFunction`** (`count`) — auto-materialized from the
  `remoteFunctions:` map via `defineRemoteFunction`. Stubbed (returns `0`);
  swap in a real `kernel.call(...)` listing. Uses
  `@astrale-os/distribution-domain`'s `RemoteFunction` class.
- A Cloudflare **Worker** wired through `createRemoteServer`, with a
  parallel `defineRemoteDomain<Env>()` for real impls.
- A **React SPA** (`worker/client/`) served at `/ui/*`, shell-handshake
  capable.
- An in-process **fixture test** that exercises `createNote` and asserts
  the real `references` edge created by `reference` (via `expectEdge`).

If you want fewer concepts and no cross-domain dependency, use
`astrale domain init <slug> --template minimal`.

## Cross-domain dependency

Importing `View` / `RemoteFunction` requires
**`@astrale-os/distribution-domain` (semver `>=0.0.0 <1.0.0`)** as a
dependency. The package is unpublished today; in practice this template
**expects to be scaffolded inside the Astrale monorepo** so pnpm's
workspace symlink resolves the dep. If you don't need View/RemoteFunction,
use the `minimal` template instead — no cross-domain dep.

## Shape

```
<slug>/
  envs.ts                       # local:inprocess / local:tunneled / prod presets
  lifecycle.ts                  # extraDevVars (DISTRIBUTION_BASE_DOMAIN), hooks
  core.ts                       # defineCore — genesis nodes
  domain.ts                     # defineRemoteDomain + views + remoteFunctions + core
  schema/
    schema.ts                   # NoteOps + Note(createNote, reference) + references
    index.ts
  methods/
    note-ops.ts                 # in-process fixture impls (interface + class)
    index.ts                    # defineMethods — interface: + class: buckets
  worker/
    src/index.ts                # parallel defineRemoteDomain<Env>() + JWKS intercept
    src/env.ts / src/keys.ts / src/schema.ts
    src/methods/                # real remoteMethod<Env>() impls
    wrangler.jsonc              # routes commented out; alias + assets bindings load-bearing
    tsconfig.json
    client/                     # React SPA for /ui/* views (shell handshake-capable)
  test/
    <slug>.test.ts              # domainFixture smoke test (createNote + reference/expectEdge)
    setup-env.ts / vitest.config.ts / .env.example / tsconfig.json
  package.json                  # depends on @astrale-os/distribution-domain (semver)
  tsconfig.json
```

## Post-scaffold checklist

`astrale domain init` has already rewritten every placeholder
(`astrale-domain`, `ASTRALE_DOMAIN_`, hostnames, identifiers) to your slug.
What's left:

1. **Rotate the worker key.** `worker/src/keys.ts` ships a freshly-generated
   EdDSA pair — fine for `*.test.astrale.ai` iteration, **not** for real
   prod. Rotate before shipping.

2. **Model your domain.** Rename `Note` / `NoteOps` / `references` to your
   real types. If you rename `methods/note-ops.ts`, update the re-export
   in `methods/index.ts` or `pnpm test` fails. The same goes for the
   worker counterpart under `worker/src/methods/`.

3. **Adjust `DISTRIBUTION_BASE_DOMAIN`.** `lifecycle.ts` defaults to
   `dist.localhost`. Override via shell env or `.env.local` if your local
   distribution install lives somewhere else.

4. **Register the sub-packages.** Add to `pnpm-workspace.yaml` at the
   workspace root (the CLI doesn't edit it for you yet):

   ```yaml
   - 'domains/<slug>'
   - 'domains/<slug>/worker'
   - 'domains/<slug>/worker/client'
   - 'domains/<slug>/test'
   ```

5. **Install & test.** `pnpm install` at the workspace root (never in
   sub-packages). `pnpm test` runs the in-process smoke test (exercises
   `createNote` and `reference`, asserting the `references` edge).

6. **Build, run, install — via the CLI.**

   | What | Command |
   |---|---|
   | Stamp `spec.json` for a preset | `astrale domain build [--preset <name>]` |
   | Restart local services (worker + tunnel) | `astrale domain dev up [--domain local:inprocess\|local:tunneled]` |
   | Tear them back down | `astrale domain dev down` |
   | Liveness check | `astrale domain dev status` |
   | Prepare a child instance (register / boot / install / mint) | `astrale domain instance-prepare -i <instance>` |
   | Deploy to Cloudflare | `astrale domain deploy [--preset prod]` |

7. **(Optional) Tweak the SPA.** `worker/client/` renders `/ui/<slug>`
   views. The `default` renderer dumps the target node's props — duplicate
   + rename for domain-specific views. See `worker/client/README.md`.

## Why interface-hosted methods are fine now

`domains/notes/` (an older example) uses static methods on the **class**
to sidestep a CLI bug where `collectFunctionSubs` only emitted subs for
`class.X:M`. That bug has been fixed
(`cli/src/lib/domain-identity.ts` now emits subs for both `class.` and
`interface.` member paths), so this template **hosts `createNote` on the
`NoteOps` interface** — the cleaner pattern.

## Links

- Full lifecycle guide: **`astrale-domain-dev`** skill.
- Schema + method authoring reference:
  `.agents/skills/astrale-domain-dev/references/schema-and-functions.md`.
- Shared-test-zone deploy (`*.test.astrale.ai`):
  `.agents/skills/astrale-domain-dev/references/deploy.md`.
- Rich real-world remote domain: `domains/distribution/` (DO, Blaxel,
  multi-subroute worker).
- Scaffold source: `cli/templates/default/`.
