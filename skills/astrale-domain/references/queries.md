# Queries

Read to read the graph: author a Query recipe, call it from a handler, or choose how to express a
read. A recipe is a typed business observation:

- **Typed by the Schema.** Handles, conditions and rows come from the Domain's Schema; a Class,
  Property or relation it cannot name does not compile. Rows need no decoder and no defaults.
- **Bounded before it reads.** Every read ends with a verb that bounds it; the SDK refuses a recipe
  past its bounds before sending anything.
- **One snapshot per read.** Each read is one Kernel invocation at its own snapshot. Facets, steps
  and pages of one recipe share none.
- **Authority-neutral.** A recipe names no authority; each call names the one it reads under
  (`authority.md`). The reader's Class `read`/`traverse` rules decide which rows it sees.

The full reference ships in the `@astrale-os/sdk` package as `docs/queries.md`.

## Grammar

```text
recipe     defineQuery<typeof schema>()(id, { build, output?, errors? })       from '@astrale-os/sdk/query'
id         lowercase dot-separated segments of letters, digits and '-': 'issues.issue.read'
build      (input, d, steps) => read | facets | steps(facets, (earlier) => facets, …)   2 to 8 steps
facets     { name: read | read[] | undefined, … }
read       set . verb | d.document(canonical v7 document)
set        root [ .where(conds) | .orderBy(keys) | .with(relations) | .union(class)
                | .pick() | .includeWithheld() ]…
root       d.<Class> | d.<alias>.<Class> | d.kernel.<Class> | d.<Edge>
verb       get(id?) | find(id?) | exists(id?) | first() | first(n) | first(n, { more: true })
           | page({ max }) | all({ max }) | count({ upTo })
id         NodeId | NodePath | d.core.<node>
relations  (node) => ({ name: relation . verb, … })
relation   node.<role>                                    a to-one end, named by its far role
           | node.via(edge | [edge, …], { direction? })    'outgoing' | 'incoming' | 'incident'
           [ .where((node, edge) => conds) | .orderBy((node, edge) => keys) | .with(relations)
           | .withEdge() | .distinct() | .pick() | .includeWithheld() ]…
           verbs: get() find() exists() first() first(n) all({ max }) count({ upTo })
conds      cond | [cond | false | undefined, …]           a list is an `and`; falsy entries are skipped
cond       prop.<term> | node.id.eq(id) | node.id.in(ids) | node.path.eq(path) | node.path.in(paths)
           | node.is(class) | node.is(class, (narrowed) => conds) | node.isExactly(class)
           | relation.is(id) | relation.exists() | relation.some(f?) | relation.none(f?)
           | relation.every(f) | relation.atLeast(n, f?) | relation.atMost(n, f?) | relation.exactly(n, f?)
           | cond.and(cond, …) | cond.or(cond, …) | cond.not()
keys       key | [key, …]          key = prop.asc({ missing?: 'first' | 'last' }) | prop.desc(…)
output     (results, input, { error, is }) => portable JSON                 pure and synchronous
errors     { CODE: error({ family, message, details }) }
call       query(recipe, input, { as: 'executor' | 'caller' })              in an Action
           query(pageRecipe, input, { as, size?, after? })
           step.query(stepId, recipe, input, { as: 'executor' })           in a durable Workflow
```

Property terms, by the Property's value:

| Value | Terms |
| --- | --- |
| any | `isSet()`, `isMissing()` |
| text | `eq`, `in`, `gt`, `gte`, `lt`, `lte`, `between(lower, upper)`, `startsWith`, `asc`, `desc` |
| number | `eq`, `in`, `gt`, `gte`, `lt`, `lte`, `between`, `asc`, `desc` |
| enum, boolean | `eq`, `in`, `asc`, `desc` |
| JSON object | `eq` |

`between` is `lower <= value < upper`. `eq(null)` matches a stored null, `isMissing()` an absent
value. `in` takes at most 16 values; `id.in` takes any number at a read's root.

Verbs:

