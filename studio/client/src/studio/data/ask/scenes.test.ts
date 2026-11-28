import { describe, expect, test } from 'bun:test'

import { datasetModel, sliceModel } from '../model'
import { deskBundle, deskDataset, QUERIES } from './__tests__/desk'
import { measure } from './measure'
import { ask } from './run'
import { measuredScene, sliceOf } from './scenes'
import { queryShape } from './shape'
import { useAsk } from './store'

const bundle = deskBundle()
const dataset = deskDataset()
const model = datasetModel(dataset, bundle)

describe('the dataset measured, on the map', () => {
  const scene = measuredScene(bundle, model, measure(model, bundle), 'desk')
  const node = (id: string) => scene.nodes.find((one) => one.id === id)!
  const link = (id: string) => scene.links.find((one) => one.id === id)!

  test('every Class says how many Nodes it holds, and none of the dataset is drawn Node by Node', () => {
    expect(scene.nodes.map((one) => one.kind).every((kind) => kind !== 'node')).toBe(true)
    expect(node('class.Ticket').badges).toEqual([
      expect.objectContaining({ label: '5 Nodes', tone: 'node' }),
    ])
    expect(node('class.Ticket').counts).toEqual([{ label: 'Nodes', value: 5 }])
    expect(node('class.Ticket').rows).toBeUndefined()
  })

  test('every relationship says its Edges, and each end what the dataset holds there', () => {
    const holds = link('class.desk_holds_ticket')
    expect(holds.label).toBe('desk_holds_ticket · 5')
    expect(holds.name).toBe('desk_holds_ticket')
    expect(holds.from.count).toBe('0..* · has 2–3')
    expect(holds.to.count).toBe('1 · has 1')
  })

  test('a Class the dataset holds none of stands quiet, and a broken end warns', () => {
    const emptied = datasetModel(
      {
        ...dataset,
        nodes: dataset.nodes.filter((one) => one.className !== 'Label'),
        edges: dataset.edges.filter((one) => one.edgeName !== 'ticket_carries_label').slice(1),
      },
      bundle,
    )
    const broken = measuredScene(bundle, emptied, measure(emptied, bundle), 'desk')
    const label = broken.nodes.find((one) => one.id === 'class.Label')!
    expect(label.absent).toBe(true)
    expect(label.badges?.[0]?.label).toBe('no Node')
    expect(broken.links.find((one) => one.id === 'class.desk_holds_ticket')!.tone).toBe('warning')
    expect(broken.links.find((one) => one.id === 'class.ticket_carries_label')!.dashed).toBe(true)
  })
})

describe('the slice an answer reached', () => {
  const shape = queryShape(bundle, QUERIES.ticketsOfDesk)
  const answer = ask({ model, bundle, shape, binding: { nodes: { '0.0': ['support'] } } })
  const slice = sliceOf(dataset, answer)

  test('holds the Nodes reached and the Edges followed, and the variables that still name one', () => {
    expect(slice.nodes.map((one) => one.path).sort()).toEqual(['ana', 'support', 't4', 't5'])
    expect(slice.edges).toEqual([
      { from: 'support', to: 't4', edgeName: 'desk_holds_ticket' },
      { from: 'support', to: 't5', edgeName: 'desk_holds_ticket' },
      { from: 't4', to: 'ana', edgeName: 'ticket_handled_by' },
    ])
    expect(slice.variables).toEqual({ ana: ['ana'] })
  })

  test('as a model, keeps every Node and Edge under the id the whole dataset gives it', () => {
    const part = sliceModel(model, answer.nodes, answer.edges, slice)
    expect(part.order.map((node) => node.id)).toEqual([
      'core.node.ana',
      'core.node.support',
      'core.node.t4',
      'core.node.t5',
    ])
    // the Edges followed are the dataset's 4th, 5th and 11th: they keep those places
    expect(part.edges.map((edge) => edge.id)).toEqual([
      'core.edge.3',
      'core.edge.4',
      'core.edge.10',
    ])
    expect(part.edgeAt.get(10)).toBe(model.edges[10])
    expect(part.edgeAt.get(0)).toBeUndefined()
    expect(part.outgoing.get('support')?.map((edge) => edge.to)).toEqual(['t4', 't5'])
    expect(part.classes.map((cls) => [cls.name, cls.nodes.length])).toEqual([
      ['Agent', 1],
      ['Desk', 1],
      ['Ticket', 2],
    ])
  })

  test('is one dataset per answer: the same slice again', () => {
    expect(sliceOf(dataset, answer)).toBe(slice)
  })
})

describe('what the reader asks, kept per dataset', () => {
  const scope = 'desk|test'
  const view = () => useAsk.getState().views[scope]!

  test('a Query opens with its slots free, and is filled once', () => {
    useAsk.getState().open(scope, 'desk.tickets')
    expect(view()).toMatchObject({ query: 'desk.tickets', values: {}, picked: {} })
    useAsk
      .getState()
      .applyPicks(scope, 'desk.tickets', [
        { slot: 'desk', path: 'billing', why: { kind: 'named', variable: 'billing' } },
      ])
    expect(view()).toMatchObject({
      filled: 'desk.tickets',
      values: { desk: ['billing'] },
      picked: { desk: { kind: 'named', variable: 'billing' } },
    })
  })

  test('what the reader sets is no pick, and freeing a slot forgets its value', () => {
    useAsk.getState().setValue(scope, 'desk', ['support'])
    expect(view().values).toEqual({ desk: ['support'] })
    expect(view().picked).toEqual({})
    useAsk.getState().setValue(scope, 'desk', undefined)
    expect(view().values).toEqual({})
  })

  test('another reader keeps what the reader set, lets go of the picks, and is filled again', () => {
    useAsk.getState().setValue(scope, 'label', ['urgent'])
    useAsk
      .getState()
      .applyPicks(scope, 'desk.tickets', [
        { slot: 'desk', path: 'billing', why: { kind: 'selected' } },
      ])
    useAsk.getState().setAs(scope, 'ana')
    expect(view()).toMatchObject({ as: 'ana', values: { label: ['urgent'] }, picked: {} })
    expect(view().filled).toBeUndefined()
  })

  test('the Node selected when another Query opens is carried to it', () => {
    useAsk.getState().select(scope, 'core.node.t2')
    useAsk.getState().open(scope, 'desk.staff')
    expect(view()).toMatchObject({ query: 'desk.staff', carried: 't2', as: 'ana' })
    expect(view().selected).toBeUndefined()
  })

  test('picks made for a Query since closed are dropped', () => {
    useAsk
      .getState()
      .applyPicks(scope, 'desk.tickets', [
        { slot: 'desk', path: 'billing', why: { kind: 'selected' } },
      ])
    expect(view().values).toEqual({})
  })
})
