import { describe, expect, test } from 'bun:test'

import { datasetModel } from '../model'
import { deskBundle, deskDataset, QUERIES } from './__tests__/desk'
import { candidatesOf, fill, valuesOf, whyWords } from './fill'
import { measure, spreadWords } from './measure'
import { bindingOf, type Question, slotsOf, titleOf } from './question'
import { ask, countMatched, FREE } from './run'
import { scaled } from './scale'
import { queryShape } from './shape'

const bundle = deskBundle()
const dataset = deskDataset()
const model = datasetModel(dataset, bundle)
const shape = queryShape(bundle, QUERIES.ticketsOfDesk)
const slots = slotsOf(bundle, QUERIES.ticketsOfDesk, shape)
const question = (values: Question['values'] = {}): Question => ({ query: 'desk.tickets', values })

describe('what a Query reads, as a tree', () => {
  test('each Class hangs under the step its relationship reaches it from', () => {
    expect(shape.roots.map((root) => root.ref.name)).toEqual(['Ticket'])
    expect(shape.steps.map((step) => [step.id, step.ref.name, step.via?.ref.name])).toEqual([
      ['0', 'Ticket', undefined],
      ['0.0', 'Desk', 'desk_holds_ticket'],
      ['0.1', 'Label', 'ticket_carries_label'],
      ['0.2', 'Agent', 'ticket_handled_by'],
    ])
    // the Ticket stands on the relationship's second end, the Desk on its first
    expect(shape.steps[1]!.via).toMatchObject({ from: 1, either: false })
    expect(shape.unplaced).toEqual([])
  })

  test('a Class reached through a Class reached hangs under it', () => {
    const staff = queryShape(bundle, QUERIES.deskStaff)
    expect(staff.steps.map((step) => [step.id, step.ref.name])).toEqual([
      ['0', 'Desk'],
      ['0.0', 'Agent'],
    ])
  })

  test('what the Schema does not declare is said, never placed', () => {
    const odd = queryShape(bundle, {
      ...QUERIES.labels,
      effects: [
        ...QUERIES.labels.effects!,
        { kind: 'read', class: 'Ghost', verb: 'via', file: 'q.ts', line: 2, role: 'traverse' },
      ],
    })
    expect(odd.steps).toHaveLength(1)
    expect(odd.unplaced).toEqual(['Ghost, which the Schema does not declare'])
  })
})

