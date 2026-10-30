# Actions

Read to implement a callable's handler, to choose between an Action, a Workflow and no callable,
or to call another callable from a handler. The Schema owns each callable's input, output,
receiver, `auth` mode and Policy; the handler implements what that contract admits.

## When to write an Action

An Action reads what it needs, then makes at most one effect, last (`FNC-ONE-EFFECT`). An effect is
a Mutation, or a state-changing Integration, dependency or Kernel call; a Query or a call that
changes nothing is an observation.

| The callable | Write |
| --- | --- |
| Reads, then makes one effect, or none | An Action |
| Makes two or more effects that cannot commit together, or waits | A durable Workflow (`workflows.md`) |
| Only reads what its caller may read | No callable: define the Query (Read-only Actions) |

- Prefer an Action. It answers in one request; a durable Workflow pays a request per Step and makes
  its caller follow an Execution. Several writes that can commit together are one Mutation, so one
  Action.
- The single effect goes last: everything before it only reads, so a refused read leaves nothing
  behind.
- Reads never make a Workflow. When a user waits on screen, the callable is an Action unless it
  truly coordinates effects.

## Read-only Actions

Avoid them. A client reads the graph under its own authority: a View with its Query hooks
(`views.md`), the CLI with `astrale query`, a Client with `runQuery`, another Domain with its
own Query. Define the Query and let them read it: the Kernel already decides each reader's rows
by its Class rules. A read-only callable adds a request, a Policy and a contract for nothing.

A read-only Action is right when the caller must learn something it may not read itself: whether a
slot is taken, a count or a status over records it may not see, a public summary. The Action reads
`{ as: 'executor' }` and returns only what the caller may learn, never the rows:

```ts
// queries/project/project-health.ts — counts, never rows
type Health = { readonly project: NodeId; readonly today: string }

export const projectHealth = defineQuery<typeof schema>()('issues.project.health', {
  build: (input: Health, d) => ({
    open: d.Issue.where((i) => [i.project.is(input.project), i.status.eq('open')]).count({
      upTo: 1_000,
    }),
    overdue: d.Issue.where((i) => [
      i.project.is(input.project),
      i.status.eq('open'),
      i.dueOn.lt(input.today),
    ]).count({ upTo: 1_000 }),
  }),
  output: ({ open, overdue }) => ({ open: open.count, overdue: overdue.count, more: open.more }),
})

// functions/project/read-project-health.ts — discloses counts over issues the caller may not read
export const readProjectHealth = defineAction<typeof schema>()('Project.health', async ({ self, query }) =>
  query(projectHealth, { project: self, today: new Date().toISOString().slice(0, 10) }, {
    as: 'executor',
  }),
)
```

Before writing one, check the model. If the caller should see the records, grant the read with a
Class rule (`policies.md`) instead of proxying it. If a narrow part of them is public, consider
modelling that part as data the caller may read. Disclosure behind an Action is a deliberate
business decision, so its name and contract state what it discloses.

## Layout

- `functions/` holds Actions and Workflows, one per owner file; register one exact `functions`
  collection, with no parallel handler registry or path dispatch.
- `queries/` and `mutations/` hold one Query or Mutation per owner file; `rules/` holds pure business Rules.
  Group them in business submodules behind curated facades, never a generic repository or decoder
  layer.
- Name files by intent: `read-project.ts`, `list-project-issues.ts`, `archive-project.ts`, not
  `record.ts`, `get.ts` or a catch-all `queries.ts`.
- Import the aggregate Schema as a type. Error, value and StateMachine facades supply runtime values.
- A Rule takes observations and returns a decision: no steps, no injected dependencies, no
  authorization. A fact that must still hold when the Mutation commits is a guard as well
  (`mutations.md`).

## The handler

