# Views

Schema names the View; Application frontend composition owns its URL, document, and handshake.
The React host owns the session, not the business Domain's runtime.

## Declare the surface

```ts
import { defineFrontend, vite } from '@astrale-os/sdk/view'
import { schema } from '#schema'

export const frontend = defineFrontend({
  schema,
  source: vite(),
  routes: { application: { path: '/application', handshake: 'shell' } },
  entrypoint: 'application',
})
```

- Use `handshake: 'shell'` for host-provided session/client access; `none` is for standalone public documents.
  A View declaration has no callable auth mode: its graph reads and calls retain their own authorization.
- Keep `frontend/` for browser entry/router/styles, `views/` for SDK hooks and screen orchestration,
  and `ui/` for presentation. Leaf UI receives values/callbacks, not credentials or a Kernel client.

## React Shell and authentication

- Use the public `@astrale-os/shell-react` package for React session/hooks; the SDK's `view` facade owns
  frontend build declarations, not React providers. Declare the packages actually imported by the frontend.
- `<Astrale>` defaults to the sandboxed child handshake and supplies loading/error boundaries.
  Wrap projected Query/Mutation hooks in `<DomainProvider schema={schema}>`; keep the application's router.
- `useDomain(schema)` returns a verified installed binding and may suspend. Pass its resolved callable
  to `useAction`; do not reconstruct method keys, forge bound nodes, or resolve another client per component.
- A local frontend compiled against a newer Schema can fail binding against an older installation.
  Compare both revisions and update the coherent deployment; reloading or casting the binding cannot fix it.

```tsx
// frontend/src/main.tsx — router and schema are the application's existing owners.
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

// views/issue/use-close-issue.ts — Issue.close is the schema-declared instance callable.
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

- The host authenticates the selected identity and supplies the child session through the handshake.
  Do not put root keys, long-lived tokens, a second login, or an anonymous fallback in the View.
- Opening the raw Service URL is not an authenticated mounted-View test. Use the CLI/Studio host;
  registration and business membership on that instance are separate from local identity storage.
- A frontend Policy probe or disabled button is presentation, never authorization. Kernel callable
  admission remains authoritative, including after a role changes or the UI becomes stale.

## Read, mutate, and refresh

- `useQuery`/`useMutation` operate with the browser caller's authority, unlike runtime Domain executors.
  Class `read`/`traverse` Policy narrows existing capability; it does not grant that capability.
- Use a caller-scoped Function returning a minimal projection when members should read through Domain
  authority. Do not grant broad graph rights merely to make a direct query render.
- Instance `useAction.run` accepts `{ id: NodeId }`; a returned ID does not require a second Class read
  or a fabricated `BoundNode`. Validate only genuinely untrusted raw values entering that boundary.
- After a successful call, refresh affected observations. Start with supported invalidation options,
  then narrow costly refreshes; optimistic UI does not prove persistence and must recover on refusal.
- Distinguish loading, empty, missing target, auth failure, expected error, and pending mutation.
  Preserve editable input on failure; show safe actionable refusal details, not transport internals.

## Use Astrale UI

Apply `astrale-frontend-design` for layout and interaction. Prefer `@astrale-os/ui` controls and supplied
patterns; write custom UI only for product-specific presentation or a missing capability.

```sh
# Run in the frontend project; inspect existing setup before initializing.
astrale ui search "searchable table with row actions" --json
astrale ui init --preset astrale
astrale ui add pattern/chart/line-basic
astrale ui doctor
```

- Search results include exact demo code and a `packageImport` or add command. Read those references and
  installed exports before inventing a wrapper, component API, or CSS convention.
- Library primitives stay package imports; added patterns/themes are consumer-owned source. Preserve
  the UI lock and local edits; do not reinitialize a configured frontend or overwrite it blindly.

## Inspect and exercise the real View

```sh
astrale instance list --bookmarked --json
astrale identity list --json
astrale get @self -i staging --as alice --json
astrale introspect /:issues.example:class.Issue:close -i staging --as alice
astrale view /:issues.example:view.application -i staging --as alice
astrale view @issue-id --list -i staging --as alice
astrale logs -i staging --as alice --topic-prefix op:function. --limit 20
astrale view --sessions
astrale view --close <session-id>
```

- Use explicit instance and identity; repeat with a second registered principal for access contrasts.
  Root success is not Policy proof. Verify CLI flags with `--help` for the installed release.
- Check actual records, navigation, keyboard use, narrow layout, console errors, and a refusal.
  Distinguish local mock checks from installed-View evidence; never retain credentials in proof files.
