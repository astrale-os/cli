# Actions

The Schema owns each callable's input, output, receiver, `auth` mode and `policy`; an Action or a
Workflow is its handler.

## Action, Workflow or no callable

An Action reads, then makes at most one effect, last (`FNC-ONE-EFFECT`). An effect is a Mutation,
or a state-changing Integration, dependency or Kernel call; a Query or a call that changes nothing
is an observation.

| The callable | Write |
| --- | --- |
| Reads, then makes one effect or none | An Action |
| Makes two or more effects that cannot commit together, or waits | A durable Workflow (`workflows.md`) |
| Only reads what its caller may read | No callable: define the Query (Read-only Actions) |

- Prefer an Action: it answers in one request. A durable Workflow pays a request per Step and its
  caller follows an Execution. Writes that can commit together are one Mutation, so one Action.
- Reads never make a Workflow, also when a user waits on screen.

## Read-only Actions

Avoid them: a client reads the graph under its own authority (a View's Query hooks, `views.md`;
`astrale query`; a Client's `runQuery`; another Domain's own Query), and the Kernel decides each
reader's rows by its Class rules. A read-only callable adds a request, a Policy and a contract for
nothing.

The exception is a deliberate disclosure: the caller learns something it may not read itself (a
slot taken, a count or a status over records it may not see, a public summary). The Action reads
`{ as: 'executor' }` and returns only what the caller may learn, never the rows; its name and
contract state what it discloses:

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

Check the model first: when the caller should see the records, a `read` rule grants them
(`policies.md`); when a narrow part of them is public, model that part as data the caller may read.

## Layout

- `functions/` holds Actions and Workflows, one per owner file, registered as one exact `functions`
  collection: no parallel handler registry or path dispatch.
- `queries/` and `mutations/` hold one Query or Mutation per owner file; `rules/` holds pure business
  Rules. Group them in business submodules behind curated facades, never a generic repository or
  decoder layer.
- Files are named by intent (`read-project.ts`, `list-project-issues.ts`, `archive-project.ts`),
  never `record.ts`, `get.ts` or a catch-all `queries.ts`.
- The aggregate Schema is imported as a type; error, value and StateMachine facades supply runtime
  values.
- A Rule takes observations and returns a decision: no steps, no injected dependencies, no
  authorization. A fact that must still hold at commit is also a guard (`mutations.md`).

## The handler

