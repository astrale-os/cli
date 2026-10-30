# Development

The SDK (`astrale-domain`) builds, deploys and publishes; the `astrale` CLI owns instances,
installs, identities and live calls. Start from the scaffold and the installed SDK's public exports,
not remembered syntax. Sessions, tokens and endpoints come from the adapter and SDK session; never
build a parallel pipeline (issuer and redirect internals: `debugging.md`).

## Scaffold and dependencies

```sh
npx create-astrale-domain@beta issues \
  --yes --adapter astrale --frontend react \
  --origin issues.example --dir issues --no-link
```

- Keep an existing scaffold's plumbing. Reproducible checks: an exact scaffolder/SDK/adapter cohort
  and the lockfile.
- Import only `@astrale-os/sdk/*` facades, never Kernel packages or private SDK paths. Depend on the
  chosen adapter only, not its transitive implementation adapter.
- Declare what source imports: the SDK-compatible exact `zod` (a second, structurally equal copy
  can fail compilation), and frontend UI / React Shell packages when used.
- One `tsconfig.json` for Worker code, Views and tests: `lib` includes the DOM, `types` is
  `["node", "vitest/globals"]`, `skipLibCheck: false`. Never narrow `types` to `[]` nor split the
  project per runtime (Workers run with `nodejs_compat`; the SDK and Kernel already type-check their
  Worker-facing surface).

## Composition and owners

```text
schema/             business modules: classes, policies, functions, errors, types, states, core, views
functions/          Actions and Workflows
queries/            graph observations and their projections
mutations/          atomic graph changes
rules/              pure business decisions
integrations/       consumer-owned external contracts
providers/          environment-backed implementations
routes/             optional native HTTP-to-callable declarations
views/ and ui/      client orchestration and presentation
runtime.ts          integrations, initialize, functions
domain.ts           schema, runtime, frontend, optional routes, requirements
astrale.config.ts   defineProject: domain, environments, optional tests
```

- Only the layers that apply; curated `#` facades; one callable/Query/Mutation per file. No empty
  layers, no universal repository.
- Runtime imports the aggregate Schema as a type; runtime-safe errors, values and StateMachines may
  be value imports; aggregate DSL declarations stay build-side.

```ts
// runtime.ts
import { defineRuntime } from '@astrale-os/sdk/runtime'
import type { schema } from '#schema'

export default defineRuntime<typeof schema>()({
  integrations,
  initialize(environment: Environment) {
    return { providers: { weather: createWeatherProvider(environment) } }
  },
  functions,
})

// domain.ts: schema as a value; runtime and frontend from their owners
import { defineDomain, requirements } from '@astrale-os/sdk/domain'
import { K } from '@astrale-os/sdk/schema'

export const domain = defineDomain({
  schema, runtime, frontend,
  requirements: requirements({
    roles: [
      { role: K.core.nodes['graph.reader'], members: ['domain'] },
      { role: K.core.nodes['graph.writer'], members: ['domain'] },
    ],
  }),
})
```

- Providers initialize once from the admitted environment. No Provider I/O at module scope; no
  handlers, authorization or deployment effects in composition roots.
- `requirements` is part of the Domain definition, not a `requirements/` layer: the Kernel Roles the
  Domain holds and the scopes bounding what it does for callers (`policies.md`, `authority.md`).

## defineProject and environments

```ts
// astrale.config.ts
import { astrale } from '@astrale-os/adapter-astrale'
import { defineProject } from '@astrale-os/sdk/project'
import { domain } from './domain.js'

export default defineProject({
  domain,
  environments: {
    development: { deployment: astrale({ secrets: '.env.dev' }) },
    production: { deployment: astrale({ secrets: '.env.prod' }) },
  },
})
```

- An Environment = how to deploy + which secrets; it names no instance. A deploy never installs;
  `astrale domain install -i <instance>` chooses (`deployment.md`). `astrale()` refuses `instance`,
  `signingIdentity`, `organization`; an Environment declaring `installation` is refused.
- Every Environment deploys as the authenticated `astrale` CLI identity (`--as`); line ownership:
  `deployment.md`, Who owns a development instance.
- `entrypoints.runtime` only overrides the conventional Runtime file; never repeat Runtime or
  frontend in Project or adapter options.
- Each deployment gets a signing key generated at deploy: no key file; distinct from the CLI
  identity. Secrets files stay beside their config (or explicit paths), never in source.
- Run commands from the owning project directory: relative secret paths resolve there, not at a
  monorepo root.
- A shared Schema dependency change: deploy every affected Domain, then one grouped install
  (`migration.md`).

## Development loop

```sh
astrale auth login
astrale instance list --json
pnpm run deploy development                                   # prints the URL; installs nothing
astrale domain install <url> --allow-issuer-change -i <dev-instance>
```

- Adapter `astrale` (default): deploys on the Admin instance's Services through the CLI session
  (`astrale call --admin`); no Cloudflare account. Another adapter only when the user needs that
  provider directly.
- No watch loop. Each changed build is a new preview at its own URL; installing it over the previous
  one is a same-line issuer change (`--allow-issuer-change`, or typing the origin at a terminal).
- `deploy` requires an explicit Environment. Iterate on a development instance you own
  (`deployment.md`), never on production.
- A failed build or deploy changes no instance. No local Kernel or tunnel needed.

## Verification and handoff

```sh
pnpm install && pnpm typecheck && pnpm test && pnpm lint && pnpm build
astrale get /:issues.example -i development --as operator --schema --json
astrale introspect /:issues.example -i development --as operator
```

- Typecheck/lint/build prove source boundaries, not installed behavior. Claim deployment success
  only after observing the served release (`/.well-known/astrale/release.json`), the installed Schema
  revision, and representative calls.
- Build and `--help` neither load runtime secrets nor initialize the project: observe readiness and
  one real invocation.
- Retain exact SDK/adapter/CLI versions and source/deployment revisions, not manifest ranges.
- Never hide files, weaken typechecking or forge SDK types to satisfy the linter; minimize a genuine
  SDK gap and report the exact diagnostic.
- Publishing a package: check emitted declarations and an isolated packed consumer (no leaked Kernel
  imports, private aliases or workspace overrides; `pnpm --ignore-workspace` outside the repo). Test
  operator scripts through their package command (argument forwarding).
