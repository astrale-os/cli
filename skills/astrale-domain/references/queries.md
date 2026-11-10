# Queries

Read for the read grammar: handles, verbs and their bounds, conditions, relations, `.reachable()`,
rows, refusals, and the ranges a Mutation guards on. `runtime.md` owns where a Query lives and how a
handler calls it. The installed SDK's types decide: a Class, Property or relation the Domain cannot
name does not compile.

## Shape

```ts
// queries/issue/issue-with-thread.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineQuery } from '@astrale-os/sdk/query'
import type { schema } from '#schema'
import { issueNotFound } from '#schema/modules/issue/errors'

export const issueWithThread = defineQuery<typeof schema>()('tracker.issue.with-thread', {
  build: (issue: NodeId, d) =>
    d.Issue.with((i) => ({
      assignee: i.assignee.find(),
      pinned: i
        .via(d.comment_on, { direction: 'incoming' })
        .where((_comment, edge) => edge.pinned.eq(true))
        .orderBy((comment) => comment.postedAt.desc())
        .first(3),
      comments: i.via(d.comment_on, { direction: 'incoming' }).count({ upTo: 1_000 }),
    })).find(issue),
  output: (row, issue, { error }) => {
    if (row === undefined) throw error('ISSUE_NOT_FOUND', { issue })
    return row
  },
  errors: { ISSUE_NOT_FOUND: issueNotFound },
})

// In an Action that declares `errors: { ...issueWithThread.errors }`
const issue = await query(issueWithThread, input.issue, { as: 'caller' })
```

`defineQuery<Schema>()(id, { build, output?, errors? })`. The id is unique in the Domain, shared with
Mutations: dot-separated segments of lowercase letters, digits and `-`.

- **Bounded before it reads.** Every verb carries its bound; the SDK refuses a Query past its bounds
  before anything is sent.
- **One snapshot per read.** Each read is one Kernel invocation. Facets, steps and pages of one
  Query share no snapshot.
- **Authority-neutral.** A Query names no authority; each call names it with `{ as }`.
- **One `QueryError` per refusal**, by code. Business refusals are the Query's declared `errors`.

## Handles

`build(input, d)` receives the handles of the Domain.

| Handle | Reads |
| --- | --- |
| `d.Issue` | A Node Class of the Domain. An Edge Class handle (`d.comment_on`) reads Edges at the root. |
| `d.directory.Person` | A Class of the dependency the Schema aliases `directory`. |
| `d.kernel.<Class>` | A Kernel Class. |
| `d.core.<node>` | A Core node of the Domain, as a target: `get(d.core.settings)`, `rel.is(d.core.settings)`. |
| `d.origin` | The Domain's origin. |
| `d.document(query)` | One canonical v7 document whose lists carry a `limit`; rows are `unknown`, so `output` validates them. |

A Class handle reads the Class and its subclasses. `d.A.union(d.B)` reads the Nodes of both: a
union, never an intersection.

## Verbs

A read starts from a Class handle, narrows with `where`, orders with `orderBy`, carries relations
with `with`, and ends with one verb.

| Verb | Answers | Refusals |
| --- | --- | --- |
| `get(id?)` | Exactly one row | None: `NOT_FOUND`. A second: `INTEGRITY`. Unreadable: `NOT_READABLE`. |
| `find(id?)` | One row, or `undefined` | A second: `INTEGRITY`. Unreadable: `NOT_READABLE`. |
| `first()` | The first row, or `undefined` | |
| `first(n)` | Up to `n` rows | |
| `first(n, { more: true })` | `{ rows, more }`, reading `n + 1` rows | |
| `page({ max })` | `{ rows, next? }`; only as a Query's single read | |
| `all({ max })` | Every row | Past `max` rows read: `TOO_MANY`. |
| `exists(id?)` | `boolean` | |
| `count({ upTo })` | `{ count, more }`; `more` says the count reached `upTo` | |

`id` is a `NodeId`, a `NodePath` or a Core node. `.ref()` renders rows as references
(`{ id, $class }`). `.includeWithheld()` keeps the rows the reader may not read, as
`{ id, $class, $withheld }`.

## Conditions

`where` takes one condition or a list, an implicit `and`. A falsy entry is skipped, so an optional
filter is written in place: `filter.author && i.author.is(filter.author)`.

