# Development

Use the generated project as the executable starting point. Inspect its installed SDK version and
public exports before writing API syntax; treat them as authoritative.

## Create

Start from the public scaffold and keep it load-bearing:

```sh
npx create-astrale-domain@beta contacts \
  --yes --adapter astrale --frontend react --instance development \
  --origin contacts.example.dev --dir contacts --no-link
```

For release qualification, pin an exact published version or an immutable packed tarball. A normal
Domain package declares `@astrale-os/sdk` plus its public deployment adapter. It does not declare
Kernel implementation packages, Shell packages, a source checkout, or a workspace link.

When authored source imports Zod for properties or callable contracts, declare `zod` directly in the
Domain manifest. Strict pnpm consumers do not expose the SDK's transitive Zod installation to Domain
source. Do not solve the missing import with a workspace link, hoisting flag, or private SDK path.

## Authoring roots

Keep these composition files narrow:

```text
schema/             authored language declarations and Policies
functions/          Action and Workflow callable implementations
integrations/       consumer-owned external contracts
providers/          environment-backed implementations
queries/            reusable graph observations
mutations/          atomic graph changes
rules/              pure business decisions
views/ and ui/       frontend routing and presentation
runtime.ts          integrations, initialize, Functions
application.ts      Schema, Runtime, frontend, routes, requirements
astrale.config.ts   deployment adapter and environments
```

Use one small owner file per meaningful callable, query, mutation, integration, provider, or view.
Cross-owner imports go through the generated `#` facades.

Application requirements are inert root composition, not another Domain layer. Do not create a
top-level `requirements/` source tree: the Domain linter correctly rejects undeclared layers. Resolve
an exact dependency inline in `requirements(...)` or export a resolved dependency witness beside the
authored Schema, then keep `application.ts` limited to composition.

## Runtime and Application

Every Runtime-side module imports authored Schema handles only as types. A value import from a
Runtime, Action, Workflow, Integration, Provider, Query, or Mutation can retain the build-only Schema
DSL in the Worker closure; the SDK build boundary rejects that leak. Application/publication
composition remains the value owner. Runtime realizes external Providers once and registers exact
Action and Workflow definitions in one ordered Functions collection:

```ts
import { defineRuntime } from '@astrale-os/sdk/runtime'
import type { schema } from '#schema'

export default defineRuntime<typeof schema>()({
  integrations,
  initialize(environment: Environment) {
    return {
      providers: {
        openMeteo: createOpenMeteoProvider(environment),
      },
    }
  },
  functions,
})
```

Application is build/publication composition:

```ts
import { defineApplication } from '@astrale-os/sdk/application'
import { schema } from '#schema'
import runtime from './runtime.js'

export const application = defineApplication({ schema, runtime, frontend })
```

Do not put Provider I/O, handler behavior, deployment effects, or authorization decisions in either
composition root.

Use ordinary imports for pure helpers and Rules, bound Query/Mutation executors for graph access, and
Integrations and Providers for environment-backed behavior.

## Development session

Both adapters use the same remote-first Project development journey:

```sh
pnpm dev
pnpm dev staging
pnpm dev --environment staging --as developer
```

The generated script supplies `development` only when no arguments are given. The SDK CLI itself
requires an explicit Environment for `dev` and `deploy`. Select targets in `defineProject`:

```ts
export default defineProject({
  application,
  environments: {
    development: {
      deployment: astrale({ signingIdentity: '.astrale/identity.json' }),
      installation: { instance: 'development' },
    },
  },
})
```

Development builds and deploys remotely, verifies the Publication, reconciles the optional
installation, opens an applicable default View, and serializes subsequent source changes. The
Application already contains the Runtime; `entrypoints.runtime` only overrides its conventional
loadable module path. Do not repeat Runtime in Project configuration.

The Astrale adapter deploys through Services on `installation.instance` by default. For deploy-only
operation, omit `installation` and set the adapter's `instance` explicitly. The Cloudflare adapter
uses the author's Cloudflare account and needs no Kernel when installation is omitted. A command-scoped
`--deploy-only` suppresses installation without changing the Environment's configured deployment target.
No active-instance fallback selects a Project target.

Stopping closes local orchestration and its View session, leaving deployment and installation alive.
Build errors do not replace the deployed candidate; a provider-side failure after publication can
still affect the remote Service. Do not equate retained local evidence with automatic provider rollback.
Configuration changes require an explicit restart.

Each project root and Environment has its own session lock. An installation-target lock additionally
excludes another local checkout targeting the same configured instance and Domain origin. Distinct
Environments may run together when their provider and installation targets are distinct; naming two
Environments differently is not sufficient to isolate deliberately identical provider resources.