| Verb | Answers | Raises |
| --- | --- | --- |
| `get(id?)` | exactly one row | `NOT_FOUND` for none, `INTEGRITY` for a second, `NOT_READABLE` for one the reader may not read |
| `find(id?)` | one row or `undefined` | `INTEGRITY` for a second, `NOT_READABLE` |
| `exists(id?)` | `boolean` | |
| `first()`, `first(n)` | the first row or `undefined`, up to `n` rows | |
| `first(n, { more: true })` | `{ rows, more }` | |
| `page({ max })` | `{ rows, next? }`; the recipe's single read | |
| `all({ max })` | every row | `TOO_MANY` past `max` |
| `count({ upTo })` | `{ count, more }`; `more` when the count reached `upTo` | |

A relation's `get` that finds none or a second raises `INTEGRITY` naming the relation. An Edge root
answers `{ $class, $source, $target }`, the Edge's Properties and both ends under their roles; its
`get`, `find` and `exists` take no id, and its `first(n)` no `{ more }`.

Rows are portable JSON: `id`, `$class` and each Property by name; an optional Property may be
absent, and `null` is a stored null. `.with` adds each relation's answer under its name,
`.withEdge()` the Edge under `$edge`, `.pick()` renders rows as `{ id, $class }`, and
`.includeWithheld()` keeps the rows the reader may not read as `{ id, $class, $withheld }`.
`.distinct()` renders a far Node once per parent row however many Edges reach it, so it takes no
`withEdge`. A Property whose name the SDK takes goes under `$prop`: `id` on rows, a handle member
(`id`, `path`, `is`, `isExactly`, `via`) on handles, an Edge root's roles; `path` is `row.path` on
a row and `a.$prop.path` on a handle. Two parents' Properties of one name, which the Class does not
redeclare, go under their owner's name: `row.$record.title`.

## Patterns

The examples read this Schema, origin `issues.example`, with `Person` from the `directory`
dependency:

```text
Project      { name (unique), archived: boolean }
Issue        { title, status: open ⇄ closed (close, reopen), priority: number, dueOn?: text, closedOn?: text }
Bug          extends Issue { severity: number }
Comment      { body, postedAt }
in_project   Issue (exactly 1) → Project           issue.project
comment_on   Comment (exactly 1) → Issue { pinned }   comment.issue
assigned_to  Issue (at most 1) → directory.Person  issue.assignee
blocks       Issue → Issue, any number             read with .via(blocks, { direction })
core node    inbox: Project                        d.core.inbox
```

### One record the caller names

`find` the id a caller sends and raise a declared error from `output`; read its relations in the
same read with `with`, and answer what the business needs:

```ts
// queries/issue/read-issue.ts
import type { NodeId } from '@astrale-os/sdk/graph/node'
import { defineQuery } from '@astrale-os/sdk/query'
import type { schema } from '#schema'
import { issueNotFound } from '#schema/modules/issue/errors'

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
      status: row.status,
      project: row.project.name,
      assignee: row.assignee?.name,
      pinned: row.pinned.map((comment) => comment.body),
      comments: row.comments.more ? '99+' : String(row.comments.count),
    }
  },
  errors: { ISSUE_NOT_FOUND: issueNotFound },
})
```

### A filtered list

A `where` list takes optional filters in place: a falsy entry is skipped. Test a value that may be
`0` or `false` with `!== undefined`, or it skips the filter:

```ts
type IssueFilter = {
  readonly project: NodeId
  readonly assignee?: NodeId
  readonly minPriority?: number
  readonly prefix?: string
}

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

### Filter by related facts in the read

A relation condition keeps the filter in the Kernel, before the verb's bound:

```ts
// Open issues that no open issue blocks, without a comment, outside archived projects
d.Issue.where((i) => [
  i.status.eq('open'),
  i.via(d.blocks, { direction: 'incoming' }).none((blocker) => blocker.status.eq('open')),
  i.via(d.comment_on, { direction: 'incoming' }).none(),
  i.project.some((project) => project.archived.eq(false)),
]).all({ max: 500 })

