# Views

The Schema names a View; the Domain's `defineFrontend` owns its URL, document and handshake; the
React host owns the session.

## Domain Views and internal routing

- A View belongs to its Domain. The Shell opens it by path (`/:<origin>:view.<name>`) or as the
  Domain entrypoint, never for a Class or a node. `view({ description? })` names no Class.
- A screen about one node is an internal route of the Domain frontend (`/issues/$issue`): read the
  node from the router (`useParams`, `useSearch`) and pass it to the Query. The Shell hands a View no
  node and cannot tell which View renders a node.
- Same Domain: link with the router. Another Domain:
  `openView({ view: '/:<origin>:view.<name>' })` (or its entrypoint); it routes internally; never
  pass it a node.
- The handshake's `targetNodeId` is deprecated and always the Domain path: never branch on it.

## Declare the surface

```ts
// schema/schema.ts
export const schema = defineSchema('work.example', {
  name: 'Work',
  entrypoint: 'application',
  views: { application: view({}) },
})

// domain.ts
import { defineFrontend, vite } from '@astrale-os/sdk/view'
import { schema } from '#schema'

export const frontend = defineFrontend({
  schema,
  source: vite(),
  routes: { application: { path: '/application', handshake: 'shell' } },
})
```

- Every Schema declares `name` and at most one `entrypoint` View, projected into the graph (Domain
  Node `name`, an `entrypoint` Edge). The Shell lists Domains with an entrypoint only.
  `defineFrontend` takes no `entrypoint`.
- A View Node carries its placement (URL, handshake). Reading a View Node or an `entrypoint` Edge
  needs the Kernel Role `view.reader` (in `reader`): the Shell opens and lists only the Views its
  caller reads.
- `handshake: 'shell'`: host-provided session and client. `none`: standalone public documents. A
  View has no callable auth mode; its reads and calls keep their own authorization.
- `frontend/`: browser entry, router, styles. `views/`: SDK hooks, screen orchestration. `ui/`:
  presentation; leaf UI receives values and callbacks, never credentials or a Kernel client.
- The SDK's Cloudflare adapter manages caching of the frontends it serves; standalone Workers do
  not inherit it. Long-lived caching only for files the build marks content-addressed (never a
  filename regex); never for HTML, API/auth or cookie-bearing responses; keep `private`/`no-store`.

## React Shell and authentication

- `@astrale-os/shell-react` owns React session and hooks; the SDK's `view` facade owns build
  declarations only. Declare the packages the frontend imports.
- `<Astrale>`: sandboxed child handshake, loading/error boundaries. `<DomainProvider schema>` wraps
  projected Query/Mutation hooks; keep the application's router.
- `useSelf()`: the caller's identity, synchronous, no read. `useUser()`: reads the User node and may
  suspend; only for profile properties.
- `useDomain(schema)`: binds synchronously, asks the Kernel nothing, one binding per origin and
  revision per client. Pass its callables to `useAction`; never rebuild method keys, forge bound
  nodes or resolve a client per component.
- A frontend compiled against another Schema revision than the installed one fails at its first
  request the Kernel refuses; fix the deployment coherence, not the binding.
- `useAction(callable, { refresh })`: `refresh` defaults to `'all'`; `'none'` skips invalidation.

```tsx
// frontend/src/main.tsx
import { Astrale, DomainProvider } from '@astrale-os/shell-react'
import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { schema } from '#schema'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <Astrale>
    <DomainProvider schema={schema}>
      <RouterProvider router={router} />
    </DomainProvider>
  </Astrale>,
)

// views/issue/use-close-issue.ts: Issue.close is a schema-declared instance callable
import { useAction, useDomain } from '@astrale-os/shell-react'
import type { NodeId } from '@astrale-os/sdk/graph/node'

export function useCloseIssue() {
  const binding = useDomain(schema)
  const action = useAction(binding.domain.classes.Issue.methods.close, { refresh: 'all' })
  return {
    close: (id: NodeId) => action.run({ id }, {}),
    pending: action.pending,
    error: action.error,
  }
}
```

- The host authenticates and supplies the child session through the handshake. No root keys,
  long-lived tokens, second login or anonymous fallback in a View.
- The raw Service URL is not an authenticated mounted View: test through the CLI/Studio host.
  Registration and business membership on the instance are separate from local identity storage.
- A frontend Policy probe or disabled button is presentation; Kernel admission decides.

## Read, mutate, and refresh

| Contract | Use |
| --- | --- |
| Graph records, filtered per candidate by Class `read`/`traverse` Policies | Direct Query with the supplied session (caller holds `graph.reader`); Policy judges the caller |
| A Class read for the user through the Domain's own scope | Direct Query with the Domain as executor: both hold `graph.reader`; the Domain owns the Class, holds its `read`/`traverse` scopes, or itself passes the rule; the rule still judges the user |
| Calculated, aggregated, redacted or graph-independent stable result | Function with explicit callable admission (Action or Workflow) |

The host owns session selection, exchange and refresh (`authority.md`, `policies.md`,
`debugging.md`).

- Instance `useAction.run` takes `{ id: NodeId }`: no second Class read, no fabricated `BoundNode`.
- Optimistic UI proves no persistence and must recover on refusal.
- Distinguish loading, empty, missing routed record, auth failure, expected error, pending
  mutation; keep editable input on failure; show actionable refusal details, not transport
  internals.
- No IDs, digests, SHAs or Paths in product labels or fallback text.

## Use Astrale UI

`astrale-frontend-design` for layout and interaction. `@astrale-os/ui` controls and patterns first;
custom UI only for product-specific presentation.

```sh
# in the frontend project; inspect existing setup first
astrale ui search "searchable table with row actions" --json
astrale ui init --preset astrale
astrale ui add pattern/chart/line-basic
astrale ui doctor
```

- Search results carry exact demo code and a `packageImport` or add command: read them and the
  installed exports before inventing a wrapper, API or CSS convention.
- Primitives stay package imports; added patterns/themes are consumer-owned source. Preserve the UI
  lock and local edits; never reinitialize a configured frontend.

## Inspect and exercise the real View

```sh
astrale instance list --bookmarked --json
astrale identity list --json
astrale get @self -i staging --as alice --json
astrale introspect /:issues.example:class.Issue:close -i staging --as alice
astrale view /:issues.example:view.application -i staging --as alice
astrale view issues.example --list -i staging --as alice
astrale logs -i staging --as alice --topic-prefix function. --limit 20
astrale view --sessions
astrale view --close <session-id>
```

- Explicit instance and identity; repeat with a second registered Identity for access contrasts.
  Root success is not Policy proof.
- Check real records, navigation, keyboard, narrow layout, console errors and one refusal. Local
  mocks are not installed-View evidence; never keep credentials in proof files.
