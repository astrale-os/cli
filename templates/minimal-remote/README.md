# minimal-remote

The canonical scaffold for a new Astrale remote domain.

**Copy, rename, adjust.** This folder is the smallest working shape of a
remote-domain: one Class (`Note`), one Interface (`NoteOps`) with one
static op, one edge class, one worker, one test. Deploy target is the
shared `minimal.test.astrale.ai` zone; flip the slug to your own once
you've validated the flow.

## Shape

```
minimal-remote/
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
    minimal-remote.test.ts      # domainFixture smoke test (in-process)
    setup-env.ts / vitest.config.ts / .env.example / tsconfig.json
  package.json
  tsconfig.json
```

## Post-scaffold checklist

If you got here via `astrale domain init <slug>`, every placeholder
(`minimal-remote`, `MINIMAL_`, hostnames, identifiers) has already been
rewritten. What's left:

1. **Rotate the worker key.** `worker/src/keys.ts` holds a scaffold EdDSA
   keypair — fine for `*.test.astrale.ai` iteration, **not** for real
   prod. Generate a fresh JWK pair and swap it in before deploying to a
   real slug.

2. **Model your domain.** Edit `schema/schema.ts` and `methods/` — the
   template ships with `Note` / `NoteOps` / `references` as a
   placeholder example. Delete or rename once you have real types.
   Watch out for `methods/index.ts` which re-exports `./note-ops.ts` —
   update the import if you rename the file, or `pnpm test` fails.

3. **Register the sub-packages in the workspace.** Add to
   `pnpm-workspace.yaml` at the repo root (the `astrale domain init`
   command doesn't edit the workspace file for you yet):

   ```yaml
   - 'kernel/domains/<slug>'
   - 'kernel/domains/<slug>/worker'
   - 'kernel/domains/<slug>/worker/client'
   - 'kernel/domains/<slug>/test'
   ```

4. **Install & test.** `pnpm install` at the workspace root (never in
   sub-packages). `pnpm test` runs the in-process smoke test.

5. **Build, run, install — via the CLI.** All of these used to be
   per-domain `pnpm` scripts under `scripts/`; they're now first-class
   `astrale` subcommands:

   | What | Command |
   |---|---|
   | Stamp `spec.json` for a preset | `astrale domain build [--preset <name>]` |
   | Bring up local services (worker + tunnel) | `astrale domain dev up [--domain local:inprocess\|local:tunneled]` |
   | Tear them back down | `astrale domain dev down` |
   | Liveness check | `astrale domain dev status` |
   | Prepare a child instance (register / boot / install / mint) | `astrale domain instance-prepare -i <instance>` |
   | Deploy to Cloudflare | `astrale domain deploy [--preset prod]` |

   Full lifecycle reference: the `astrale-domain-dev` skill.

6. **(Optional) Tweak the SPA.** The worker ships with a React SPA at
   `worker/client/` that renders `/ui/<slug>` views. The `default`
   renderer dumps the target node's props — duplicate + rename for
   domain-specific views. See `worker/client/README.md`.

## Links

- Full lifecycle guide: **`astrale-domain-dev`** skill.
- Schema + method authoring reference:
  `.claude/skills/astrale-domain-dev/references/schema-and-functions.md`.
- Shared-test-zone deploy (`*.test.astrale.ai`):
  `.claude/skills/astrale-domain-dev/references/deploy.md` → "Shipping to
  the shared `*.test.astrale.ai` zone".
- Rich real-world remote domain: `kernel/domains/distribution/` (DO, Blaxel,
  multi-subroute worker).
- Scaffold source (what this README was copied from):
  `cli/templates/minimal-remote/` in the `@astrale-os/astrale` repo.
