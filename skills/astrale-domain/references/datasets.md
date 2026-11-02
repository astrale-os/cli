# Demo datasets

Read when authoring or updating the Datasets a Domain ships under `tests/`.

A Dataset is a readable example graph for Studio: not a production seed, not a runtime test. Its
Policy evaluation proves neither credentials nor installed callable authority.

```ts
import { defineDataset } from '@astrale-os/sdk/testing'
import { schema } from '#schema'

export default defineDataset(schema, {
  id: 'demo',
  title: 'Website launch',
  graph({ classes: { Project, Task, task_in_project }, node, edge }) {
    const launch = node(Project, { id: 'website-launch', props: { name: 'Website launch' } })
    const review = node(Task, { id: 'review-copy', props: { name: 'Review landing page copy' } })
    edge(task_in_project, review, launch)
    return { launch, review }
  },
})
```

```text
defineDataset(schema, { id, title?, description?, graph })                from '@astrale-os/sdk/testing'
graph({ domain, classes, node, edge, ref }) => { name: node, … }          returned nodes = named variables
node(Class, { id?, props? })      id: stable within the Dataset, never a Kernel-assigned id
edge(EdgeClass, source, target, { slug?, props? })    endpoints: Dataset nodes (value or id)
ref(domain.core.nodes.inbox)      a local or direct-dependency Core/Class/Function/Policy/View node
astrale.config.ts                 tests: tests({ datasets: [dataset('./tests/datasets/demo.ts')] })
```

- `props` carries every required Property, inherited ones included.
- `ref(...)` keeps the referenced node's identity, resolved from the Schema (never fetched from an
  installation); copying its Properties into `node(...)` does not.
- Build and deploy never import a Dataset or install its facts.
- Admission checks Properties, concrete Classes, endpoint compatibility and duplicate ids. It does
  not prove business dates, lifecycle eligibility or live cardinality.
- Verify extraction with the project's SDK; inspect Studio's Tests tab after changing a demo.

## Content

- One small coherent story in the product's language; one example per idea. A record earns its
  place by explaining a relationship, a lifecycle or an access rule. Unrelated stories are separate
  Datasets; no node-count target.
- Show the relevant active and terminal states, and optional relationships both present and absent.
- A card shows only name and Class: the name says what and which one (*Review landing page copy*,
  not *Task 1*).
- Cover the Classes, Edges and states the story needs, not an exhaustive matrix. No foreign-id
  Property for a relationship an Edge owns.

## Policies

For each demonstrated Policy, one pair that passes and one near miss that fails for its own reason:

| Policy shape | Pairs |
| --- | --- |
| `anyOf` | One passing pair per branch |
| `allOf`, `exists` | One proof, one with a single condition missing |
| `repeat { min, max }` | Chains of `min`, `max` and `max + 1` |

Subjects are `Identity` descendants. Include an outsider when relevant, and a concrete descendant
to illustrate polymorphic access.
