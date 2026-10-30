# Mutations

A Mutation is one atomic change of the graph:

- **Atomic**: its writes and guards commit together or not at all, in one Kernel invocation.
- **An effect set, not a program**: `build` is synchronous, declares writes and guards, and reads
  nothing.
- **Decided on the pre-state**: every guard and every write's authorization is decided against the
  state before the Mutation; the Kernel checks the Schema (keys, cardinalities, Edge endpoints,
  state machines) on the post-state.
- **Authority-neutral**: each call names `{ as }` (`authority.md`).

## Grammar

```text
mutation   defineMutation<typeof schema>()(id, { build, output?, reject?, errors? })   '@astrale-os/sdk/mutation'
id         a Query's id form; Queries and Mutations share one namespace
build      (input, d, mutation) => undefined                   d: the handles of queries.md
write      mutation.createNode({ as, class, props? })                                      → created ref
           | mutation.updateNode({ node, class, props: { set?, unset? } })
           | mutation.transition({ node, class, property, from, event, props?, update? })
           | mutation.deleteNode({ node, class })
           | mutation.createEdge({ class, source: end, target: end, slug?, props? })
           | mutation.updateEdge({ class, source, target, slug?, props: { set?, unset? } })
           | mutation.deleteEdge({ class, source, target })
guard      mutation.expect.node({ node, class, props?: { equals?, absent? } }, { name }?)
           | mutation.expect.edge({ class, source, target, slug?, props? }, { name }?)
           | mutation.expect.none(range, { name }?) | mutation.expect.exists(range, { name }?)
           | mutation.expect.count(range, n | { atLeast?, atMost? }, { name }?)
           | mutation.expect.unchanged(range, ids, { name }?)
class      d.<Class> | d.<alias>.<Class> | d.kernel.<Class>, with no method called
range      class [.where(conds) | .union(class) | .orderBy(keys)]… | canonical v7 Query document
end        existing Node (NodeId | NodePath) | the ref createNode returned
output     (result: MutationResult, input) => Output            default: the MutationResult
reject     (failure, input, { error, is }) => Output | throw error(code, details) | throw failure
call       mutate(m, input, { as: 'executor' | 'caller' })      Action; `as` required (type and run time)
           step.mutate(stepId, m, input, { as: 'executor' })    durable Workflow; replay answers the commit
           executeMutation(client, domain, m, input)            Client
types      MutationInputOf<typeof m>, MutationOutputOf<typeof m>
```

Semantics:

- A write's `class` is a bare handle: a union names no Class (type error); a handle after
  `where`/`union`/`orderBy`, or of the other kind (Node vs Edge), is a `TypeError` at build.
- `transition` derives the next state from the StateMachine and asserts `from`; `props` adds
  conditions on the Node, `update` the Node's other changes in the same write.
- A range is never read or rendered. A verb (`get`, `first`, `page`, `all`, `exists`, `count`),
  `with`, `pick`, `includeWithheld`, `d.document(…)` and a relation (`i.project`, `.via`) are refused
  at build. A canonical document's `limit`, `upTo`, `select` and `with` never reach the guard. A
  relation that must exist is a condition: `.where((t) => t.via(edge).exists())`.
- `count(range, n)` admits exactly `n` roots; bounds are non-negative safe integers, `atLeast ≤
  atMost`, at least one given; else `TypeError` at build.
- `unchanged(range, ids)` holds when the range's whole root list, in its `orderBy`, equals `ids`
  in order: a `NodeId` per Node, an `edgeKey(row)` per Edge. It counts roots the reader may traverse
  but not read: take `ids` from a read with `.includeWithheld()`, or they never match.
- `{ name }`: non-empty, unique in the Mutation (else `TypeError`); never sent to the Kernel; returned
  as `failure.precondition` when that precondition fails. Absent when unnamed or when the Host does
  not point at the failed precondition.
- `MutationResult` is `{ createdNodes, replayed? }`; `MutationResult.createdNode(result, alias)`
  reads a created Node's id. A replayed commit answers its first result with `replayed: true`.
- A blob Property takes an upload receipt: `session.blob.upload(file, { mediaType })`, then
  `props: { set: { content: uploaded.receipt } }`. A guard's `equals.content` compares the stored
  `Ref`; a `Ref` is never accepted as a write value.