describe('a Query asked of a dataset', () => {
  test('unheld, it reaches every Node of its root and what each holds', () => {
    const answer = ask({ model, bundle, shape, binding: FREE })
    expect(answer.matched).toBe(5)
    expect(answer.rows.map((row) => row.path)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect([...answer.nodes].sort()).toEqual(
      ['ana', 'ben', 'billing', 'refund', 'support', 't1', 't2', 't3', 't4', 't5', 'urgent'].sort(),
    )
    expect(Object.fromEntries(answer.perStep)).toEqual({ '0': 5, '0.0': 2, '0.1': 2, '0.2': 2 })
    expect(answer.hidden).toBe(0)
    expect(answer.clipped).toBe(false)
  })

  test('held to a Desk, it keeps the Tickets that Desk holds', () => {
    const answer = ask({ model, bundle, shape, binding: { nodes: { '0.0': ['support'] } } })
    expect(answer.rows.map((row) => row.path)).toEqual(['t4', 't5'])
    expect([...answer.nodes].sort()).toEqual(['ana', 'support', 't4', 't5'])
    // every Edge followed is in the slice, by its place in the dataset
    expect([...answer.edges].sort((a, b) => a - b)).toEqual([3, 4, 10])
  })

  test('held to a value, it keeps the Nodes that carry it', () => {
    const answer = ask({
      model,
      bundle,
      shape,
      binding: { nodes: {}, values: [{ step: '0', property: 'status', equals: 'closed' }] },
    })
    expect(answer.rows.map((row) => row.path)).toEqual(['t3', 't5'])
  })

  test('what the identity may not read is left out, and counted', () => {
    const answer = ask({
      model,
      bundle,
      shape,
      binding: FREE,
      readable: (path) => !['t2', 'support', 'ben'].includes(path),
    })
    expect(answer.rows.map((row) => row.path)).toEqual(['t1', 't3', 't4', 't5'])
    expect(answer.nodes.has('support')).toBe(false)
    // the Ticket and the Desk reached and withheld; Ben is only reached through that Ticket
    expect(answer.hidden).toBe(2)
  })

  test('a row lists what it holds under each step, by the Edge followed', () => {
    const [first] = ask({ model, bundle, shape, binding: { nodes: { '0': ['t2'] } } }).rows
    expect(first!.children.map((group) => [group.step, group.rows.map((row) => row.path)])).toEqual(
      [
        ['0.0', ['billing']],
        ['0.1', ['urgent', 'refund']],
        ['0.2', ['ben']],
      ],
    )
    expect(first!.children[0]!.rows[0]!.edge).toBe(1)
  })

  test('counting the matches agrees with asking', () => {
    for (const binding of [FREE, { nodes: { '0.0': ['billing'] } }, { nodes: { '0.2': ['ana'] } }])
      expect(countMatched({ model, bundle, shape, binding })).toBe(
        ask({ model, bundle, shape, binding }).matched,
      )
  })
})

describe('a question’s slots', () => {
  test('a Query whose input is not read is offered its root and what it holds', () => {
    expect(slots.map((slot) => [slot.id, slot.label, slot.offered, slot.applied])).toEqual([
      ['step:0', 'ticket', true, true],
      ['step:0.0', 'desk', true, true],
      ['step:0.1', 'label', true, true],
      ['step:0.2', 'agent', true, true],
    ])
  })

  test('a declared input gives its own slots, each held where the Query compares it', () => {
    const at = { file: 'queries.ts', line: 1 }
    const declared = slotsOf(
      bundle,
      {
        ...QUERIES.ticketsOfDesk,
        input: {
          form: 'fields',
          fields: [
            {
              name: 'desk',
              optional: false,
              type: 'NodeId',
              kind: 'node',
              read: true,
              uses: [{ kind: 'node', class: 'Desk', verb: 'in', ...at }],
              ...at,
            },
            {
              name: 'status',
              optional: true,
              type: "'open' | 'closed'",
              kind: 'value',
              literals: ['open', 'closed'],
              read: true,
              uses: [{ kind: 'property', class: 'Ticket', property: 'status', verb: 'eq', ...at }],
              ...at,
            },
            {
              name: 'cursor',
              optional: true,
              type: 'string',
              kind: 'value',
              read: true,
              uses: [],
              ...at,
            },
          ],
        },
      },
      shape,
    )
    expect(declared).toEqual([
      {
        id: 'desk',
        label: 'desk',
        optional: false,
        kind: 'node',
        step: '0.0',
        offered: false,
        applied: true,
      },
      {
        id: 'status',
        label: 'status',
        optional: true,
        kind: 'value',
        step: '0',
        property: 'status',
        options: ['open', 'closed'],
        offered: false,
        applied: true,
      },
      {
        id: 'cursor',
        label: 'cursor',
        optional: true,
        kind: 'value',
        offered: false,
        applied: false,
      },
    ])
    expect(
      bindingOf(declared, question({ desk: ['billing'], status: ['open'], cursor: ['x'] })),
    ).toEqual({
      nodes: { '0.0': ['billing'] },
      values: [{ step: '0', property: 'status', equals: 'open' }],
    })
  })

  test('a Node the Query holds by its id in a Property is held through that Property', () => {
    const at = { file: 'queries.ts', line: 1 }
    const [handler] = slotsOf(
      bundle,
      {
        ...QUERIES.ticketsOfDesk,
        input: {
          form: 'fields',
          fields: [
            {
              name: 'handlerId',
              optional: true,
              type: 'NodeId',
              kind: 'node',
              read: true,
              uses: [
                { kind: 'property', class: 'Ticket', property: 'handlerId', verb: 'eq', ...at },
              ],
              ...at,
            },
          ],
        },
      },
      shape,
    )
    expect(handler).toMatchObject({ kind: 'node', step: '0', property: 'handlerId', applied: true })
    expect(bindingOf([handler!], question({ handlerId: ['ana'] }))).toEqual({
      nodes: {},
      values: [{ step: '0', property: 'handlerId', equals: 'ana' }],
    })
  })

  test('a Query that takes nothing has no slot, and one whose input is unread is offered some', () => {
    expect(
      slotsOf(bundle, { ...QUERIES.labels, input: { form: 'none', fields: [] } }, shape),
    ).toEqual([])
    expect(
      slotsOf(
        bundle,
        { ...QUERIES.ticketsOfDesk, input: { form: 'unread', fields: [] } },
        shape,
      ).every((slot) => slot.offered),
    ).toBe(true)
  })

  test('a definition is titled by its name, in words', () => {
    expect(titleOf(QUERIES.ticketsOfDesk)).toBe('Tickets of desk')
    expect(titleOf({ id: 'desk.open-tickets' })).toBe('Open tickets')
  })
})

describe('filling a question', () => {
  const input = { model, bundle, shape, slots, question: question() }

  test('a small answer needs no pick', () => {
    expect(fill(input)).toEqual([])
  })

  test('a required slot takes the selection, else a Node the dataset names', () => {
    const required = slots.map((slot) =>
      slot.id === 'step:0.0' ? { ...slot, optional: false } : slot,
    )
    expect(fill({ ...input, slots: required })).toEqual([
      { slot: 'step:0.0', path: 'billing', why: { kind: 'named', variable: 'billing' } },
    ])
    expect(fill({ ...input, slots: required, selected: 'support' })).toEqual([
      { slot: 'step:0.0', path: 'support', why: { kind: 'selected' } },
    ])
  })

  test('a slot’s candidates say what asking with each gives, the fullest first', () => {
    const candidates = candidatesOf(input, slots[1]!)
    expect(candidates.map((candidate) => [candidate.path, candidate.gives?.matched])).toEqual([
      ['billing', 3],
      ['support', 2],
    ])
    expect(candidates[0]!.variables).toEqual(['billing'])
  })

  test('a pick says why in words', () => {
    expect(whyWords({ kind: 'named', variable: 'billing' })).toBe('named billing in the dataset')
    expect(whyWords({ kind: 'richest', nodes: 9, classes: 4 })).toBe(
      'the fullest answer: 9 Nodes of 4 kinds',
    )
  })
})

describe('a dataset measured against its Schema', () => {
  const measured = measure(model, bundle)

  test('counts each Class and each relationship', () => {
    expect(measured.nodes).toBe(12)
    expect(measured.edges).toBe(14)
    expect(measured.classes.get('class.Ticket')?.nodes).toBe(5)
    expect(measured.relations.get('class.desk_holds_ticket')?.edges).toBe(5)
  })

  test('measures the links a Node has at each end against what the end declares', () => {
    const [desk, ticket] = measured.relations.get('class.desk_holds_ticket')!.ends!
    expect(desk).toMatchObject({ name: 'desk', nodes: 2, min: 2, median: 2, max: 3 })
    expect(ticket).toMatchObject({ name: 'ticket', nodes: 5, min: 1, max: 1, below: 0, above: 0 })
    expect(spreadWords(desk)).toBe('2 to 3, mostly 2')
    expect(spreadWords(ticket)).toBe('1 each')
    expect(measured.breaches).toBe(0)
  })

  test('counts the Nodes that break an end', () => {
    const orphaned = datasetModel({ ...dataset, edges: dataset.edges.slice(1) }, bundle)
    const [, ticket] = measure(orphaned, bundle).relations.get('class.desk_holds_ticket')!.ends!
    expect(ticket.below).toBe(1)
    expect(measure(orphaned, bundle).breaches).toBe(1)
  })
})

describe('a dataset laid down several times', () => {
  const grown = scaled(dataset, bundle, 10)

  test('keeps its identities once and lays every other Node down per copy', () => {
    expect(scaled(dataset, bundle, 1)).toBe(dataset)
    expect(grown.nodes).toHaveLength(3 + 9 * 10)
    expect(grown.nodes.filter((node) => node.className === 'Agent')).toHaveLength(3)
    expect(grown.nodes.find((node) => node.path === 't1~2')?.data.name).toBe('Card declined · 2')
    expect(grown.variables).toEqual(dataset.variables)
  })

  test('keeps every Edge of every copy, its ends in the copy or among the identities', () => {
    expect(grown.edges).toHaveLength(dataset.edges.length * 10)
    const paths = new Set(grown.nodes.map((node) => node.path))
    expect(grown.edges.every((edge) => paths.has(edge.from) && paths.has(edge.to))).toBe(true)
    const measured = measure(datasetModel(grown, bundle), bundle)
    expect(measured.classes.get('class.Ticket')?.nodes).toBe(50)
    // the end that takes exactly one still does, in every copy
    expect(measured.relations.get('class.desk_holds_ticket')!.ends![1]).toMatchObject({
      below: 0,
      above: 0,
    })
  })

  test('lays the same dataset down again for the same seed, and deals links differently for another', () => {
    expect(scaled(dataset, bundle, 10)).toBe(grown)
    const again = scaled({ ...dataset }, bundle, 10)
    expect(again.edges).toEqual(grown.edges)
    expect(scaled({ ...dataset }, bundle, 10, 99).edges).not.toEqual(grown.edges)
  })

  test('a large unheld answer is held by the pick that makes it readable', () => {
    const large = datasetModel(scaled(dataset, bundle, 40), bundle)
    const picks = fill({ model: large, bundle, shape, slots, question: question() })
    expect(picks).toHaveLength(1)
    const held = ask({
      model: large,
      bundle,
      shape,
      binding: bindingOf(slots, question({ [picks[0]!.slot]: [picks[0]!.path] })),
    })
    expect(held.nodes.size).toBeLessThan(120)
    expect(held.matched).toBeGreaterThan(0)
  })
})

describe('the values a value slot can take', () => {
  const at = { file: 'queries.ts', line: 1 }
  const status = slotsOf(
    bundle,
    {
      ...QUERIES.ticketsOfDesk,
      input: {
        form: 'fields',
        fields: [
          {
            name: 'status',
            optional: true,
            type: 'string',
            kind: 'value',
            read: true,
            uses: [{ kind: 'property', class: 'Ticket', property: 'status', verb: 'eq', ...at }],
            ...at,
          },
        ],
      },
    },
    shape,
  )[0]!
  const input = { model, bundle, shape, slots: [status], question: question() }

  test('are the ones the dataset holds for its Property, the most carried first', () => {
    expect(valuesOf(input, status)).toEqual([
      { value: 'open', nodes: 3 },
      { value: 'closed', nodes: 2 },
    ])
  })

  test('leave out what the identity may not read, and keep a declared choice the dataset has none of', () => {
    expect(
      valuesOf(
        { ...input, readable: (path) => path !== 't1' },
        { ...status, options: ['open', 'snoozed'] },
      ),
    ).toEqual([
      { value: 'closed', nodes: 2 },
      { value: 'open', nodes: 2 },
      { value: 'snoozed', nodes: 0 },
    ])
  })
})