| Term | Meaning |
| --- | --- |
| `p.eq(v)` | Equal. `eq(null)` matches a stored null. |
| `p.in(values)` | One of at most 16 values. |
| `node.id.eq(id)`, `node.id.in(ids)` | The Node is this one, or one of these; `id.in` takes any length at a read's root. |
| `node.path.eq(path)`, `node.path.in(paths)` | The Node is at this path, or at one of these. |
| `p.isSet()`, `p.isMissing()` | The value is present, or absent. |
| `p.gt`, `p.gte`, `p.lt`, `p.lte`, `p.between(lower, upper)` | Ranges on text, numbers and open values; `between` is `lower <= value < upper`. |
| `p.startsWith(prefix)` | A text prefix. |
| `node.is(Class)`, `node.isExactly(Class)` | The Node is of the Class (or a subclass for `is`); narrows the handle and the rows. |
| `node.is(Class, (n) => conditions)` | Of the Class, and meeting conditions written on the narrowed handle. |
| `c.and(…)`, `c.or(…)`, `c.not()` | Combinators on any condition. |
| `rel.is(target)`, `rel.exists()` | The relation reaches this Node, or any Node. |
| `rel.some(cond?)`, `rel.none(cond?)`, `rel.every(cond)` | Over the Nodes it reaches. |
| `rel.atLeast(n, cond?)`, `rel.atMost(n, cond?)`, `rel.exactly(n, cond?)` | How many it reaches. |

A relation condition's callback receives `(node, edge)`: conditions on the far Node and on the
Edge's Properties.

`orderBy` takes one key or a list: `orderBy((i) => [i.updatedAt.desc(), i.title.asc()])`. Rows
without the value sort last; `asc({ missing: 'first' })` sorts them first.

## Relations

- A to-one end is named by its far role: `i.assignee`. Any Edge is read with
  `.via(edge, { direction })`, `direction` being `outgoing`, `incoming` or `incident`;
  `.via([e1, e2])` reads several Edge Classes. `direction` is required when both ends accept the
  Class, or when the Edges listed leave it in different directions.
- A relation reads per parent row with `get`, `find`, `first`, `first(n, { more: true })`, `all`,
  `count` and `exists`, and takes `where`, `orderBy`, `with`, `ref`, `includeWithheld`, `distinct`
  and `withEdge()`. A relation's `get` that finds none, or a second row, raises `INTEGRITY`.
- `.withEdge()` adds the Edge's Class and Properties to each row under `$edge` (and `$edge.$slug`).
  The Edge is then a fact the row reads: unreadable, the row is left out.
- `.with((i) => ({ name: read }))` adds each relation's answer to the row under that name. A `.with`
  cannot read another root: read it as a facet.

### `.reachable()`: follow a relation one Edge or more

`i.parent.reachable()` reads every ancestor of an Issue;
`folder.via(d.contains, { direction: 'outgoing' }).reachable()` a whole sub-tree: the Nodes the
relation reaches however far, in one snapshot and inside what the reader may traverse.

```ts
d.Issue.with((i) => ({
  ancestors: i.parent.reachable().ref().all({ max: 20 }),
  urgentBelow: i
    .via(d.parent_of, { direction: 'outgoing' })
    .reachable({ through: (child) => child.priority.gte(2) })
    .withEdge()
    .first(10),
})).find(issue)
```

- **Rows.** The Edges it follows, each once with the Node it reaches; with `.distinct()`, the Nodes
  it reaches, each once however many routes reach them. The starting Node is among them only when a
  cycle returns to it, and a cycle ends the walk. Rows come in no order of depth.
- **`where` and `through`.** `where` holds on each Edge followed and each Node reached.
  `reachable({ through })` holds on every Node a walk passes through: a walk stops at a Node
  `through` does not keep, which it still reaches.
- **Verbs and conditions.** Every verb and every relation condition (`is`, `some`, `none`,
  `atLeast`…) reads the relation so followed. `.withEdge()` then names both ends of each Edge,
  `$edge.$source` and `$edge.$target`: the Edge leaves a Node the walk passed through, not the
  row's parent.
- **A bound limits rows, not the walk.** The Kernel walks the whole closure before it orders rows,
  whatever the page or `first(n)`. Walk bounded structures (a parent chain, a sub-tree) and narrow
  with `through`.

What it refuses:

