# Queries

A Query v7 is a typed, bounded, authority-neutral read of the graph:

- **Typed** from the Domain's Schema: a Class, Property or relation the Domain cannot name does not
  compile; rows need no decoder.
- **Bounded before sending**: the SDK refuses a Query past its bounds (S11) or with a relation that
  crosses an undeclared dependency Class (S12), before any read.
- **One Kernel invocation and one snapshot per read.** Facets, steps and pages of one Query share no
  snapshot. Exception: a root `id.in` past 32,768 ids is sent in consecutive parts, each at its own
  snapshot, rows merged in Kernel order.
- **Authority-neutral**: each call names `{ as }` (`authority.md`); the reader's Class
  `read`/`traverse` Policies decide its rows. A row absent from a read is invisible to that reader,
  not proven absent.
- **One `QueryError` per refusal**, by code. A network failure, a refusal carrying a retry time and
  `INSTANCE_MAINTENANCE` pass through unchanged; business refusals are declared errors.

The package reference is `@astrale-os/sdk` `docs/queries.md`.

## Grammar

```text
query      defineQuery<typeof schema>()(id, { build, output?, errors? })        '@astrale-os/sdk/query'
id         unique in the Domain; dot-separated segments of [a-z0-9-]: 'issues.issue.read'
build      (input, d, steps) => read | facets | steps(facets, (earlier) => facets, …)
facets     { name: read | read[] | undefined, … }
steps      2..8; each next step is a function of the merged earlier results and adds new names only
read       set.verb | d.document(canonical v7 document)
set        root [.where(conds) | .orderBy(keys) | .with(relations) | .union(class) | .pick() | .includeWithheld()]…
root       d.<Class> | d.<alias>.<Class> | d.kernel.<Class> | d.<EdgeClass>
target     NodeId | NodePath | d.core.<node>
verb       get(target?) | find(target?) | exists(target?) | first() | first(n) | first(n, { more: true })
           | page({ max }) | all({ max }) | count({ upTo })
relations  (node) => ({ name: relation.verb, … })
relation   node.<role>                                    to-one end, by its far role
           | node.via(edge | [edge, …], { direction? })    'outgoing' | 'incoming' | 'incident'
           [.where((node, edge) => conds) | .orderBy((node, edge) => keys) | .with(relations)
            | .withEdge() | .distinct() | .pick() | .includeWithheld()]…
           verbs: get() find() exists() first() first(n) all({ max }) count({ upTo })
conds      cond | [cond | falsy, …]                       list = and; falsy entries skipped
cond       prop.<term> | node.id.eq(id) | node.id.in(ids) | node.path.eq(path) | node.path.in(paths)
           | node.is(class) | node.is(class, (narrowed) => conds) | node.isExactly(class)
           | relation.is(target) | relation.exists() | relation.some(f?) | relation.none(f?)
           | relation.every(f) | relation.atLeast(n, f?) | relation.atMost(n, f?) | relation.exactly(n, f?)
           | cond.and(cond, …) | cond.or(cond, …) | cond.not()
keys       key | [key, …];  key = prop.asc({ missing?: 'first' | 'last' }) | prop.desc(…)
output     (results, input, { error, is }) => portable JSON           synchronous, pure; default: results
errors     { CODE: error({ family, message, details }) }
```

`d.origin` is the Domain's origin. A Class or alias named `kernel`, `core`, `origin` or `document`
has no handle.

Terms by the Property's value kind:

| Kind | Terms |
| --- | --- |
| text, instant | `eq` `in` `gt` `gte` `lt` `lte` `between` `startsWith` `isSet` `isMissing` `asc` `desc` |
| number | `eq` `in` `gt` `gte` `lt` `lte` `between` `isSet` `isMissing` `asc` `desc` |
| enum | `eq` `in` `isSet` `isMissing` `asc` `desc` |
| boolean | `eq` `in` `isSet` `isMissing` `asc` `desc` |
| JSON value | `eq` `isSet` `isMissing` |
| set (array of unique items) | `isSet` `isMissing` |