// Issues assigned to someone in a Person list, or due in October
d.Issue.where((i) =>
  i.assignee.some((person) => person.id.in(people))
    .or(i.dueOn.between('2026-10-01', '2026-11-01')),
).first(20)
```

### Subclasses

A Class handle includes its subclasses. Narrow with `is`, exclude them with `isExactly`, and tell
rows apart in `output` with `is(row, classKey)`. A row carries the Properties of the Class read: a
Bug's `severity` is a condition here, and a read of `d.Bug` returns it:

```ts
export const triage = defineQuery<typeof schema>()('issues.issue.triage', {
  build: (project: NodeId, d) =>
    d.Issue.where((i) => [
      i.project.is(project),
      i.is(d.Bug, (bug) => bug.severity.gte(3)).or(i.priority.gte(8)),
    ]).all({ max: 200 }),
  output: (rows, _project, { is }) =>
    rows.map((row) => ({ id: row.id, title: row.title, bug: is(row, 'issues.example:class.Bug') })),
})

d.Issue.where((i) => i.isExactly(d.Issue)).first(20) // Issues that are not Bugs

// The Nodes of both Classes, a union, not an intersection; `is` tells its rows apart
export const latest = defineQuery<typeof schema>()('issues.latest', {
  build: (_: undefined, d) => d.Issue.union(d.Comment).first(20),
  output: (rows, _input, { is }) =>
    rows.map((row) => (is(row, 'issues.example:class.Comment') ? row.body : row.title)),
})
```

### Several reads, and reads that wait for another

Independent reads are facets of one recipe. A read that needs an earlier answer is a step:

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
        const dueOn = row?.dueOn
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

A facet may also be a list of reads, `ids.map((id) => d.Issue.find(id))`; for many ids prefer one
read with `id.in(ids)`.

### Pages

A page recipe's single read is `.page({ max })`; the call passes `size` and the cursor:

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

### Edges at the root, references, withheld rows

```ts
// Pinned comment links, both ends by role; edgeKey(row) names one Edge for a guard
d.comment_on.where((e) => [e.pinned.eq(true), e.issue.id.eq(issue)]).all({ max: 50 })

// References only, and rows the reader may not read kept as { id, $class, $withheld }
d.Issue.where((i) => i.project.is(project)).pick().includeWithheld().first(100)

// Issues linked by `blocks` either way, each once, with the Edge on each blocker row
d.Issue.with((i) => ({
  linked: i.via(d.blocks, { direction: 'incident' }).distinct().all({ max: 50 }),
  blockers: i.via(d.blocks, { direction: 'incoming' }).withEdge().all({ max: 50 }),
})).get(issue)