Domain development needs no local Worker or ingress. Kernel developers separately run the Kernel
Host's named-profile lifecycle with stable managed ingress when remote Services must call their Kernel.

## Qualify before deployment

Run the generated commands in this order so failures retain their owner:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Retain the package manifest and lockfile, resolved SDK/adapter/scaffolder versions, environment-owned
CLI version, Node and package-manager versions, and the exact owner command behind each conclusion.
A version range or remembered release is not evidence of what executed.

When an agent runner receives Astrale skills from the CLI distribution, retain
`astrale update --check --json` evidence for the resolved source revision, each skill tree, and each
entrypoint. Record the builder's exact admitted skill projection and opener trace separately. This
proves distribution and opening; it does not prove the builder followed the guidance or that a later
latency change was caused by it.

Keep an acceptance prompt about the business outcome. Put reusable product guidance in one versioned
knowledge input and retain its digest; do not rely on an ambient installed skill whose source and
version the runner cannot identify. Keep scenario-specific facts in the scenario and stable product
facts in the owning skill or documentation.

The SDK Domain linter is the architecture and semantic policy gate. Strict typecheck should keep
`skipLibCheck` disabled.

Qualification must inspect the production tree that build and deployment consume. Do not copy or
hide source into a different topology before lint, typecheck, test, build, or pack. If a legitimate
package shape is unsupported, retain the exact diagnostic and classify an SDK capability gap instead
of manufacturing a pass.

Treat emitted declarations and the packed consumer as public package evidence. A source tree can use
only SDK facades yet still emit a Kernel specifier; minimize that as a facade defect rather than
hiding it with a cast or shadow type. Distinguish runtime/peer dependencies from author-only
devDependencies when qualifying the packed artifact.

When replacing a generated single-Schema root with several public Schema subpaths, keep only package
`imports` whose source and published targets are actually emitted. Do not retain broad scaffold
aliases by habit or invent another packaging API: the ordinary package exports plus
`astrale-domain package` are the compatibility surface. Exercise the tarball from a consumer outside
the source workspace. With pnpm, pass `--ignore-workspace` so parent workspace discovery cannot turn
that consumer into a source-topology test.

## Build, deploy, install

These are different lifecycle stages:

```text
Application -> Build -> Release -> adapter deployment -> Kernel installation
```

- `pnpm build` proves provider-neutral compilation and adapter preparation.
- `pnpm dev [environment]` watches and redeploys one Environment, reconciling its optional installation.
- `pnpm run deploy production` performs one configured deployment and optional installation.
- `astrale domain publish --origin <origin> --name <name> --public-url <url>` registers that
  observed deployment in the Admin catalog when product distribution requires it.
- `astrale domain install <url> --direct -i <instance>` installs the deployed Release on one Kernel.

Never infer installation from deployment. Fetch or inspect Publication/Bundle evidence and observe the
installed revision through public Client or CLI behavior.

Author-side tests and handoff files can report compilation, tests, and packing. They cannot certify
isolated installation, live execution, external effects, graph state, or cleanup; the acceptance owner
must observe those boundaries independently.

### Multi-owner local services

SDK tooling treats the directory where the Domain command runs as the project root: it discovers
`astrale.config.ts` there and resolves a relative preset `secrets` path from that same directory. If
one package launches owner-local Domains with `pnpm --dir messaging ...` and
`pnpm --dir logistics ...`, then `secrets: '.env.dev'` means `messaging/.env.dev` and
`logistics/.env.dev`, not the package-root `.env.dev`. Keep each gitignored file beside its owning
config, or declare an explicit relative path to the actual owner-approved file. Never copy or print
secret values to make paths agree.

`build` returns before declared secrets are loaded, and `--help` returns before project discovery.
They therefore do not prove that a service can start. Before an expensive integrated run, let the
acceptance owner start each owner-local service through its exact public script and observe readiness;
keep that bounded smoke separate from Domain installation and invocation.

### Package-script argument forwarding

Test operator entrypoints through the exact documented package script. With pnpm 12,
`pnpm run cleanup:graph -- --instance ...` can expose one literal leading `--` in
`process.argv.slice(2)`. An authored argument parser should normalize at most that one package-manager
separator before parsing named flags, while still rejecting duplicate separators, missing values,
unknown flags, and unrelated errors. A direct `node cleanup.mjs --instance ...` test or module-load
check does not prove the public command contract Lab will execute.

## Live evidence

Use a fresh identity/session for protected calls. Prove authentication denial, callable-authority
denial, and Policy denial as separate Kernel decisions. For a successful journey, exercise a
top-level Action, receiver-bound Action, Workflow, Integration/Provider output, graph read, and View.
Do not claim Workflow durability or exactly-once behavior unless a durable runner actually supplies it.
