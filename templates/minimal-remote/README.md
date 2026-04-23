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
    src/index.ts                # createRemoteServer wiring
    src/env.ts / src/keys.ts
    wrangler.jsonc              # routes commented out; alias stack is load-bearing
    tsconfig.json
  scripts/
    build-spec.ts               # stamp spec.json for a preset
    infra-prepare.ts            # local services (astrale / cloudflared / wrangler dev)
    instance-prepare.ts         # manager: register / boot / install / mint
    minimal-remote-deploy.ts    # wrangler deploy + deployCheck inline
    lib.ts                      # liveness / kill / preset eval helpers
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

3. **Install & test.** `pnpm install` at the workspace root (never in
   sub-packages). `pnpm test` runs the in-process smoke test. Then
   `pnpm infra:prepare --kernel <k> --domain <d>` to wire the remote
   integration path.

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