- A Mutation with a guard is wire v4. A Host serving only v3 refuses it `FUNCTION_INPUT_INVALID`,
  which the SDK passes through without calling `reject`.
- `query(m)` of a Mutation is refused.

## Errors

| `failure.code` | When | Details |
| --- | --- | --- |
| `MUTATION_PRECONDITION_FAILED` | A guard, `expect.node`/`edge`, or a `transition`'s `from` does not hold | `precondition` (name) |
| `MUTATION_POST_STATE_INVALID` | The post-state breaks the Schema | `rule`, e.g. `duplicate-key` |
| `MUTATION_OUTCOME_UNKNOWN` | The write may have committed | `outcomeKnown: false` |
| `STATE_TRANSITION_ILLEGAL` | SDK-side, before sending: `event` is not declared from `from` | `from`, `event` |

The Kernel's no-effect refusals (`MUTATION_SNAPSHOT_STALE`, `MUTATION_RESOURCE_EXHAUSTED`,
`MUTATION_CAPACITY_EXHAUSTED`, `MUTATION_UNAVAILABLE`, `MUTATION_CANCELLED`,
`MUTATION_DEADLINE_EXCEEDED`, `MUTATION_INPUT_INVALID`) committed nothing. `reject` maps only the
expected business refusals to a declared error or an output; it rethrows everything else. Without
`reject`, every refusal is thrown.

## Patterns

Create in the machine's initial state, link, guard a cross-Node condition, answer the id:

```ts
export const openIssue = defineMutation<typeof schema>()('issues.issue.open', {
  build: (input: OpenIssue, d, mutation) => {
    mutation.expect.node(
      { node: input.project, class: d.Project, props: { equals: { archived: false } } },
      { name: 'project-active' },
    )
    const issue = mutation.createNode({
      as: 'issue',
      class: d.Issue,
      props: { title: input.title, status: issueStatus.initial, priority: input.priority },
    })
    mutation.createEdge({ class: d.in_project, source: issue, target: input.project })
  },
  output: (result) => MutationResult.createdNode(result, 'issue'),
  reject: (failure, input, { error }) => {
    if (failure.code === 'MUTATION_PRECONDITION_FAILED' && failure.precondition === 'project-active')
      throw error('PROJECT_ARCHIVED', { project: input.project })
    throw failure
  },
  errors: { PROJECT_ARCHIVED: projectArchived },
})
```

Transition under an absence guard; an expected stale state as an output:

```ts
export const closeIssue = defineMutation<typeof schema>()('issues.issue.close', {
  build: (input: CloseIssue, d, mutation) => {
    mutation.expect.none(
      d.Issue.where((blocker) => [
        blocker.status.eq('open'),
        blocker.via(d.blocks, { direction: 'outgoing' }).is(input.issue),
      ]),
      { name: 'open-blockers' },
    )
    mutation.transition({
      node: input.issue,
      class: d.Issue,
      property: 'status',
      from: 'open',
      event: 'close',
      update: { set: { closedOn: input.on } },
    })
  },
  output: () => ({ closed: true }),
  reject: (failure, input, { error }) => {
    if (failure.code !== 'MUTATION_PRECONDITION_FAILED') throw failure
    if (failure.precondition === 'open-blockers') throw error('ISSUE_BLOCKED', { issue: input.issue })
    return { closed: false } // `from` no longer holds
  },
  errors: { ISSUE_BLOCKED: issueBlocked },
})
```

A Schema key refuses duplicates on every write: map the refusal, never guard it:

```ts
reject: (failure, input, { error }) => {
  if (failure.code === 'MUTATION_POST_STATE_INVALID' && failure.rule === 'duplicate-key')
    throw error('PROJECT_NAME_TAKEN', { name: input.name })
  throw failure
},
```

A count no cardinality states (the pre-state count, so `atMost: 19` admits a 20th); a to-one
relation replaced by delete + create:

