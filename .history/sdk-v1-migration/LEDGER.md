# CLI SDK V1 migration ledger

## Current phase

`QUALIFICATION — published SDK boundary and complete CLI package gate green`

The ordinary CLI dependency graph now resolves the published SDK beta.25 and Shell 0.4.1 without a
source checkout, workspace override, vendored archive, or cohort adapter. The exact SDK release owns
one Kernel Client/Core/DSL/Protocol/Server set; the CLI remains an SDK-only consumer and its package
gate passes against the registry graph.

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

## Ordinary package compatibility — 2026-08-24

- The temporary exact-source action, `.cohort` workspace, source overrides, checkout credential,
  topology verifier/tests, and vendored SDK/Shell archives were removed.
- Root and Studio manifests now name ordinary package ranges. CI, binary release, and publication
  install only the frozen public dependency graph.
- The semantic source boundary and private Kernel Ports/Runtime exclusion remain. The public
  dependency check now rejects source protocols and stale source topology directly in manifests,
  workspace configuration, and the lockfile.
- The lockfile was regenerated from the two ordinary workspace manifests. It resolves released SDK
  beta.15, Shell beta.3, and current Kernel client/core/DSL/protocol/server beta.9/beta.8/beta.6
  packages with no source links, hidden importers, or vendored Astrale archives.
- Public dependency and semantic source-boundary checks pass. Typecheck now fails honestly because
  released SDK beta.15 predates the merged facade exports consumed by CLI (`/client/session`, `K`,
  `ClassKey`, `LocalBinding`, and current Query source input). This remains a package publication gap,
  not permission to restore source checkout machinery.

## No-regression rule

Each migrated slice must retain the governing CLI law/test evidence or record a deliberate product
change. Passing through widened casts, copied Kernel types, string-parsed private errors, weakened
authority, or deleted tests does not count.

## Published SDK beta.25 closure — 2026-08-24

- SDK publish run `32764984425` completed successfully from main SHA
  `5ad2b5682c678d59e78f31c601c9991b3a0174fd` and qualified the exact npm publications.
- The CLI lock resolves SDK `0.5.0-beta.25`, Shell `0.4.1`, Kernel Client `0.6.0-beta.11`, Core
  `0.9.0-beta.10`, DSL `0.2.0-beta.8`, Protocol `0.5.0-beta.10`, and Server `0.5.0-beta.11`.
  The supported SDK and Shell manifest ranges remain unchanged; exact release selection belongs to
  the lockfile.
- `pnpm package:check` passes from the ordinary registry graph: four strict typecheck lanes, 785 Bun
  tests with one intentional skip, 15 Node release/skill tests, CLI/public/Viewer/Studio builds,
  Node-loadable exports, and the private Kernel dependency-closure gate.
- The source boundary reports 426 production files, 196 test files, and 51 governing specification
  files with zero direct Kernel imports, removed SDK surfaces, or Interface-era fields. Formatting
  and `git diff --check` pass.

## Published SDK beta.16 qualification — 2026-08-24

- Root and Studio now require SDK `>=0.5.0-beta.16 <1.0.0`; the ordinary lock resolves beta.16 and
  the released Kernel beta.9/beta.8/beta.6 package set with no source link or cohort topology.
- One first-party `@astrale-os/*` release-age exclusion replaces version-specific Astrale
  exceptions. Third-party packages retain the existing age gate.
- Strict CLI, tests, Viewer, and Studio typecheck passes. The previously merged direct-node Query
  authoring was restored after the later SDK migration merge reintroduced the removed source form;
  its six focused tests pass on Bun 1.4.0.
- Full test and build qualification now reaches the remaining registry boundary: published Shell
  beta.3 imports removed SDK subpaths (`/domain`, `/schema/kernel`, and `/graph/model`). No source
  checkout or compatibility alias was restored. CLI completion requires publication of the merged
  Shell package, followed by one ordinary lock refresh and full package check.

## Exact packed Shell qualification — 2026-08-24

- Replaced only the installed published Shell beta.3 package with the immutable package built by
  Shell PR #54; CLI source, manifests, and lockfile remained unchanged and no source checkout or
  override was introduced.
- CLI production/tests, Viewer, and Studio strict typecheck pass. The complete Bun suite passes 786
  tests with one canonical-skill mirror skip; release workflow tests pass 14/14.
- The CLI executable, public subpaths, Viewer, and Studio build; lint, formatting, public exports,
  and the private dependency-closure gate pass.
- Real Chromium exposed a stale SDK V1 fixture whose property and Core declarations had been removed
  while their assertions remained. Restoring those declarations through current SDK APIs preserves
  the intended browser evidence, and the exact smoke now passes.
- The only ordinary-package difference from green CI is the unpublished Shell artifact. Once Shell
  PR #54 is merged and released, refresh the ordinary lock and rerun the same package check; no code
  fallback or cohort topology is required.

## Fresh local Kernel CLI proof — 2026-08-24

- Built the branch executable with the immutable Shell PR #54 package substituted only in the
  installed package tree. No source checkout, workspace member, manifest override, or cohort
  mechanism was introduced.
- Started a clean Kernel from `/private/tmp/kernel-flagship-live` with an isolated data root and
  local TLS on `https://localhost:18443/kernel/host`.
- Imported the generated bootstrap identity into an isolated `ASTRALE_HOME`, bookmarked the Kernel
  with its exact CA and bookmark-scoped identity, and observed the selected instance through
  `astrale status`.
- `astrale get @self` authenticated and returned the canonical Kernel root Identity node.
- `astrale introspect /:kernel.astrale.ai:class.Identity:whois` returned the exact authorized static
  Method contract.
