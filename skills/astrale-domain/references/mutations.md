# Mutations

Read to write the graph: define a Mutation, guard it, map its refusals, or decide what one
Mutation may contain. A Mutation is one atomic business change:

- **Atomic.** Its writes and guards commit together or not at all, in one Kernel invocation.
- **An effect set.** `build` declares writes and guards; it reads nothing and runs nothing.
- **Checked at commit.** The Kernel checks the Schema (keys, cardinalities, Edge endpoints, state
  machines) and every guard against the state the Mutation commits on.
- **Authority-neutral.** Each call names its authority (`authority.md`).

The examples write the Schema of `queries.md`.

## Grammar

```text
mutation   defineMutation<typeof schema>()(id, { build, output?, reject?, errors? })   from '@astrale-os/sdk/mutation'
id         lowercase dot-separated segments, shared with Queries: 'issues.issue.close'
build      (input, d, mutation) => undefined                synchronous; writes and guards only
write      mutation.createNode({ as, class: d.<Class>, props? })                         → created
           | mutation.updateNode({ node, class: d.<Class>, props: { set?, unset? } })
           | mutation.transition({ node, class: d.<Class>, property, from, event, props?, update? })
           | mutation.deleteNode({ node, class: d.<Class> })
           | mutation.createEdge({ class: d.<Edge>, source: end, target: end, slug?, props? })
           | mutation.updateEdge({ class: d.<Edge>, source, target, slug?, props?: { set?, unset? } })
           | mutation.deleteEdge({ class: d.<Edge>, source, target })
guard      mutation.expect.node({ node, class: d.<Class>, props?: { equals?, absent? } }, { name }?)
           | mutation.expect.edge({ class: d.<Edge>, source, target, slug?, props? }, { name }?)
           | mutation.expect.none(range, { name }?) | mutation.expect.exists(range, { name }?)
           | mutation.expect.count(range, n | { atLeast?, atMost? }, { name }?)
           | mutation.expect.unchanged(range, ids, { name }?)
range      d.<Class> | d.<Edge>  [ .where(conds) | .union(class) | .orderBy(keys) ]…  | canonical v7 Query
node       NodeId | NodePath | { id } | definition ref                    an existing Node
end        node | created                                                 createEdge only
output     (result, input) => Output              result: { createdNodes, replayed? }
reject     (failure, input, { error, is }) => Output | throw error(code, details) | throw failure
call       mutate(definedMutation, input, { as: 'executor' | 'caller' })   in an Action
           step.mutate(stepId, definedMutation, input, { as: 'executor' }) in a durable Workflow
           executeMutation(client, domain, definedMutation, input)         with a Client
```

- Each write and guard names one Class by its handle: a union names none. `as` binds a created Node
  for the Mutation's other writes and for `output`.
- `props` on create takes values; on update, `set` and `unset`. A guard's `props` takes `equals` and
  `absent`.
- `transition` names the state Property, the state the Node is in and the event. It derives the
  next state and guards `from`; `props` adds conditions and `update` other changes to the same
  Node.
- A guard's range is a set with no verb: `first`, `count`, `with` and `pick` are refused, since a
  bound or a rendering would not reach the guard. Its `where` takes every condition of
  `queries.md`. `count` bounds the number of roots; `unchanged` compares the range's roots, in its
  `orderBy`, with the ids a read returned (`edgeKey(row)` per Edge).
- `{ name }` is unique in the Mutation; a refusal on that guard carries it as `failure.precondition`.
- `output` maps the committed result; without it the call answers the `MutationResult`.
  `MutationResult.createdNode(result, alias)` reads a created Node's id. A replayed commit answers
  its first result with `replayed: true`.

Refusals, by `failure.code`:

| Code | When | `reject` |
| --- | --- | --- |
| `MUTATION_PRECONDITION_FAILED` | A guard, or the `from` of a `transition`, does not hold; `failure.precondition` names a named guard | Map the business conflict to a declared error or an output |
| `MUTATION_POST_STATE_INVALID` | The committed state would break the Schema; `failure.rule` names the rule, such as `duplicate-key` | Map a key collision; rethrow the rest |
| `MUTATION_OUTCOME_UNKNOWN` | `failure.outcomeKnown` is false: the write may have committed | Rethrow; the caller observes before retrying |
| `STATE_TRANSITION_ILLEGAL` | `transition` built from a state where the event is not declared | Map it when `from` comes from the input |

Every other failure is a defect: rethrow it.

## Patterns

### Create a record with its relations

Create a stateful Node in its machine's initial state, link it in the same Mutation, and answer its
id. A guard states the cross-Node condition the Schema cannot:

