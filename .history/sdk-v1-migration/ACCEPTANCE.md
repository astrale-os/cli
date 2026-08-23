# CLI SDK V1 acceptance

## Structure and ownership

- No removed SDK Domain, graph/model, schema/kernel, ClassPath, `schemaRef`, flat `$`, or
  `QueryDefinitionRef` surface remains in production or governing specs.
- CLI command grammar and public package exports change only through ledgered decisions.
- Connection delegates route/publication/transport behavior to Kernel Client.
- Admin binds resolved Domain Classes and callable references without reconstructing Functions,
  Methods, Interfaces, or member ownership.
- Graph admits Query V6 and Mutation V3 only.
- Studio/Viewer render the no-Interface canonical Schema without retaining a parallel rich Domain.
- Studio discovers only Application plus Schema authoring, maps modular Action/Workflow declarations,
  and derives explicit/default Vite and external frontend routes from `defineFrontend`.

## Product behavior

- All 792 baseline tests remain or are replaced by stronger owner evidence; deliberate removals are
  enumerated with their replacement test journey.
- Identity create/import/export/register and exact target-bound registration persistence remain
  unchanged.
- Anonymous, local-key, IdP, Admin, remote redirect, `@self`, and custom-CA connection journeys
  retain their authority and cleanup guarantees.
- `get`, `query`, `mutate`, `call`, `introspect`, `logs`, Domain install/uninstall, instance, token,
  and view commands retain machine output and error semantics.
- Studio and Viewer retain workspace discovery, schema comparison, app opening, and live CLI
  orchestration for the new authoring layout.

## Qualification

- Typecheck, lint, format, all tests, build, package checks, public export checks, and dependency
  boundary checks pass on the exact cohort.
- Representative command E2E proves status, automatic bookmark identity selection, graph reads,
  callable invocation, Domain installation, and exact receiver Methods against an
  authority-enabled tunneled Kernel and remotely deployed Cloudflare Shell.
- Authority-sensitive fresh install/setup proves Root-only bootstrap followed by ordinary external
  administrator/Member identities, Policy denial, promotion, revocation, and restart persistence.
  No anonymous or local bypass counts.

## Evidence retained so far

- Kernel Client: typecheck; 25 files / 141 tests; repository pre-push typecheck and layout gates.
- SDK: typecheck; 76 files / 444 tests; knowledge, policy, issue, and release workflow checks.
- CLI/Viewer/Studio: exact-cohort full typecheck; lint; format; build; public export and dependency
  checks; 184 Bun files with 777 pass / one skip / zero fail; and 14/14 release workflow Node tests.
- The 15-pass reduction from baseline is the consolidation of repetitive Interface/legacy
  projection cases into Class-only exact-identity and canonical admission journeys. No test file was
  deleted: 48 owner test files were migrated and one canonical admission file was added; no retained
  command or Studio journey was removed.
- Package dry-run succeeds with 590 files. Its source-bearing shape is pre-existing and remains
  unchanged in intent because Studio executes server/shared source from the installed CLI package.
- Live representative Kernel commands and authority-dependent fresh Shell setup are green. The only
  remote gate is repository administration: CLI Actions needs a credential that can check out the
  exact private Kernel, SDK, and Shell cohort.
