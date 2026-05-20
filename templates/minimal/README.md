# minimal — bare Astrale remote-domain scaffold

The smallest working shape of a remote-domain. Pick this template when you
don't need Views, RemoteFunctions, genesis data, or any cross-domain
dependency. For the full feature set, use the **`default`** template
(the default).

Selected via:

```
astrale domain init <slug> --template minimal
```

## What you get

- One Interface (`NoteOps`) with one static method (`createNote`).
- One Class (`Note`) implementing the interface + `KernelSchema.interfaces.Container`.
- One edge class (`references`).
- A Cloudflare Worker (`worker/`) wired through `createRemoteServer`.
- A React SPA (`worker/client/`) for `/ui/*` views, shell-handshake capable.
- An in-process fixture test.

**No `@astrale-os/distribution-domain` dependency.** This template stands
alone.

## Shape

```
<slug>/
  envs.ts                       # local:inprocess / local:tunneled / prod presets
  schema/
    schema.ts                   # Note + NoteOps + references
    index.ts
  methods/
    note-ops.ts                 # impl of createNote on the NoteOps interface
    index.ts                    # defineMethods — impl goes in `interface:` bucket
  worker/
    src/index.ts                # createRemoteServer wiring + /ui/* dispatch
    src/env.ts / src/keys.ts
    wrangler.jsonc              # routes commented out; alias + assets bindings load-bearing
    tsconfig.json
    client/                     # React SPA for /ui/* views (shell handshake-capable)
      package.json / vite.config.ts / tsconfig.json / index.html
      src/main.tsx / src/app.tsx
      src/providers/shell-provider.tsx  # handshake + setTarget intent listen
      src/routes/$slug.tsx              # dispatch renderer by URL slug
      src/renderers/default.tsx         # starter view — duplicate + specialize
      src/lib/node.ts                   # useNode(shell, nodeId) + PROP keys
      README.md                         # add-a-view guide + HMR setup
  test/
    <slug>.test.ts              # domainFixture smoke test (in-process)
    setup-env.ts / vitest.config.ts / .env.example / tsconfig.json
  package.json
  tsconfig.json
```

## Post-scaffold checklist

`astrale domain init` has already rewritten every placeholder
(`astrale-domain`, `ASTRALE_DOMAIN_`, hostnames, identifiers) to your slug.
What's left:

1. **Rotate the worker key.** `worker/src/keys.ts` ships a freshly-generated
   EdDSA pair — fine for `*.test.astrale.ai` iteration, **not** for real
   prod. Rotate before shipping.

2. **Model your domain.** The template ships `Note` / `NoteOps` /
   `references` as a placeholder example. Rename or replace once you have
   real types. If you rename `methods/note-ops.ts`, update the re-export
   in `methods/index.ts` or `pnpm test` fails.

3. **Register the sub-packages.** Add to `pnpm-workspace.yaml` at the
   workspace root (the CLI doesn't edit it for you yet):

   ```yaml
   - 'domains/<slug>'
   - 'domains/<slug>/worker'
   - 'domains/<slug>/worker/client'
   - 'domains/<slug>/test'
   ```

4. **Install & test.** `pnpm install` at the workspace root (never in
   sub-packages). `pnpm test` runs the in-process smoke test.

5. **Build, run, install — via the CLI.**

   | What | Command |
   |---|---|
   | Stamp `spec.json` for a preset | `astrale domain build [--preset <name>]` |
   | Restart local services (worker + tunnel) — run from inside this domain to target just it | `astrale domain dev up [--domain local:inprocess\|local:tunneled]` |
   | Tear them back down | `astrale domain dev down` |
   | Liveness check | `astrale domain dev status` |
   | Prepare a child instance (register / boot / install / mint) | `astrale domain instance-prepare -i <instance>` |
   | Deploy to Cloudflare | `astrale domain deploy [--preset prod]` |

   `dev up`/`down`/`status` scan the cwd recursively and act on every
   domain found (restart-by-default for `up`). Full lifecycle reference:
   the `astrale-domain-dev` skill.

6. **(Optional) Tweak the SPA.** The worker ships with a React SPA at
   `worker/client/` that renders `/ui/<slug>` views. The `default`
   renderer dumps the target node's props — duplicate + rename for
   domain-specific views. See `worker/client/README.md`.

## When to use `minimal` vs `default`

Use **`minimal`** when:
- You don't need a `View` or a `RemoteFunction`.
- You don't need genesis data (`core.ts`).
- You don't want a dependency on `@astrale-os/distribution-domain`.

Otherwise, use the **`default`** template (the CLI's default).

## Links

- Full lifecycle guide: **`astrale-domain-dev`** skill.
- Schema + method authoring reference:
  `.agents/skills/astrale-domain-dev/references/schema-and-functions.md`.
- Shared-test-zone deploy (`*.test.astrale.ai`):
  `.agents/skills/astrale-domain-dev/references/deploy.md`.
- Rich real-world remote domain: `domains/distribution/` (DO, Blaxel,
  multi-subroute worker).
- Scaffold source: `cli/templates/minimal/`.