```ts
// mutations/issue/open-issue.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineMutation, MutationResult } from '@astrale-os/sdk/mutation'
import type { schema } from '#schema'
import { projectArchived } from '#schema/modules/issue/errors'

type OpenIssue = { readonly project: NodeId; readonly title: string; readonly priority: number }

export const openIssue = defineMutation<typeof schema>()('issues.issue.open', {
  build: (input: OpenIssue, d, mutation) => {
    mutation.expect.node(
      { node: input.project, class: d.Project, props: { equals: { archived: false } } },
      { name: 'project-active' },
    )
    const issue = mutation.createNode({
      as: 'issue',
      class: d.Issue,
      props: { title: input.title, status: 'open', priority: input.priority },
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

### Change state under a guard

`transition` changes state; `update` commits the Node's other changes in the same write. A guard
over other Nodes refuses the change while they block it:

```ts
type CloseIssue = { readonly issue: NodeId; readonly on: string }

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
    return { closed: false } // the issue was no longer open
  },
  errors: { ISSUE_BLOCKED: issueBlocked },
})
```

### Map a key collision

The Schema's key refuses a duplicate on every write: name the refusal, never guard it:

```ts
export const createProject = defineMutation<typeof schema>()('issues.project.create', {
  build: (input: { readonly name: string }, d, mutation) => {
    mutation.createNode({ as: 'project', class: d.Project, props: { name: input.name, archived: false } })
  },
  output: (result) => MutationResult.createdNode(result, 'project'),
  reject: (failure, input, { error }) => {
    if (failure.code === 'MUTATION_POST_STATE_INVALID' && failure.rule === 'duplicate-key')
      throw error('PROJECT_NAME_TAKEN', { name: input.name })
    throw failure
  },
  errors: { PROJECT_NAME_TAKEN: projectNameTaken },
})
```

### Replace a relation, bounded by a count

Guards observe the state before the Mutation: the count admits the new Edge when at most 19 hold.
Replacing a to-one relation deletes the old Edge and creates the new one:

```ts
type Reassign = { readonly issue: NodeId; readonly from: NodeId | undefined; readonly to: NodeId }

export const reassignIssue = defineMutation<typeof schema>()('issues.issue.reassign', {
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
  reject: (failure, input, { error }) => {
    if (failure.code === 'MUTATION_PRECONDITION_FAILED' && failure.precondition === 'assignee-load')
      throw error('ASSIGNEE_AT_CAPACITY', { person: input.to })
    throw failure
  },
  errors: { ASSIGNEE_AT_CAPACITY: assigneeAtCapacity },
})
```

### Commit what the user reviewed

`unchanged` refuses when the list a read returned changed before the commit: here the user confirms
archiving a project after reviewing its open issues:

```ts
type ArchiveProject = { readonly project: NodeId; readonly reviewed: readonly NodeId[] }

export const archiveProject = defineMutation<typeof schema>()('issues.project.archive', {
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
})
```

The read that showed the list uses the same `where` and `orderBy` and returns
`rows.map((row) => row.id)`.

### Edges and their Properties

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

- **One change per Node.** The writes form a set, not a program: two updates of one Node are
  refused. Merge them into one `updateNode`, or into the `update` of its `transition`.
- **The pre-state.** Every guard sees the state before the Mutation. An Edge created in the same
  Mutation satisfies no guard and grants no authority to a sibling write. Reference a created Node
  by the value `createNode` returns, never by a Path it will have.
- **The Schema is not a guard.** Keys, cardinalities, Edge endpoints and state machine transitions
  hold on every write: never restate them as guards. Map their refusals in `reject`.
- **A read is not a guard.** A Query before the Mutation observes another snapshot. A condition that
  must still hold at commit is a guard in the Mutation (`MUT-PRECONDS`); a Rule that decided on the
  read decides eligibility only.
- **Guards see their authority.** A guard decides over what its authority may read: as `caller`, an
  absence guard passes over the records the caller cannot see. Run a Mutation that guards a global
  invariant `{ as: 'executor' }`.
- **State through `transition`.** Create a stateful Node in its initial state (`MUT-STATE-INITIAL`)
  and change state only with `transition` (`MUT-STATE-ATOMIC`): it already guards `from`, so never
  add a guard on the state or set the state Property.
- **Not an upsert.** A create of an existing key is refused, and so is the delete of a missing Node
  or Edge. Decide before the Mutation or map the refusal.
- **Unknown outcome.** On `MUTATION_OUTCOME_UNKNOWN` or a lost response, the write may have
  committed: read the result before retrying. A durable step retries the same Mutation safely: the
  Kernel answers the first commit.
- **Never split.** A change that is refused as too large stays one change: never chunk it into
  several Mutations, which would commit partial states. A change that needs several Mutations is a
  Workflow, never one Mutation (`MUT-MULTI-WFL`, `workflows.md`).
- **Pure `build`.** `build` calls no session, Integration or clock (`MUT-PURE`): the input carries
  every value, including the time. A reusable fragment takes `d` and `mutation` and writes into
  the same Mutation (`MUT-FRAGMENTS`).
- **An empty range.** A range whose condition matches nothing (`id.in([])`) has no guard to send
  and is refused: decide that case in `build` from the input.
- **Success after commit.** The handler answers success only after `mutate` resolves.

## Limits

`MutationAST.limits` exposes the structural limits: 2,048 preconditions, 64 range guards and 4,096
ids across `unchanged` guards. A Host bounds execution separately. Past a limit, narrow the change
or make it a Workflow of independent business steps; never split one invariant.

## Legacy

Deprecated: the closure form `defineMutation<S>()((domain) => ({ id, build, project? }))`, and its
`expect.query` V6 precondition. A call without `as` runs a closure Mutation as the executor. Write
every Mutation with `defineMutation`, and rewrite a closure Mutation the change touches.