| Where | What | Fix |
| --- | --- | --- |
| Compile time | No Class it reaches can start another of its Edges: `i.assignee.reachable()` | Walk a relation that returns to its own Classes. |
| Build | Followed `incident` without `.distinct()` | Add `.distinct()`: an Edge reached from both ends lists Nodes only. |
| Build | Directed and undirected Edge Classes together, or an undirected Edge whose roles accept different Classes | `{ direction: 'incident' }`. |
| Kernel, `INPUT_INVALID` (tier `unanchored`) | A walking relation condition decided at every Node of a Class | Write it on a root named by `id` or `path`, or read it in a `.with`. |
| Build | A Mutation guard whose range walks | Read the walk in a Query, then guard what it found. |
| Run, `UNSUPPORTED` (`feature: 'reachable'`) | The Host predates it | Bridge with one step per level until the Host is upgraded. |

`.reachable()` exists only in an SDK that types it: check the installed SDK before relying on it.
A depth, or an order by depth, is not expressed: read one level per step with `id.in`.

## Rows

- A Node row is portable JSON: `id`, `$class`, and every Property by name. An optional Property may
  be absent; `null` is a stored null. `$class` is the Class or any subclass the Domain can name.
- A Property whose name the SDK takes is under `$prop`: `row.$prop.id`, `handle.$prop.path`.
- An Edge read at the root answers `{ $class, $source, $target }`, its Properties, both ends' rows
  under their roles, and `$slug` when it has one. `edgeKey(row)` gives the
  `{ source, target, class }` a Mutation names an Edge by.
- From a Node, a direction along an undirected Edge names a role, never a stored end: `'outgoing'`
  reads the Edges where the Node takes the first declared role.

## Several reads

`build` returns one read, or a record of facets read together. A facet is a read, a list of reads
or `undefined`:

```ts
build: (account: NodeId, d) => ({
  account: d.Account.get(account),
  invoices: d.Invoice.where((i) => i.account.is(account)).all({ max: 500 }),
})
```

Reads that wait for others chain with `steps`, `build`'s third parameter: two to eight steps, the
first a record of facets, each next one a function of the merged results before it. They order the
reads of one call; they are not a Workflow's durable Steps.

```ts
build: (id: NodeId, { Issue, Comment }, steps) =>
  steps({ issue: Issue.find(id) }, ({ issue }) => ({
    comments: issue && Comment.where((c) => c.issue.is(id)).first(20),
  })),
```

`output(results, input, { error, is })` maps the results to the answer: synchronous, pure, portable
JSON. Without it the Query answers what `build` read. `is(row, classKey)` narrows a row. An
expected case is a union in the output; a refusal the caller handles by code is declared in
`errors` and thrown from `output` only. A Function lets it reach its own caller by declaring it
again: `{ errors: { ...query.errors } }`.

## Calling

| Call | Use |
| --- | --- |
| `query(q, input, { as: 'executor' \| 'caller' })` | An Action or an inline Workflow. `as` is required. No input: `undefined`. |
| `query(q, input, { as, size?, after? })` | A page Query (single read `.page({ max })`): answers `{ rows, next? }`. |
| `query.all(q, input, { as, max })` | Every row of a page Query, page after page; `TOO_MANY` past `max`. |
| `step.query(id, q, input, { as: 'executor' })` | A durable Workflow: journaled, replayed from the journal. |

`{ as: 'caller' }` answers only what both the caller and the Domain may observe and leaves out the
rest without saying so. An `auth: 'anonymous'` callable reads as `executor` only.

## Bounds, requirements, errors

- **Bounds.** At most 32 reads and 100,000 rows per Query, counted from its verbs' bounds and its
  relations per parent row; a verb's bound is at most 83,332; an `in` takes 16 values. One answer is
  bounded in bytes (16 MiB by default): read large rows with `page`.
- **Requirements.** A read `{ as: 'caller' }` whose relation crosses a dependency Class that admits
  only some callers needs the scope on it in the Domain's requirements:
  `requirements({ scopes: [{ on: Class, operations: ['traverse'] }] })`, or `read` when a condition
  tests one of its values. Otherwise the call throws a `TypeError` naming the Query, the relation and
  the requirement. A walk is checked for every Class it passes through.
- **`checkQuery(query, sampleInput, { domain, as? })`** from `@astrale-os/sdk/testing` runs both
  checks in a test, without a Kernel. Give it an input that builds every optional condition.