- `astrale call /:kernel.astrale.ai:class.Identity:whois` returned the expected issuer, subject,
  node id, claim requirements, and frozen state. This is a real signed CLI to local-Kernel call, not
  a transport mock or raw HTTP replacement.

## Final SDK facade and Runtime-context pass — 2026-08-24

- The shipped Domain skill now teaches Providers-only Runtime initialization, `domain` as the exact
  loaded Domain, Integration-definition generics, and invocation-bound `query`/`mutate`. It rejects
  `ActionServices`, Runtime `deps`, `context.work`, and public Workflow activation examples.
- CLI production, tests, and governing `.spec` contracts now import Astrale platform semantics only
  through the SDK facade. The root manifest removed all five direct Kernel packages; Kernel packages
  remain ordinary transitive SDK implementation dependencies in the lock.
- `@astrale-os/sdk/value` gained the missing identity re-export of Core DNS-label admission. The CLI
  did not copy the rule or add a shadow validator.
- The source-boundary gate reports 426 production files, 197 test files, 51 specification files,
  zero direct Kernel imports, zero legacy surfaces, and zero Interface-era fields.
- Strict CLI/test/Viewer/Studio typecheck passes against one aligned stacked SDK identity. The full
  suite passes 786 tests across 186 Bun files with one intentional skip, plus 15 Node release/skill
  tests. CLI/public subpaths, Viewer, and Studio build successfully; public export and dependency
  checks pass.
- The dependency check reads only Git-tracked Studio sources and disables dependency traversal, so
  an installed or linked package graph cannot escape the intended source census. It also proves root
  and Studio manifest names/specifiers exactly match their frozen-lock importers.
- SDK PR #153 is remotely green against the published Kernel beta.10/beta.9/beta.7 set. CLI and
  Studio now declare beta.17 as the honest SDK lower bound for the Publication and value facades
  consumed here.
- The ordinary lock now resolves published SDK beta.17 and Shell 0.4.1, with Kernel packages only
  through their owning public dependency closures. No source link, workspace override, direct
  Kernel manifest dependency, repository credential, or cohort topology remains.
- The complete non-TTY package gate passes: strict CLI/tests/Viewer/Studio types, 786 Bun tests with
  one intentional skip, 15 Node workflow/skill tests, CLI/public subpath/Viewer/Studio builds,
  formatting, public exports, and private Kernel dependency exclusion. A PTY-only local rerun made
  four machine-envelope tests exercise their human-output branch; the required non-TTY rerun passed
  without changing production or tests.

## Instance-only Admin journey — 2026-08-24

- Removed `--host-id`, Host inventory reads, Host receiver invocation, picker/message parsing,
  `HOST_NOT_FOUND`, `hostId`/`region` Instance projections, and every Host field from Instance status
  and list output. The CLI now requests `Fleet.createInstance` with only `operationId` and `slug`;
  Admin owns placement.
- Instance create/status/delete and Domain publish now retain typed remote failures through the
  existing connection failure renderer instead of masking `ResponseError` as `UNEXPECTED_ERROR`.
- `domain publish --public-url` now accepts the documented deployment origin or the exact canonical
  Publication URL and stores one normalized discovery URL.
- Strict production/test/Viewer/Studio typecheck passes. The focused Instance, Publication, and help
  suites pass 38 tests with one intentional canonical-skill skip.
- An immutable source tarball installed into Alice's isolated npm prefix exposed no Host/Fleet flag
  or help text. `astrale instance create cli-beta35-fresh --json` completed against the live Admin,
  automatically selected infrastructure, and returned only `id`, `slug`, `url`, lifecycle fields,
  creation time, and organization id; no Host identity or region leaked.

## Public npm publication boundary — 2026-08-24

- `@astrale-os/cli@1.0.0-beta.6` was installed in a fresh temporary root from npm and its Node
  executable returned the exact version and complete command help without a workspace or source link.
- Publication now uses the pinned Config action at `2e1bc75459014f38323b57213949b9f9dd530054`
  and npm OIDC only. The optional GitHub Packages mirror, repository package permission, and package
  token input were removed; ordinary public package metadata and lockfiles remain the compatibility
  authority.
- The focused workflow contract passes 7/7. The complete non-TTY package gate again passes 786 Bun
  tests with one intentional skip, 15 Node tests, all strict type lanes, every production build,
  public export checks, and the private Kernel dependency-closure check.

## Exact Instance caller and SDK cohort — 2026-08-24

- Instance creation, managed selection, and setup adoption now persist the exact local identity label
  used for the successful Admin call. Selection is resolved once at the connection boundary from
  explicit `--as`, the Admin bookmark default, or the CLI default. Raw `--creds` persists no label;
  no token, subject, assertion, or private material enters the Instance bookmark.
- The published SDK beta.24 graph reproduced two Core and DSL versions and failed strict CLI types.
  The exact packed SDK candidate owns one Kernel cohort; a fresh copied CLI consumer resolves one
  Core beta.10 and one DSL beta.8 and passes all four strict type lanes.
- Focused candidate evidence passes 22 Admin, setup, Instance-use, and connection tests. In a fresh
  copied Git repository consuming the exact packed SDK candidate, all strict type lanes, the source
  boundary, 785 Bun tests with one intentional skip, 15 Node tests, CLI/public/Viewer/Studio builds,
  public exports, and the private Kernel dependency exclusion pass. No source link, cohort override,
  downstream Kernel dependency, or cross-brand cast was introduced.
