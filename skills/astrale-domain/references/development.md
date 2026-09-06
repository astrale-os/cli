# Development

Start from the generated project and the installed SDK's public exports, not remembered syntax.
The SDK owns building/deploying the Domain; the Astrale CLI owns instances, identities, and live calls.

## Scaffold and dependencies

```sh
npx create-astrale-domain@beta issues \
  --yes --adapter astrale --frontend react --instance development \
  --origin issues.example --dir issues --no-link
```

- Keep an existing scaffold rather than recreating its plumbing. For reproducible release checks,
  use an exact published scaffolder/SDK/adapter cohort and retain the lockfile.
- Domain code imports semantic `@astrale-os/sdk/*` facades, not Kernel packages or private SDK paths.
  Declare the chosen adapter only; its transitive implementation adapter is not another direct dependency.
- Declare libraries source actually imports: exact SDK-compatible `zod`, and frontend UI/React Shell
  packages when used. Zod runtime identity matters; a structurally compatible second copy can fail compilation.

## Composition and owners

```text
schema/             business modules: classes, policies, functions, errors, types, states, core, views
functions/          Actions and Workflows together
queries/            graph observations and their projections
mutations/          atomic graph changes
rules/              pure business decisions
integrations/       consumer-owned external contracts
providers/          environment-backed implementations
routes/             optional native HTTP-to-callable declarations
views/ and ui/      client orchestration and presentation
runtime.ts          integrations, initialize, functions
application.ts      schema, runtime, frontend, optional routes, requirements
astrale.config.ts   defineProject: application, environments, optional tests
```

- Create only applicable layers and business owners. Keep curated `#` facades and one meaningful
  callable/Query/Mutation per file; do not manufacture empty layers or a universal repository.
- Runtime imports aggregate Schema as a type and uses its admitted `domain`. Focused runtime-safe
  errors, values, and StateMachines may be value imports; aggregate DSL declarations stay build-side.

```ts
// runtime.ts — ordinary imports provide integrations, providers, functions, and Environment.
import { defineRuntime } from '@astrale-os/sdk/runtime'
import type { schema } from '#schema'

export default defineRuntime<typeof schema>()({
  integrations,
  initialize(environment: Environment) {
    return { providers: { weather: createWeatherProvider(environment) } }
  },
  functions,
})

// application.ts
import { defineApplication, requirements } from '@astrale-os/sdk/application'
import { K } from '@astrale-os/sdk/schema'
// Import schema as a value here, plus runtime and frontend from their composition owners.
export const application = defineApplication({
  schema, runtime, frontend,
  requirements: requirements({ functions: [K.functions.query, K.functions.mutate] }),
})
```

- Initialize Providers once from admitted environment. No Provider I/O at module scope and no handlers,
  authorization, or deployment effects in composition roots.
- Requirements are inert Application composition, not a top-level `requirements/` layer. Schema
  dependencies pin definitions; installation requirements grant exact protected callable capabilities.

## defineProject and environments

```ts
// astrale.config.ts
import { astrale } from '@astrale-os/adapter-astrale'
import { defineProject } from '@astrale-os/sdk/project'
import { application } from './application.js'

export default defineProject({
  application,
  environments: {
    development: {
      deployment: astrale({
        signingIdentity: '.astrale/identity.json',
        secrets: '.env.dev',
      }),
      installation: { instance: 'development' },
    },
    production: {
      deployment: astrale({
        signingIdentity: '.astrale/identity.json',
        secrets: '.env.prod',
      }),
      installation: { instance: 'production' },
    },
  },
})
```

- An Environment selects provider deployment plus optional Kernel installation. With Astrale, Services
  uses `installation.instance` by default; this is not the CLI's active-instance fallback.
- For deploy-only, omit `installation` and set `astrale({ instance: 'services-host', ... })`.
  `--deploy-only` skips installation for one command without changing the configured deployment target.
- Application already contains Runtime and frontend. `entrypoints.runtime` only overrides the
  conventional loadable Runtime file; do not repeat those definitions in Project or adapter options.
- Keep the Domain signing identity stable and gitignored; it is distinct from the human CLI identity.
  Keep secret files beside their owning config, or use explicit paths; never copy secrets into source.
- Run commands from the owning project directory. Relative secret paths resolve there, not at a
  parent monorepo root; environment names alone do not isolate deliberately shared provider resources.

## Managed development loop

```sh
astrale auth login
astrale instance list --json
pnpm dev                         # Generated script defaults to development.
pnpm dev development --as developer
pnpm run deploy production
```

- Prefer the Astrale adapter for managed deployment: it uses the CLI session and Services, with no
  Cloudflare account needed. Select another adapter only when the user needs that provider directly.
- Current `dev` builds locally, deploys remotely, verifies Publication, reconciles installation, and
  opens an applicable View. It watches source; configuration changes need a restart.
- The SDK CLI requires an explicit Environment for `dev`/`deploy`; the generated script supplies its
  default. Use a disposable development instance for iteration, not production by convenience.
- Stopping ends local orchestration/View, not remote deployment or installation. Build failure does
  not replace the candidate; a provider-side failure is not proof of automatic remote rollback.
- Session locks prevent competing local updates to the same project/environment or installation target.
  Domain development needs no local Kernel or hand-managed tunnel; do not add one without a real need.

## Verification and handoff

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
astrale get /:issues.example -i development --as operator --schema --json
astrale introspect /:issues.example -i development --as operator
```

- Typecheck/lint/build prove source boundaries, not installed behavior. Observe exact Publication,
  installed Schema revision, and representative calls before claiming deployment/integration success.
- Build, deployment, and installation are separate stages. `astrale domain install <url> --direct -i ...`
  installs an already-deployed Domain; do not reinstall merely because a serving URL's implementation changed.
- Retain exact SDK/adapter/CLI versions and relevant source/deployment revisions, not only manifest
  ranges. Keep durable regression tests with code and ephemeral qualification output outside delivery.
- Run checks on the tree actually built and deployed. Do not hide files, weaken typechecking, or forge
  SDK types to satisfy the linter; minimize a genuine SDK gap and report the exact diagnostic.
- When publishing a package, check emitted declarations and an isolated packed consumer. Avoid leaked
  Kernel imports, private aliases, or workspace overrides; use `pnpm --ignore-workspace` outside the repo.
- Test operator scripts through their documented package command. A direct module run does not prove
  argument forwarding; handle a package-manager separator only when the chosen toolchain supplies one.
- Build does not load all runtime secrets, and help does not start the project. Neither proves
  initialization or credentials work; observe readiness and one actual invocation separately.