Verbs:

| Verb | Answers | Raises |
| --- | --- | --- |
| `get(target?)` | exactly one row | none: `NOT_FOUND`; a second: `INTEGRITY`; unreadable: `NOT_READABLE` |
| `find(target?)` | one row or `undefined` | a second: `INTEGRITY`; unreadable: `NOT_READABLE` |
| `exists(target?)` | `boolean` | |
| `first()` / `first(n)` | first row or `undefined` / up to `n` rows | |
| `first(n, { more: true })` | `{ rows, more }`, reading `n + 1` | |
| `page({ max })` | `{ rows, next? }`; only as the Query's single read | |
| `all({ max })` | every row | past `max`: `TOO_MANY` |
| `count({ upTo })` | `{ count, more }`; `more` = reached `upTo` | |

Semantics:

- `between(l, u)` is `l <= v < u`. `eq(null)` matches a stored null; `isMissing()` an absent value.
- `in` takes ≤ 16 values. `id.in` is unbounded at a read's root; elsewhere a read carries ≤ 32,768
  ids and values.
- A Class handle includes its subclasses; `isExactly` excludes them. `d.A.union(d.B)` reads the
  Nodes of both Classes.
- `node.is(class)` in `where` narrows the rows' type to that Class's Properties. `is(row, classKey)`
  in `output` narrows `$class` only, never the Properties.
- Rows follow identity, or the `orderBy` Properties with identity breaking every tie: `first(n)`
  and each page are deterministic.
- `orderBy` sorts rows missing the value last, in either direction, unless `{ missing: 'first' }`.
  On a union whose Classes map one name to different Properties, that name filters but does not
  order. A set or JSON Property never orders.
- `.via` requires `direction` when both ends accept the Edge Class, or when the listed Edge Classes
  leave the Node in different directions.
- A relation's `get` finding none or a second raises `INTEGRITY` naming the relation.
- `.with` reading another root, or adding a name the row already carries, does not compile: read it
  as a facet.
- `steps` orders the reads of one call. They are not durable Workflow Steps: nothing is journaled.
  A name read again does not compile and throws a `TypeError` before the step reads.
- `get` asserts existence: use it for ids the Domain holds. For an id a caller sends, `find` and
  raise a declared error from `output`.

Rows are portable JSON:

- Node row: `id`, `$class` (the Class or a subclass the Domain can name), each Property by name;
  an optional Property may be absent, `null` is a stored null.
- `.with` adds each relation's answer under its name; `.withEdge()` adds the Edge's Class and
  Properties under `$edge`.
- `.pick()`: `{ id, $class }`. `.includeWithheld()` keeps unreadable rows of a list as
  `{ id, $class, $withheld }`, `$withheld` naming the withheld values; `get`/`find` still raise
  `NOT_READABLE` on them.
- `.distinct()`: each far Node once per parent row, however many Edges reach it; no `withEdge`.
- Edge root row: `{ $class, $source, $target }`, the Edge's Properties, both ends under their
  roles. Its `get()`, `find()`, `exists()` take no target; its `first(n)` takes no `{ more }`.
  `edgeKey(row)` (`@astrale-os/sdk/query`) gives the `{ source, target, class }` a Mutation names
  an Edge by.
- A Property whose name the SDK takes is under `$prop`: `id` on rows, a handle member (`id`,
  `path`, `is`, `isExactly`, `via`) on handles, an Edge root's roles. `path` is `row.path` on a row,
  `a.$prop.path` on a handle.
- Two parents' Properties of one name that the Class does not redeclare are grouped by owner, in
  lower camel case: `row.$record.title`. An owner name taking an SDK key gets one more `$`:
  `$$class`.

## Calling

