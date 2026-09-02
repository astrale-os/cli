# Demo datasets

Read when authoring or updating the Datasets a Domain ships under `tests/`.

A Dataset under `tests/` is the domain shown by example: the Studio draws it, policies are proven on
it. Guidelines, not rules.

## Story

- One organisation, one period, a few people.
- One example per idea. Do not repeat a fact that teaches nothing new.
- Show the particular cases: archived beside active, optional edge present and absent, a chain of
  three hops.
- 15 to 40 nodes. Add a `mini` Dataset of 5 to 10 nodes.

## Names

- Use the user's language and world: *Boulangerie Martin*, *Jeanne Dupont*, *Agent de production*,
  *MAD1001*. Never *Member 1*, *User A*.
- A card shows only name and class. The name says what the object is and which one:
  *Facture 2026-03 · MAD1001*, not *Bill 1*.
- Readable ids for what people and tests will name.

## Policies

- Per policy: one pair that passes, one near miss that fails for the policy's own reason.
- `anyOf`: one pair per branch. `allOf` / `exists`: one proof, one with a single condition missing.
  `repeat { min, max }`: chains of `min`, `max`, `max + 1`.
- Subjects are `Identity` descendants. Keep one outsider with no edges.

## Schema

Every concrete class and edge once. Every state value. Each
edge end at its minimum and maximum. Mirror properties agree with their edge.

## Code

```ts
export default defineDataset(schema, {
  id: 'demo',
  title: 'Groupement Circus',
  description: 'Une agence, trois membres, un mois facturé et payé.',
  graph({ classes: { Agency, Member, member_belongs_to_agency }, node, edge }) {
    const stamped = { createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z' }
    const circus = node(Agency, { id: 'circus', props: { name: 'Groupement Circus', ...stamped, status: 'ACTIVE' } })
    const lyon = node(Member, { id: 'lyon', props: { name: 'Circus Lyon', agencyId: circus.id, ...stamped, status: 'ACTIVE' } })
    edge(member_belongs_to_agency, lyon, circus)
    return { circus, lyon }
  },
})
```

- Admission checks required properties, inherited ones included (`name`, `createdAt`, `updatedAt`),
  value schemas, endpoint classes, duplicate ids. It does not check cardinality, mirrors or dates.
- Edge ends must be Dataset nodes. Core reference data is authored again under the same slug.
- Return the entry points as `variables`.
- Check in the Studio Tests tab: cards name themselves, each policy has a green and a red pair.