| `QueryError` code | When |
| --- | --- |
| `NOT_FOUND` | A root `get` found nothing. |
| `NOT_READABLE` | `get` or `find` met a fact the reader may not read. |
| `INTEGRITY` | A relation's `get` found none, or a second row came where one is allowed. |
| `TOO_MANY` | Past a verb's `max`, `query.all`'s, the Query's rows or reads, or the answer's bytes. |
| `REFUSED` | The Kernel refused the read; `retryable` says whether a retry may succeed. |
| `INPUT_INVALID` | The SDK or the Kernel refused the document before reading. |
| `OUTDATED` | The Host's Registry does not match the Domain's build. |
| `UNSUPPORTED` | The Host does not serve the `feature`: `'v7'`, `'classes'` or `'reachable'`. |

`isQueryError(error, code?)` recognizes one. The Domain linter reads Queries too: `QRY-CLOCK` (no
clock in `build` or `output`; take now in the input), `QRY-ROWS` (constant bounds multiply past
10,000 rows), `QRY-FALSY` (a skipped entry whose value may be `false` or `0`).

## Mistakes that change the answer

- `get` asserts that the row exists: use it for ids the Domain holds. For an id a caller sends, use
  `find` and throw a declared error from `output`.
- A row left out because the reader may not read it still counts as read: `rows` may be short or
  empty while `more` is true or `next` is present, `first()` may answer `undefined` with a readable
  row behind it, and `all({ max })` raises `TOO_MANY` past `max` rows read.
- Changing the rendering can change the rows: read as values, a row the reader may not read is left
  out; `.ref()` reads identities, and `.includeWithheld()` keeps the row and names what is withheld.
- `filter.x && p.eq(filter.x)` skips the filter when `x` is `false` or `0`. Write
  `filter.x !== undefined && …` when it applies whenever the caller sends it.
- `eq(null)` is a stored null; an absent value is `isMissing()`.
- A filter in `output` runs after the Kernel applied the verb's bound: it is not a complete
  server-side search. Express the condition in `where`, or read a bounded complete list.
- Facets, steps and pages each read at their own snapshot: do not treat them as one point in time.
- An ID alone does not prove existence, visibility or Class, and absence from a caller-visible read
  is not global nonexistence.

## What v7 does not express

Bridge inside the Query, with a step or in `output`; the bridge counts toward its bounds.

| The business asks | Bridge |
| --- | --- |
| A value compared with a parent's | A first step reads the parent, the next compares; or filter in `output`. |
| Two parts of a pattern meeting at one Node | Read both with `.with`, compare in `output`. |
| A hierarchy by depth, or cut at a depth | One step per level with `id.in`, up to 8 steps. |
| Sums, averages, groups | Read the values with `all({ max })`, compute in `output`. |
| Case-insensitive search, locale sorting | A normalized Property the Domain writes, or sort in `output`. |

## Guard ranges

A Mutation guards its write on a range: a Class handle after `where`, `union` and `orderBy`
(`runtime.md`, Mutations). A read (`first`, `exists`, `count`…) and a rendered set (`with`, `ref`)
are refused there, since their verb, size or rendering would not reach the guard; so is a range
whose condition walks with `.reachable()`.

## Query V6

`defineQuery<Schema>()((domain) => ({ id, build, project }))` with `Query.from(…)`,
`defineCompositeQuery`, `defineCollectionQuery`, `queryResult` and `mutation.expect.query` are the
deprecated V6 forms. They keep their meaning; write nothing new with them, with one exception:
Query v7 is not served in maintenance or repair sessions, so a migration that runs there reads
with V6.

| V6 | v7 |
| --- | --- |
| `Query.from({ nodes: [domain.classes.Task] })` | `d.Task` |
| `Query.from({ nodes: [taskId] })` | `d.Task.get(taskId)` |
| `.filter({ predicate: Property(key).equals(v) })` | `.where((t) => t.status.eq(v))` |
| `.expand({ via, direction })` | `.via(edge, { direction })`, or a named to-one relation |
| `select` with a `reference` projection | `.ref()` |
| `page: { size }`, `pagination: { maximumPages }` | `.page({ max })` called with `{ size, after }`; `.all({ max })` |
| `project(result)` | `output(results, input, { error, is })` |
| `defineCompositeQuery`, `defineCollectionQuery` | Facets, `steps(…)`, `d.A.union(d.B)` |
| `query(definition, input)` | `query(query, input, { as })` |
| `expect.query({ query, equals })` | `expect.none`, `expect.exists`, `expect.count`, `expect.unchanged` |
