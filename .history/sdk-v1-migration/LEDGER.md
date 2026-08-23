# CLI SDK V1 migration ledger

## Current phase

`QUALIFICATION — local and live Shell journey green; remote credential pending`

## Exact cohort

| Owner | Reference | SHA |
| --- | --- | --- |
| CLI | `origin/main` | `53ce495f23b458e245cd82e41919ecdce5f8dc57` |
| Shell migration | PR #52 `refactor/sdk-v1-migration` | `fde37d648d228d2e26be5504e77f5d353966f546` (based on `46a51fe7ccfa1c448b1067491db5685f142f1d29`) |
| SDK | `origin/main` after PR #146 plus PR #149 | `af5884810048758d05e9606235fcb83846a9871e` / `5ef94974a0a551e95281860bb57197cbe0c2f575` |
| Kernel DSL redesign | merged PR #385 plus PR #394 | `29610d232eb5df0ffd5c9d70dc70323577f9ec0d` / `7dfe060d819321ddf8004a74c203c86cc9d35c53` |

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
  Catalog and Instance graph reads now also use the exact resolved `Domain`, `Host`,
  `fleet_installs_domain_by_default`, and `fleet_reserves_admin_host` Classes. CLI no longer copies
  Admin origin/reference coordinates after binding the installed revision.
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
- The source-boundary gate inside `pnpm test` reports zero removed surfaces and zero Interface-era
  production fields on the current migration tree.

## Current qualification evidence

- Full typecheck passes for CLI production/tests, Viewer, and Studio.
- Full Bun suite: 184 files, 777 pass, one canonical-skill mirror skip, zero failures, 1,992
  expectations. Release and exact-source contracts add 32/32 passing Node tests.
- The net 15-test reduction from the 792-pass baseline comes from consolidating repetitive
  Interface/legacy-projection cases into exact Class-only projection, homonym, import, frontend, and
  render-IR admission journeys. No test file was deleted; 48 owner test files were migrated and one
  canonical admission test file was added. Retained command, transport, identity, Admin, Studio
  workspace, frontend, and release behavior remains owner-tested.
- Lint, format check, build, Node-loadable public subpaths, and the public dependency boundary pass.
- The production build includes the CLI executable, public subpaths, Viewer, and the Vite-built
  Studio client. The existing source-bearing npm archive dry-run succeeds with 590 files.
- CI, binary release, and package publication delegate exact unpublished Kernel, SDK, and Shell
  materialization to one repository-local action with one repository-scoped credential. One
  SDK-internal link binds the same physical Kernel root; no second Kernel checkout exists. The lock
  records all nine importers, and the actual verifier rejects a package or internal link from a
  same-revision alternate clone. Source declarations, action admission, workflow delegation,
  reusable release secrets, publication, workspace topology, and installed roots each have one
  small owner plus focused tests; there is no mixed cohort configuration module or workflow-local
  checkout inventory.
- Remote exact-cohort jobs require a cross-repository Actions credential selected for the CLI
  repository. The current job token cannot read private sibling repositories. The existing
  `NPM_TOKEN` resolves but is a registry credential, not a GitHub repository credential; selecting it
  first reproduces `Repository not found` for `astrale-os/kernel`. Workflows now require the explicit
  `COHORT_REPOSITORY_TOKEN` secret before any sibling checkout. A clean published-cohort control
  installed successfully but produced 34 expected SDK V1 type errors, proving that falling back to
  released beta packages would be false qualification. The workflow must receive a real
  cross-repository Actions credential; no source vendoring or released-cohort weakening is accepted.
- Inventory: 430 production files / 51,060 lines; 199 test files / 20,305 lines; 51 specification
  files / 1,718 lines. Both removed-surface inventories are empty.

## Final cleanup and source-cohort process — 2026-08-23

- `.github/actions/exact-sources` is the sole production owner of all three unpublished revisions,
  checkout paths, non-persistent repository credentials, and the SDK-internal Kernel link. Two CI
  jobs, two binary-release jobs, and package publication each call it once; the artifact-only
  release job performs no source checkout.
- One ignored `.cohort` root and one frozen source descriptor list derive seven workspace members,
  seven overrides, installed-package checks, and three expected physical roots. `pnpm test` starts
  with the real verifier, then runs 14 actual-file configuration/root tests. Revisions, paths,
  repositories, action/workflow credentials, credential persistence, workspace aliases, physical
  roots, publication ordering, and reusable secret scope all fail closed.
- `release.yml` passes exactly `COHORT_REPOSITORY_TOKEN` to the reusable binary workflow; broad
  `secrets: inherit` is gone. Registry/package credentials remain separate. The package-publication
  install verifies the exact roots before prepack.
- The source adapter is explicitly temporary. Once Kernel, SDK, and Shell are published as one
  compatible cohort, the action, `.cohort` workspace members/overrides, and repository-read secret
  are removed together rather than becoming permanent release infrastructure.

## Deliberate public changes

- `query --definition` now documents and admits an exact Class only. Interface authoring was removed
  by DSL V1; every other command, argument, option, behavior flag, and help entry remains unchanged.
  The exhaustive program-surface hash changed from `44f78959…` to `42b4812a…` for that one help line.

## Live CLI acceptance

- The built migration CLI targeted the fresh tunneled Kernel through bookmark `shell-live`. Its
  bookmark-scoped Root identity was selected automatically for the one bootstrap call; no `--as`
  override or anonymous fallback was required.
- The CLI installed the real Cloudflare Shell Release through exact Publication, Bundle, JWKS, and
  nonce-bound Delivery, then called the installed remote Domain through Kernel routing.
- Test-only Alice, Bob, Carol, and Dave Shell identities were imported without printing private key
  material and selected explicitly with `--as`. Their issuer was admitted by the Host Trust policy;
  Kernel callable authority and Shell Policy remained independent gates.
- CLI calls proved administrator setup, Member denial, promotion, revocation, all six retained Shell
  Methods, idempotent setup, personal/default Space changes, and state after a Kernel restart.
- `astrale status` reports both the bookmark's automatic default identity and the independent global
  identity-store default. Seeing no global default does not change connection selection; ordinary
  Kernel commands use the bookmark identity unless `--as`, `--creds`, or `--anonymous` overrides it.

## No-regression rule

Each migrated slice must retain the governing CLI law/test evidence or record a deliberate product
change. Passing through widened casts, copied Kernel types, string-parsed private errors, weakened
authority, or deleted tests does not count.