`defineAction<typeof schema>()(address, { errors }?, handler)` binds the handler to the callable at
`address` (`'Issue.reassign'`, or a static Function's name). The handler receives:

| Field | What it is |
| --- | --- |
| `input` | The admitted input; the SDK validated it and validates the output. On a binary-input Function, the metadata |
| `body` | On a binary-input Function: `{ body: ReadableStream<Uint8Array>, length }`, single-consumer (Streams and bytes) |
| `self` | The receiver's `NodeId`, on an instance Method |
| `caller` | The incoming call: `identity` is the caller, `principal` the executor (`authority.md`) |
| `query`, `mutate` | Query and Mutation calls, each naming its authority with `{ as }` (`queries.md`, `mutations.md`) |
| `kernel`, `graph` | Kernel syscalls and graph operations, as the executor; `.caller` and `.self` select |
| `dependencies` | Exact dependency callables, `.caller.invoke` or `.self.invoke` |
| `integrations` | The declared Integration clients (`integrations.md`) |
| `error` | Raises a declared error: `throw error(code, details)` |
| `execution` | The invocation's `signal`, `deadline`, `idempotencyKey`, `background`, `sleep` |
| `domain` | The Domain of the running build |

- The SDK validated the input and the Kernel admitted the caller: never re-validate, re-check rights
  or invent defaults.
- Public inputs and outputs reference records by id: the input declares `nodeId()`, and
  `NodeId(input.person)` types it for a Query or a Mutation. A `Path` only where the developer asks
  for one or a called API requires it, converted at that boundary.
- A definition is named by its resolved handle or reference, never by a rebuilt locator string.
- Calls go through the SDK's executors and bindings, never hand-built endpoints, tokens or routing
  (`debugging.md` diagnoses transport).

## Composed example

The Schema declares `Issue.reassign({ person })`, answering `{ changed }`, with its `policy`. One
read, then one Mutation:

```ts
// queries/issue/read-assignee.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineQuery } from '@astrale-os/sdk/query'
import type { schema } from '#schema'

export const readAssignee = defineQuery<typeof schema>()('issues.issue.assignee', {
  build: (issue: NodeId, d) => d.Issue.with((i) => ({ assignee: i.assignee.pick().find() })).get(issue),
  output: (row) => row.assignee?.id,
})

// functions/issue/reassign-issue.ts
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

- Both calls are `executor`: the Domain owns `Issue`, and the `policy` already decided the user.
- The read and the Mutation are two snapshots. A reassignment between them makes the Mutation's
  delete of the old Edge, or the at-most-one cardinality, refuse it: the Mutation keeps the change
  correct, not the read.

## Streams and bytes

| Output declared (`schema.md`) | The handler returns |
| --- | --- |
| a value schema | the value |
| `output.stream(item)` | an `AsyncIterable` of items: `async () => items()`, `items` an `async function*`; the handler itself is never a generator |
| `output.binary()`, buffered | `{ body: Uint8Array, mediaType, status?, headers? }` |
| `output.binary()`, streamed | `{ body: AsyncIterable<Uint8Array>, mediaType, length?, delivery?: { maximumDurationMs, idleTimeoutMs }, status?, headers? }` |

- A buffered body is replayable under idempotency; a streamed one is not, and holds its resources
  until delivered or cancelled. A declared `length` is exact: delivery aborts on a mismatch.
- A provider's bytes pass through as they arrive: never collected, never turned into stream items,
  with only the headers the Integration admits.
- Binary input: the body was admitted against `maximumBytes` before the handler runs (else
  `LIMIT_EXCEEDED`). Read it once, through its end; never `tee()` it or read it before handing it
  on. `kernel.content.upload(body, { mediaType })` takes it unread and streams it to the Kernel
  (`blob.writer`, `policies.md`); the upload is one attempt, never retried.
- Storing a received file is two effects, the upload and the Mutation recording its receipt in the
  same invocation (receipts expire). A binary input excludes a durable Workflow: write an inline
  Workflow (`workflows.md`); after a failure, the caller sends the file again.

## Expected errors

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

- A reusable error lives under the owning Schema module's `errors/`. Declaring it there installs no
  Schema member and no generated-client alternative.
- A callable registers every error it may raise under a stable code: its own and those of the
  Queries and Mutations it calls (`{ errors: { ...reassignIssue.errors } }`). The declaration owns
  the safe message and the details contract; the registration key is the code.
- Map only the failures the business expects. A dependency's structured failure passes as it is;
  an unexpected exception is a defect, never invalid input or an error-shaped success.

## Calling other callables

- A dependency's callable: `dependencies.<alias>.caller.invoke((dep) => dep.functions.send, input)`
  for the caller, `.self.invoke(…)` as the Domain (`authority.md`). An instance Method takes its
  `NodeId` before the input. The release declares a `call` scope on it (`policies.md`); choosing
  and declaring the dependency: `domains.md`.
- Through the Kernel, the call takes a reference: `reference(directory,
  directory.functions.lookup)` with `directory = domain.dependencies.directory` and `reference`
  from `@astrale-os/sdk/client/session`, then `kernel.caller.invoke(lookup, input)` or
  `kernel.self.invoke(…)`. A reference keeps the full callable key and declaring revision: no
  `expect` or `schemaExpectation` option. An instance reference requires the exact declaring Class,
  not a descendant. A raw instance path uses the entire key,
  `@id::files.example:class.Resource.method.rename`; its revision is optional.
- A Provider calls through its invocation-scoped typed `invoke`; Integrations: `integrations.md`.
- Never import a foreign handler. Two Domains' writes are two effects, never atomic together.

## Native HTTP routes

Top-level `routes/` is only for a native wire surface: a webhook, a passthrough, a compatibility
API. A route maps an HTTP method and path, the receiver, headers or body and credentials to an
admitted callable; the behavior stays in `functions/`, and `domain.ts` composes the route
collection.

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

A Method declared `abstract: true` on a concrete Class needs a handler like any executable Method,
and each descendant declares its own: there is no handler fallback.
A missing handler rejects the Runtime before it can serve calls.

## Pitfalls

- **Two effects in an Action.** A second Mutation, Integration write or dependency write makes a
  Workflow; two writes that can commit together are one Mutation.
- **A read as a guard.** The Action's read and its Mutation see different states: a condition that
  must hold at commit is a guard in the Mutation.
- **Success before the commit.** Answer only after `mutate` resolves; on an unknown outcome, observe
  before retrying (`mutations.md`).
- **Reads in a loop.** One Query with relations or `id.in` replaces a read per row
  (`performance.md`).
- **Executor reads returned whole.** Rows read as `executor` and returned to the caller disclose
  them; return what the caller may learn.
- **A `caller` write on the Domain's own Class.** No write slot admits the user: write as
  `executor` (`policies.md`, Class Policies).