`defineAction<typeof schema>()(address, { errors }?, handler)` binds the handler to the callable at
`address` (`'Issue.reassign'`, a static Function's name). The handler receives:

| Field | What it is |
| --- | --- |
| `input` | The admitted input; the SDK validated it and validates the output |
| `self` | The receiver's `NodeId`, on an instance Method |
| `caller` | The incoming call: `identity` is the caller, `principal` the executor (`authority.md`) |
| `query`, `mutate` | Query and Mutation calls, each naming its authority with `{ as }` (`queries.md`, `mutations.md`) |
| `kernel`, `graph` | Kernel syscalls and graph operations, as the executor; `.caller` and `.self` select |
| `dependencies` | Exact dependency callables, `.caller.invoke` or `.self.invoke` |
| `integrations` | The declared Integration clients (`integrations.md`) |
| `error` | Raises a declared error: `throw error(code, details)` |
| `execution` | The invocation's `signal`, `deadline`, `idempotencyKey`, `background`, `sleep` |
| `domain` | The Domain of the running build |

- Never re-validate the input, re-check the caller's rights or invent defaults: the SDK and the
  Kernel already did, and the Policy admitted the call before the handler ran.
- In public inputs and outputs, reference records by id: the input declares `nodeId()`, and
  `NodeId(input.person)` types it for a Query or a Mutation. Use a `Path` only where the developer asks for one
  or a called API requires it, converting at that boundary.
- Name a definition by its resolved handle or reference, never by a rebuilt locator string.
- Use the SDK's executors and bindings, never hand-built endpoints, tokens or routing
  (`debugging.md` diagnoses transport).

## One composed example

The Schema declares `Issue.reassign({ person })`, answering `{ changed }`, with its Policy. The Action
reads the current assignee, then makes one Mutation:

```ts
// queries/issue/read-assignee.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineQuery } from '@astrale-os/sdk/query'
import type { schema } from '#schema'

export const readAssignee = defineQuery<typeof schema>()('issues.issue.assignee', {
  build: (issue: NodeId, d) => d.Issue.with((i) => ({ assignee: i.assignee.pick().find() })).get(issue),
  output: (row) => row.assignee?.id,
})

// functions/issue/reassign-issue.ts — a read, then one Mutation: an Action
import { defineAction } from '@astrale-os/sdk/action'
import { NodeId } from '@astrale-os/sdk/graph/node'
import type { schema } from '#schema'
import { reassignIssue } from '#mutations/issue'
import { readAssignee } from '#queries/issue'

export const reassign = defineAction<typeof schema>()(
  'Issue.reassign',
  { errors: { ...reassignIssue.errors } },
  async ({ self, input, query, mutate }) => {
    const person = NodeId(input.person)
    const current = await query(readAssignee, self, { as: 'executor' })
    if (current === person) return { changed: false }
    await mutate(reassignIssue, { issue: self, from: current, to: person }, { as: 'executor' })
    return { changed: true }
  },
)
```

The Policy admitted the caller; the Domain then reads and writes its own Issue as `executor`, which
an absent `update` slot on `Issue` admits (`authority.md`). The read and the write are two
snapshots: if another call reassigns the issue between them, the delete of the old Edge or the
at-most-one cardinality refuses the Mutation. The Mutation, not the read, keeps the change correct.

## Expected errors

Declare a reusable error with `error` from `@astrale-os/sdk/schema/errors`, under the owning Schema
module's `errors/`:

```ts
// schema/modules/issue/errors/assignee-at-capacity.ts
import { error } from '@astrale-os/sdk/schema/errors'
import { z } from 'zod'

export const assigneeAtCapacity = error({
  family: 'CONFLICT',
  message: 'The person already has the maximum number of open issues.',
  details: z.strictObject({ person: z.string() }),
})
```

- A callable registers the errors it may raise under stable codes: its own, and those of the
  Queries and Mutations it calls (`{ errors: { ...reassignIssue.errors } }`). The declaration owns the safe
  message and the details contract; the registration key is the code.
- Declaring errors under Schema source does not install them as Schema members or as
  generated-client alternatives.
- Map only the failures the business expects. Keep a dependency's structured failure as it is; an
  unexpected exception is a defect, never invalid input or an error-shaped success.

## Calling other callables

- A dependency's callable: `dependencies.<alias>.caller.invoke((dep) => dep.functions.send, input)`
  for the caller, `.self.invoke(…)` as the Domain (`authority.md`). An instance Method takes its
  `NodeId` before the input. The release requests a `call` scope on it (`policies.md`); the
  `domains.md` guide covers choosing and declaring the dependency.
- The same call through the Kernel takes a reference, `reference(directory,
  directory.functions.lookup)` with `directory = domain.dependencies.directory` and `reference`
  from `@astrale-os/sdk/client/session`: `kernel.caller.invoke(lookup, input)` or
  `kernel.self.invoke(…)`. A reference keeps the full callable key and declaring revision; no
  `expect` or `schemaExpectation` option is needed. An instance reference requires the exact
  declaring Class, not a descendant. A raw instance path uses the entire key,
  `@id::files.example:class.Resource.method.rename`; its revision is optional.
- A Provider calls through its invocation-scoped typed `invoke`; Integrations are `integrations.md`.
- Never import a foreign handler, and never claim atomicity across Domains: two Domains' writes are
  two effects.

## Native HTTP routes

Use top-level `routes/` only for a native wire surface: a webhook, a passthrough, a compatibility
API. Ordinary Functions and frontend navigation need none. A route maps an HTTP method and path,
the receiver, headers or body and credentials to an admitted callable; the behavior stays in
`functions/`, and `domain.ts` composes the route collection.

```ts
// routes/document/download-document-route.ts
import { route } from '@astrale-os/sdk/domain'
import { downloadDocument } from '#functions/document'

export const downloadDocumentRoute = route(downloadDocument, {
  name: 'download-document',
  path: '/documents/{documentId}/download',
  method: 'GET',
  receiver: 'documentId',
})
```

## Abstract Methods

A Method declared `abstract: true` on a concrete Class needs an Action or a Workflow like any
other executable Method, and each descendant declares its own: there is no handler fallback. A
missing handler rejects the Runtime before it can serve calls.

## Pitfalls

- **Two effects in an Action.** A second Mutation, Integration write or dependency write makes a
  Workflow; two writes that can commit together make one Mutation.
- **A read as a guard.** The Action's read and its Mutation see different states. A condition that
  must hold at commit is a guard in the Mutation.
- **Success before the commit.** Answer success only after `mutate` resolves; on an unknown outcome,
  observe before retrying (`mutations.md`).
- **Reads in a loop.** One Query with relations or `id.in` replaces a read per row
  (`performance.md`).
- **Executor reads returned whole.** Rows read as `executor` and returned to the caller disclose them;
  return what the caller may learn.