```text
query(q, input, { as: 'executor' | 'caller' })        Action; inline Workflow inside step.run
query(pageQ, input, { as, size?, after? })            size: integer 1..max, default max; else TypeError
step.query(stepId, q, input, { as: 'executor' })      durable Workflow; output journaled, replay returns it
runQuery(client, domain, q, input, { size?, after? }, declared?)     '@astrale-os/sdk/query'; declared → S12
checkQuery(q, sampleInput, { domain })                '@astrale-os/sdk/testing'
OutputOf<typeof q>, InputOf<typeof q>                 answer and input types
isQueryError(error, code?)
```

- A Query without input takes `undefined`. An `auth: 'anonymous'` callable reads `as: 'executor'`
  only.
- In `step.query`, a `QueryError` other than `REFUSED`, or an S12 `TypeError`, fails the Step at
  once and a replay throws it again. `REFUSED` is a failed attempt: a permanent one exhausts the
  Step, a stale snapshot spends no attempt.
- A callable re-declares the Query's errors to raise them: `{ errors: { ...readIssue.errors } }`.
- `checkQuery` runs S11 and S12 on the first step built from `sampleInput`, without a Kernel; S12
  only when given the Domain definition, not the Schema alone. Give it an input that builds every
  optional condition; test later steps through a call.

## Errors

`QueryError` carries the Query's id, a `code` and its details:

