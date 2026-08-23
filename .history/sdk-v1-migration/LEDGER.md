# CLI SDK V1 migration ledger

## Current phase

`QUALIFICATION — local CLI/Studio/Viewer migration green`

## Exact cohort

| Owner | Reference | SHA |
| --- | --- | --- |
| CLI | `origin/main` | `53ce495f23b458e245cd82e41919ecdce5f8dc57` |
| Shell migration | `refactor/sdk-v1-migration` | `8a7ff6147191ac8756a8d18497a400ef03234a41` (based on `46a51fe7ccfa1c448b1067491db5685f142f1d29`) |
| SDK | `origin/main` plus PR #146 | `a210e3c12c8a4b11d19c0651b870e77b2ff19fef` / `7cf8b9e052da4c5c91c091b56e416ca3e189a8f0` |
| Kernel DSL redesign | `origin/refactor/dsl-v1-redesign` plus PR #387 | `29610d232eb5df0ffd5c9d70dc70323577f9ec0d` / `a80568d6083fd3af6f3646a8abb95338e6ae3434` |

The primary CLI and Shell worktrees remain untouched.

## Released-cohort baseline

- Typecheck passes across CLI, Viewer, and Studio.
- Lint and formatting pass.
- 183 Bun test files pass 792 tests; one canonical-skill mirror test is skipped.
- Release workflow Node tests pass 14/14.

## Exact V1 breakage baseline

- 38 TypeScript diagnostics across 11 source files.
- 25 diagnostics are the flat Admin `DomainBinding.$` interpreter.
- Remaining failures are removed `schema/kernel`, `graph/model`, `sdk/domain`, and `ClassPath` paths;
  Query `definitions`/`QueryDefinitionRef`; and Interface-era comparisons.
- This diagnostic count is only compile-visible breakage. `inventory.json` separately tracks
  Interface-era Studio/spec semantics that can remain structurally type-correct while being obsolete.

## Implemented slices

- CLI Graph owns ClassRef/ClassKey command admission and authors Query V6 / Mutation V3 only.
- Admin uses resolved Domain Classes, Core values, Client callable references, and `session.invoke`.
- Callable description resolves the admitted Bundle through the SDK Schema facade instead of
  interpreting raw Schema bags.
- Studio admits and projects canonical V1 Classes, Functions, Views, Policies, Core, and exact
  imported Classes; Interface, materialization, short-name import, compiled-IR, and legacy project
  compatibility paths are removed.
- Studio discovers Application/Schema/Runtime authoring, modular Action/Workflow handlers, and
  `defineFrontend` Vite/external routes including SDK-owned default route derivation.
- Studio render IR now carries one canonical callable input/output contract; obsolete
  `params`/`returns`, source-overlay auth reconstruction, post-install seed, and Interface fallbacks
  were removed. The Process view identifies implementations as Actions or Workflows.
- `pnpm migration:audit -- --target` reports zero removed surfaces and zero Interface-era production
  fields on the current migration tree.

## Current qualification evidence

- Full typecheck passes for CLI production/tests, Viewer, and Studio.
- Full Bun suite: 184 files, 777 pass, one canonical-skill mirror skip, zero failures, 1,992
  expectations. The release workflow adds 14/14 passing Node tests.
- The net 15-test reduction from the 792-pass baseline comes from consolidating repetitive
  Interface/legacy-projection cases into exact Class-only projection, homonym, import, frontend, and
  render-IR admission journeys. No test file was deleted; 48 owner test files were migrated and one
  canonical admission test file was added. Retained command, transport, identity, Admin, Studio
  workspace, frontend, and release behavior remains owner-tested.
- Lint, format check, build, Node-loadable public subpaths, and the public dependency boundary pass.
- The production build includes the CLI executable, public subpaths, Viewer, and the Vite-built
  Studio client. The existing source-bearing npm archive dry-run succeeds with 590 files.
- CI, binary release, and package publication check out the exact unpublished Kernel, SDK, and Shell
  cohort plus SDK's nested Kernel link with repository-scoped credentials. The lock records all nine
  physical importers; clean runners do not depend on developer symlinks.
- Remote exact-cohort jobs require a cross-repository Actions credential selected for the CLI
  repository. The current job token cannot read private sibling repositories, and the configured
  package token is absent. A clean published-cohort control installed successfully but produced 34
  expected SDK V1 type errors, proving that falling back to released beta packages would be false
  qualification.
- Inventory: 421 production files / 50,789 lines; 193 test files / 20,095 lines; 51 specification
  files / 1,718 lines. Both removed-surface inventories are empty.

## Deliberate public changes

- `query --definition` now documents and admits an exact Class only. Interface authoring was removed
  by DSL V1; every other command, argument, option, behavior flag, and help entry remains unchanged.
  The exhaustive program-surface hash changed from `44f78959…` to `42b4812a…` for that one help line.

## No-regression rule

Each migrated slice must retain the governing CLI law/test evidence or record a deliberate product
change. Passing through widened casts, copied Kernel types, string-parsed private errors, weakened
authority, or deleted tests does not count.
