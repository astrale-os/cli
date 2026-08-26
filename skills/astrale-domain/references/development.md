# Development

Use the generated project as the executable starting point. Inspect its installed SDK version and
public exports before writing API syntax; treat them as authoritative.

## Create

Start from the public scaffold and keep it load-bearing:

```sh
npx create-astrale-domain@beta contacts \
  --yes --adapter cloudflare --frontend react \
  --origin contacts.example.dev --dir contacts --no-link
```

For release qualification, pin an exact published version or an immutable packed tarball. A normal
Domain package declares `@astrale-os/sdk` plus its public deployment adapter. It does not declare
Kernel implementation packages, Shell packages, a source checkout, or a workspace link.

## Authoring roots

Keep these composition files narrow:

```text
schema/             authored language declarations and Policies
actions/            one-step callable implementations
workflows/          explicit multi-step callable implementations
integrations/       consumer-owned external contracts
providers/          environment-backed implementations
queries/            reusable graph observations
mutations/          atomic graph changes
rules/              pure business decisions
views/ and ui/       frontend routing and presentation
runtime.ts          integrations, initialize, Actions, Workflows
application.ts      Schema, Runtime, frontend, routes, requirements
astrale.config.ts   deployment adapter and environments
```

Use one small owner file per meaningful callable, query, mutation, integration, provider, or view.
Cross-owner imports go through the generated `#` facades.

## Runtime and Application

Runtime code imports the authored Schema only as a type. It realizes external Providers once and
registers exact Action and Workflow definitions:

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
  actions,
  workflows,
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

## Build, deploy, install

These are different lifecycle stages:

```text
Application -> Build -> Release -> adapter deployment -> Kernel installation
```

- `pnpm build` proves provider-neutral compilation and adapter preparation.
- `pnpm prod` performs the configured provider deployment and returns observed deployment evidence.
- `astrale domain publish --origin <origin> --name <name> --public-url <url>` registers that
  observed deployment in the Admin catalog when product distribution requires it.
- `astrale domain install <url> --direct -i <instance>` installs the deployed Release on one Kernel.

Never infer installation from deployment. Fetch or inspect Publication/Bundle evidence and observe the
installed revision through public Client or CLI behavior.

Author-side tests and handoff files can report compilation, tests, and packing. They cannot certify
isolated installation, live execution, external effects, graph state, or cleanup; the acceptance owner
must observe those boundaries independently.

## Live evidence

Use a fresh identity/session for protected calls. Prove authentication denial, callable-authority
denial, and Policy denial as separate Kernel decisions. For a successful journey, exercise a
top-level Action, receiver-bound Action, Workflow, Integration/Provider output, graph read, and View.
Do not claim Workflow durability or exactly-once behavior unless a durable runner actually supplies it.