| Code | When | Details |
| --- | --- | --- |
| `NOT_FOUND` | A root `get` found nothing | `class`; `target` |
| `NOT_READABLE` | `get`/`find` met a fact the reader may not read | `class`; `id` (an Edge's key) |
| `INTEGRITY` | A relation's `get` found none, or a second row where one is allowed | `relation`; `parent`; `found: 0 \| 2` |
| `TOO_MANY` | Past a `max`, a verb bound, the Query's rows or reads | `limit: 'max' \| 'rows' \| 'reads'`; `bound` |
| `REFUSED` | The Kernel refused the read | `kernelCode`; `retryable` |
| `INPUT_INVALID` | The SDK or the Kernel refused the built document before reading | `kernelCode`, `phase`, `path`; `limit: 'in'` |
| `OUTDATED` | The Host's Registry does not match the Domain's build | `kernelCode: 'QUERY_EXPECTATION_MISMATCH'` |
| `UNSUPPORTED` | The Kernel does not serve Query v7, or omits a row's Class | `feature: 'v7' \| 'classes'` |

A Runtime that does not name the v7 refusal answers `REFUSED` with `kernelCode: 'INTERNAL_ERROR'`.
A business refusal is a declared error raised from `output`; an expected case is a union in the
output, not an error.

## Patterns

One record a caller names, with relations in the same read:

```ts
export const readIssue = defineQuery<typeof schema>()('issues.issue.read', {
  build: (issue: NodeId, d) =>
    d.Issue.with((i) => ({
      project: i.project.get(),
      assignee: i.assignee.find(),
      pinned: i
        .via(d.comment_on, { direction: 'incoming' })
        .where((_comment, edge) => edge.pinned.eq(true))
        .orderBy((comment) => comment.postedAt.desc())
        .first(3),
      comments: i.via(d.comment_on, { direction: 'incoming' }).count({ upTo: 100 }),
    })).find(issue),
  output: (row, issue, { error }) => {
    if (row === undefined) throw error('ISSUE_NOT_FOUND', { issue })
    return {
      title: row.title,
      project: row.project.name,
      assignee: row.assignee?.name,
      pinned: row.pinned.map((comment) => comment.body),
      comments: row.comments.more ? '99+' : String(row.comments.count),
    }
  },
  errors: { ISSUE_NOT_FOUND: issueNotFound },
})
```

Optional filters in place; `!== undefined` where `0` or `false` is a filter value:

```ts
export const projectIssues = defineQuery<typeof schema>()('issues.project.issues', {
  build: (filter: IssueFilter, d) =>
    d.Issue.where((i) => [
      i.project.is(filter.project),
      i.status.eq('open'),
      filter.assignee && i.assignee.is(filter.assignee),
      filter.minPriority !== undefined && i.priority.gte(filter.minPriority),
      filter.prefix && i.title.startsWith(filter.prefix),
    ])
      .orderBy((i) => [i.priority.desc(), i.dueOn.asc()])
      .first(50, { more: true }),
})
```

Relation conditions, evaluated by the Kernel before the verb's bound:

```ts
d.Issue.where((i) => [
  i.via(d.blocks, { direction: 'incoming' }).none((blocker) => blocker.status.eq('open')),
  i.via(d.comment_on, { direction: 'incoming' }).none(),
  i.project.some((project) => project.archived.eq(false)),
]).all({ max: 500 })

d.Issue.where((i) =>
  i.assignee.some((person) => person.id.in(people)).or(i.dueOn.between('2026-10-01', '2026-11-01')),
).first(20)
```

Subclasses and unions:

```ts
d.Issue.where((i) => [i.project.is(project), i.is(d.Bug)]).first(5) // rows: Bug, with severity
d.Issue.where((i) => i.isExactly(d.Issue)).first(20) // no subclass

export const triage = defineQuery<typeof schema>()('issues.issue.triage', {
  build: (project: NodeId, d) =>
    d.Issue.where((i) => [
      i.project.is(project),
      i.is(d.Bug, (bug) => bug.severity.gte(3)).or(i.priority.gte(8)),
    ]).all({ max: 200 }),
  output: (rows, _project, { is }) =>
    rows.map((row) => ({ id: row.id, title: row.title, bug: is(row, 'issues.example:class.Bug') })),
})

export const latest = defineQuery<typeof schema>()('issues.latest', {
  build: (_: undefined, d) => d.Issue.union(d.Comment).first(20),
  output: (rows, _input, { is }) =>
    rows.map((row) => (is(row, 'issues.example:class.Comment') ? row.body : row.title)),
})
```

Facets read independently; a step reads after the earlier results:

```ts
export const projectBoard = defineQuery<typeof schema>()('issues.project.board', {
  build: (project: NodeId, d) => ({
    project: d.Project.find(project),
    open: d.Issue.where((i) => [i.project.is(project), i.status.eq('open')]).count({ upTo: 1_000 }),
    recent: d.Issue.where((i) => i.project.is(project)).orderBy((i) => i.dueOn.desc()).first(10),
  }),
})

export const issueContext = defineQuery<typeof schema>()('issues.issue.context', {
  build: (issue: NodeId, d, steps) =>
    steps(
      { issue: d.Issue.with((i) => ({ project: i.project.get() })).find(issue) },
      ({ issue: row }) => {
        const dueOn = row?.dueOn // narrowing does not survive into the callback below
        return {
          earlier:
            row === undefined || dueOn === undefined
              ? undefined
              : d.Issue.where((i) => [i.project.is(row.project.id), i.dueOn.lt(dueOn)]).count({
                  upTo: 100,
                }),
        }
      },
    ),
})
```

Pages:

```ts
export const projectIssuesPage = defineQuery<typeof schema>()('issues.project.issues-page', {
  build: (project: NodeId, d) =>
    d.Issue.where((i) => i.project.is(project)).orderBy((i) => i.title.asc()).page({ max: 100 }),
})

const first = await query(projectIssuesPage, project, { as: 'caller', size: 50 })
const second = first.next
  ? await query(projectIssuesPage, project, { as: 'caller', size: 50, after: first.next })
  : undefined
```

Edge roots, references, withheld rows, `distinct`, Core nodes:

```ts
d.comment_on.where((e) => [e.pinned.eq(true), e.issue.id.eq(issue)]).all({ max: 50 })
d.Issue.where((i) => i.project.is(project)).pick().includeWithheld().first(100)
d.Issue.with((i) => ({
  linked: i.via(d.blocks, { direction: 'incident' }).distinct().all({ max: 50 }),
  blockers: i.via(d.blocks, { direction: 'incoming' }).withEdge().all({ max: 50 }),
})).get(issue)
d.Issue.where((i) => i.project.is(d.core.inbox)).first(20)
```

## Pitfalls

- **Filtering in `output`** runs after the verb's bound: `first(20)` then a filter returns fewer
  than 20 and misses matches. Filter in `where`, with a relation condition for related Nodes.
- **A read per returned row.** Carry relations with `with`; read many ids with one `id.in`, not a
  list of `find`s.
- **Falsy filter values.** `filter.x && p.eq(filter.x)` skips the filter when `x` is `0` or `false`
  (`QRY-FALSY`).
- **Clock in `build` or `output`** (`QRY-CLOCK`): take now in the input.
- **One state across reads.** Facets, steps and pages are separate snapshots. A write that depends
  on a fact still holding guards it in the Mutation (`mutations.md`).
- **Authority changes the answer.** The same Query read `as: 'caller'` and `as: 'executor'` can
  answer differently.
- **Access in the name.** Name the observation (`listProjectIssues`), never an access promise
  (`listAuthorizedIssues`).

## Limits

| Limit | Value | Refusal |
| --- | --- | --- |
| Reads per Query | 32 | `TOO_MANY` (`limit: 'reads'`) |
| Rows per Query, from verb bounds × relations per parent row | 100,000 | `TOO_MANY` (`limit: 'rows'`) |
| A verb's bound | 83,332 | `TOO_MANY` |
| Values of an `in` | 16 | `INPUT_INVALID` (`limit: 'in'`) |
| Ids and values per read, outside its root `id.in` | 32,768 | `INPUT_INVALID` |
| `steps` | 2..8 | does not compile; `TypeError` |

- Kernel plan limits, checked before planning: estimated `cost`, `traversal-depth` 18,
  `conjuncts-per-pattern` 20, `connective-depth` 85, `order-keys` 100, `nesting` 450; a Host may
  lower them. Refusal: `INPUT_INVALID` with `kernelCode: 'QUERY_INPUT_INVALID'`, `phase`, `path`;
  the Kernel details carry `issue: 'QUERY_PLAN_LIMIT_EXCEEDED'`, `limit`, `maximum`, `actual`.
- Neither the bounds nor the plan limits are transient: narrow the read or split it into steps.
- `QRY-ROWS` warns when a Query's constant bounds multiply past 10,000 rows.
- S12: a relation crossing a direct dependency's Class needs `read` and `traverse` scopes on that
  Class in the release's `requirements` (`policies.md`); a scope on a parent Class covers its
  children. Otherwise the call throws a `TypeError` naming the Query, relation and scope. Roots,
  Kernel Classes and the Domain's own Classes need none. A condition the input leaves unbuilt is
  not checked; a relation an empty list folds away is.
- Maintenance and repair sessions serve no Query v7 (`INSTANCE_MAINTENANCE`); a migration there
  reads with V6 (`migration.md`).

Beyond v7, bridge inside the Query; the bridge's reads and rows count toward its bounds, and the
SDK splits no read except a long root `id.in`:

| Need | Bridge |
| --- | --- |
| A value compared with a parent's | A step reads the parent, the next compares; or read both, filter in `output` |
| Two pattern parts meeting at one Node | Read both with `with`, compare in `output` |
| Ancestors, a sub-tree at any depth | One step per level with `id.in`, ≤ 8 levels |
| Sums, averages, groups | `all({ max })`, compute in `output` |
| Case-insensitive search, locale sort | A normalized Property the Domain writes, or filter and sort in `output` |
| Several unrelated lists | Facets |

When no bounded read answers, change the read or the product design and state the cost; never
truncate silently.

## Legacy

Deprecated: V6 definitions (`Query.from`, `defineQuery<S>()((domain) => …)`,
`defineCollectionQuery`, `defineCompositeQuery`) and `graph.query(definition)`. V6 is used only
where v7 is not served (maintenance and repair sessions). `d.document(query)` reads one canonical v7
document whose lists carry a `limit`; its rows are typed `unknown`, so `output` validates them.
Prefer handles.