// A Core node the Schema declares, as a target
d.Issue.where((i) => i.project.is(d.core.inbox)).first(20)
```

## Calling

- In an Action: `query(recipe, input, { as })`; a recipe without input takes `undefined`. In a
  durable Workflow: `step.query(id, recipe, input, { as: 'executor' })`, journaled and replayed.
- Outside a handler, a Client runs it with `runQueryRecipe(client, domain, recipe, input)`.
- `OutputOf<typeof recipe>` and `InputOf<typeof recipe>` type the answer and the input for Rules
  and Views.
- A Function lets a recipe's errors reach its caller by declaring them:
  `{ errors: { ...readIssue.errors } }`.
- `isQueryError(error, code?)` recognizes a `QueryError`. `checkRecipe(recipe, sampleInput,
  { domain })` from `@astrale-os/sdk/testing` runs the bounds and requirements checks in a test,
  without a Kernel; give it an input that builds every optional condition.

## Pitfalls

- **An id proves nothing.** An id does not prove existence, visibility or Class. `find` an id the
  caller sends and raise a declared error; `get` only ids the Domain itself holds. Absence from a
  read is "not visible to this reader", not "does not exist".
- **Read, then drop rows.** Filtering in `output` runs after the Kernel applied the verb's bound:
  `first(20)` then a filter returns fewer than 20 and misses matches. Put the condition in `where`,
  as a relation condition when it is about related Nodes.
- **Read again.** Project the rows a read returned; never read each returned Node again. Carry
  relations with `with`.
- **Union and subclasses.** `d.A.union(d.B)` reads the Nodes of both Classes, not their
  intersection. A Class handle includes its concrete descendants: add `isExactly` when a subclass
  must not qualify.
- **Direction.** `.via` needs `direction` when both ends accept the Edge Class (`blocks`) or when
  the listed Edges leave it in different directions.
- **Falsy filters.** `filter.x && p.eq(filter.x)` skips the filter when `x` is `0` or `false`
  (`QRY-RECIPE-FALSY`). Write `filter.x !== undefined && …`, or say that `false` means no filter.
- **Time.** `build` and `output` read no clock (`QRY-RECIPE-CLOCK`): take `now` in the input.
- **Snapshots.** Facets, steps and pages are separate reads at separate snapshots: never claim they
  observe one state. A write that depends on a fact still holding guards it (`mutations.md`).
- **Authority changes the answer.** A list leaves out rows its reader may not read. The same recipe
  read as `caller` and as `executor` can answer differently (`authority.md`).
- **Order and missing values.** Rows without the ordered value sort last unless
  `asc({ missing: 'first' })`. On a union whose Classes map one name to different Properties, the
  name filters but does not order.
- **Naming.** Name the observation, not an access promise: `listProjectIssues`, not
  `listAuthorizedIssues`. `listIssuesByAssignee` is a business filter, not access control.

## Limits

| Limit | Value | Refusal |
| --- | --- | --- |
| Reads per recipe | 32 | `TOO_MANY` (`limit: 'reads'`) |
| Rows per recipe, counted from verb bounds and relations per parent row | 100,000 | `TOO_MANY` (`limit: 'rows'`) |
| A verb's bound | 83,332 | `TOO_MANY` |
| `in` values | 16 | `INPUT_INVALID` (`limit: 'in'`) |
| Ids and values carried by a read outside its root `id.in` | 32,768 | `INPUT_INVALID` |
| `steps` | 2 to 8 | does not compile |

- The Kernel refuses a document past its plan limits before planning it (`INPUT_INVALID` with
  `kernelCode`, `phase` and `path`): its estimated `cost`, `traversal-depth` (18),
  `conjuncts-per-pattern` (20), `connective-depth` (85), `order-keys` (100) and `nesting` (450); a
  Host may lower them. Neither refusal is transient: narrow the read or split it into steps.
- `QRY-RECIPE-ROWS` warns when a recipe's constant bounds multiply past 10,000 rows.
- A relation that crosses a dependency's Class needs `read` and `traverse` scopes on it in the
  release's `requirements` (`policies.md`); otherwise the call throws a `TypeError` naming the scope
  to add. Roots, Kernel Classes and the Domain's own Classes need none.
- Query v7 is not served in maintenance or repair sessions (`INSTANCE_MAINTENANCE`): a migration
  there reads with V6 (`migration.md`).

What the language cannot express is bridged inside the recipe, invisible to its callers:

| The business asks | Bridge |
| --- | --- |
| A value compared with a parent's | A step reads the parent, the next compares with its value |
| Two parts of a pattern meeting at one Node | Read both with `with`, compare in `output` |
| Ancestors, a sub-tree at any depth | One step per level with `id.in`, up to 8 |
| Sums, averages, groups | `all({ max })`, compute in `output` |
| Case-insensitive search, locale sorting | A normalized Property the Domain writes |

When no bounded read can answer, change the read or the product design and state the cost; do not
truncate silently.

## Errors

| Code | When |
| --- | --- |
| `NOT_FOUND` | A root `get` found nothing |
| `NOT_READABLE` | `get` or `find` met a row the reader may not read |
| `INTEGRITY` | A relation's `get` found none, or a second row came where one is allowed |
| `TOO_MANY` | Past a `max`, a verb bound, the recipe's rows or reads |
| `REFUSED` | The Kernel refused the read (`kernelCode`, `retryable`) |
| `INPUT_INVALID` | The SDK or the Kernel refused the built query before reading |
| `OUTDATED` | The Host's Registry does not match the Domain's build |
| `UNSUPPORTED` | The Kernel does not serve Query v7 |

A refusal the caller handles by code is a declared error the recipe raises from `output`; an
expected case is a union in the output, not an error.

## Legacy

Deprecated: V6 Query definitions (`Query.from`, `defineQuery<S>()((domain) => …)`,
`defineCollectionQuery`, `defineCompositeQuery`) and `graph.query(definition)`. A maintenance or
repair session serves no Query v7 and reads with V6 (`migration.md`); write every other read as a
recipe. `d.document(query)` reads one canonical v7 document whose rows are typed `unknown`: validate
them in `output`, and prefer handles.