```ts
build: (input: Reassign, d, mutation) => {
  mutation.expect.count(
    d.Issue.where((i) => [i.status.eq('open'), i.assignee.is(input.to)]),
    { atMost: 19 },
    { name: 'assignee-load' },
  )
  if (input.from !== undefined)
    mutation.deleteEdge({ class: d.assigned_to, source: input.issue, target: input.from })
  mutation.createEdge({ class: d.assigned_to, source: input.issue, target: input.to })
},
```

Commit only what the user reviewed; the read used the same `where` and `orderBy`, with
`.pick().includeWithheld()`:

```ts
build: (input: ArchiveProject, d, mutation) => {
  mutation.expect.unchanged(
    d.Issue.where((i) => [i.project.is(input.project), i.status.eq('open')]).orderBy((i) =>
      i.title.asc(),
    ),
    input.reviewed,
    { name: 'reviewed-issues' },
  )
  mutation.updateNode({ node: input.project, class: d.Project, props: { set: { archived: true } } })
},
```

Edges:

```ts
mutation.updateEdge({
  class: d.comment_on,
  source: input.comment,
  target: input.issue,
  props: { set: { pinned: true } },
})
mutation.expect.edge({ class: d.in_project, source: input.issue, target: input.project })
mutation.deleteNode({ node: input.comment, class: d.Comment })
```

## Pitfalls

- **Two writes on one Node or Edge** are refused, also when two Paths resolve to it. Merge them into
  one `updateNode`, or into the `transition`'s `update`.
- **Created facts in guards or authority.** An Edge created in the same Mutation satisfies no guard
  and grants no authority to a sibling write. Reference a created Node by the ref `createNode`
  returned, never by its future Path.
- **Restating the Schema.** Keys, cardinalities, Edge endpoints and state machine transitions hold on
  every write; a guard restating them only costs a read. Map their refusals in `reject`.
- **A read as a guard.** A Query before the Mutation observed another snapshot. A condition that must
  hold at commit is a guard (`MUT-PRECONDS`); a Rule decided on a read decides eligibility only.
- **Guard under `caller`.** A guard sees only what its authority reads: an absence guard run as
  `caller` passes over Nodes the caller cannot see. Guard a global invariant `{ as: 'executor' }`.
- **State outside `transition`.** Create a stateful Node with the machine's `initial`
  (`MUT-STATE-INITIAL`), never a copied literal; change state only with `transition`
  (`MUT-STATE-ATOMIC`), which already asserts `from`.
- **Upsert.** Creating an existing key is refused (`duplicate-key`); updating or deleting a missing
  Node or Edge, or naming the wrong Class, is refused without disclosing the actual Class.
- **Retry after an unknown outcome.** On `MUTATION_OUTCOME_UNKNOWN` or a lost response, observe
  before retrying. `step.mutate` retries safely: the Kernel answers the first commit.
- **Splitting.** A change refused as too large stays one change: chunking it into several Mutations
  commits partial states. A change needing several Mutations is a Workflow (`MUT-MULTI-WFL`).
- **Impure `build`.** No session, Integration, clock or retry (`MUT-PURE`): the input carries every
  value, now included. A fragment takes `d` and `mutation` and writes into the same Mutation
  (`MUT-FRAGMENTS`).
- **An empty range** (`id.in([])`, `in([])`) has no document and is refused: decide that case in
  `build` from the input.
- **Success before `mutate` resolves.**

## Limits

`MutationAST.limits`: 2,048 preconditions, 64 range guards, 4,096 ids across `unchanged` guards. A
Host bounds execution separately (`MUTATION_RESOURCE_EXHAUSTED`). Past a limit, narrow the change or
make it a Workflow of independent business steps; never split one invariant.

A write on a dependency's Class is a cross-Domain write: call the dependency's Function instead.
A direct write, only when the developer asks for one, declares its Class scope in the release's
`requirements` (`MUT-PLAN-REQ`, `policies.md`). An Edge of the Domain's own Class to a dependency's
Node is not a foreign write.

## Legacy

Deprecated: the closure form `defineMutation<S>()((domain) => ({ id, build, project? }))`, whose
`build(input, mutation, d)` takes resolved Classes, and its V6 precondition `expect.query` (wire v3;
one Mutation never holds both v3 and v4 preconditions). A closure Mutation called without `as` runs
as the executor. Rewrite a closure Mutation the change touches.
