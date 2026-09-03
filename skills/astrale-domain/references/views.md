# Views

A View has two owners:

- Schema declares the semantic View name.
- Application frontend composition maps that name to browser source, route, document, and Shell
  handshake.

Views do not have callable authentication metadata. Access follows installed Publication routing,
Shell handshake, the Client session, and Kernel authorization for the graph/callables the View uses.

## Frontend composition

```ts
import { defineFrontend, vite } from '@astrale-os/sdk/view'
import { schema } from '#schema'

export const frontend = defineFrontend({
  schema,
  source: vite(),
  routes: {
    application: { path: '/application', handshake: 'shell' },
  },
  entrypoint: 'application',
})
```

Use `handshake: 'shell'` when the browser surface needs the host-provided SDK Client/session context.
Use `none` only for a genuinely standalone public document. Do not depend directly on Shell or
Shell-React packages when the SDK facade owns the needed client/view contract.

## UI ownership

Apply `astrale-frontend-design` for information architecture, visual hierarchy, interaction states,
and interface copy. This reference owns the View's SDK integration and runtime boundaries.

Separate:

```text
ui/<feature>/        pure presentation and local interaction
views/<feature>/     SDK client reads/calls and screen composition
frontend/            router, browser entry, styles, assets
```

Project graph nodes into explicit UI models before rendering. Keep raw canonical values and client
sessions out of leaf presentation components.

## Read and action boundaries

A Class read or traversal Policy narrows an existing principal capability; it does not grant that
capability. Direct graph hooks therefore require the caller to hold the exact Class `read` or
`traverse` authority in addition to satisfying its Policy. Do not grant broad graph authority merely
to make a dynamic member View render. Expose a caller-scoped Action or Workflow that returns the
smallest UI projection when ordinary members should observe records through Domain authority.

An instance Action only needs the receiver's admitted identity. When a read Action returns a node ID
instead of a readable bound node, validate it as a `NodeId` and pass `{ id }` to `useAction.run`.
The Kernel resolves the receiver Class and applies callable authentication and Policy. Do not forge a
`BoundNode`, and do not add a direct Class-read grant just to construct an Action receiver.

## State handling

Every real View should make these states intentional when applicable:

- loading;
- empty or missing relationship;
- wrong target;
- unauthenticated/unauthorized;
- expected error;
- ready;
- mutation in progress and failed.

After a successful Action/Workflow call, refresh the affected query. Optimistic UI may bridge the
round trip, but it cannot substitute for observing committed Kernel state.

## Live verification

Use the public CLI or Client session against the installed Domain:

```sh
astrale view /:contacts.example.dev:view.application \
  --target @node-id --snapshot --json -i staging
```

Verify actual graph content, navigation, keyboard semantics, responsive layout, browser console, and
denied states. A static string or mock-only screen is not mounted-View evidence.
