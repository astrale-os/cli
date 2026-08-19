<!-- Kernel-v2 reference. -->

# Security

Read when declaring authentication or authorization for a Kernel-v2 callable, inspecting a Policy
decision from a client, or handling an external trust boundary.

## Put callable authorization in Schema

The callable declares one authentication mode: `required`, `optional`, or `public`. A
caller-sensitive rule belongs to a Schema-owned Policy and the callable's `policy` expression. The
Kernel evaluates that Policy before dispatching the handler; handler success is never authorization
evidence.

`@astrale-os/sdk/auth` exposes v2 identity and client authorization types. It intentionally does not
provide the legacy `READ`, `EDIT`, `USE`, `SHARE`, permission-mask, grant, revoke, or
`assertPerm` APIs.

```ts
import { definePolicy, fn } from '@astrale-os/sdk/schema'

export const mayRenameProject = definePolicy({
  description: 'The caller manages this Project.',
  match: ({ edge, object, subject }) =>
    edge({ source: subject, class: manages_project, target: object }),
})

export const renameProject = fn({
  auth: 'required',
  input: renameProjectInput,
  output: renameProjectOutput,
  policy: ({ check, self }) => check(mayRenameProject, self),
})
```

Keep Policy declarations in Schema and keep Function implementations free of private authorization
rules. If an authorization fact must change, model that fact with the Domain's Nodes, Edges, and
Mutations instead of rebuilding a generic permission-bit subsystem.

## Use authentication modes deliberately

- `required` admits only an authenticated caller.
- `optional` admits either an authenticated or anonymous caller; the handler must branch on its
  typed caller context.
- `public` admits an anonymous caller and supplies no caller-bound Kernel, Query, or Mutation
  executor. Authenticate any external provider at its Integration boundary before taking effects.

Do not add a handler-local `authorize` hook to emulate the old dispatcher. The v2 Runtime owns
callable admission from the compiled Schema contract.

## Observe a Policy decision from a client

`kernel.auth.can()` answers whether the current authenticated identity satisfies one installed Policy
for one object. It returns a boolean observation; it does not grant authority, replace callable
admission, or authorize a later write.

```ts
import { Path } from '@astrale-os/sdk/graph/path'

const allowed = await kernel.auth.can({
  policy: Path.parse('/:projects.example:policy.mayRenameProject'),
  object: projectId,
})
```

Use this for presentation or an explicit decision probe. Still let the protected callable's Policy be
the authoritative gate, because graph state can change after the observation.

## Keep trust-boundary admission separate

Credential verification establishes the caller. Policy evaluation establishes whether that caller may
invoke the protected callable on the selected object. External payload admission establishes whether a
provider value is safe to translate into Domain facts. Preserve all three boundaries; none substitutes
for another.
