import { describe, expect, test } from 'bun:test'

import type { JudgedStep } from '../scenarios'

import { datasetModel } from '../model'
import { declaredBy } from '../scenarios'
import { deskBundle, deskDataset } from './__tests__/desk'
import { callablesOf, callSlice, pickTarget, stepOf, targetsOf } from './call'

const bundle = deskBundle()
const model = datasetModel(deskDataset(), bundle)
const callables = callablesOf(bundle)
const assign = callables.find((one) => one.key === 'Ticket.assign')!
const open = callables.find((one) => one.key === 'Desk.open')!

/** A step judged as far as a slice reads it: who acts, and what the function is declared to write. */
const judged = (fn: string, on: string | undefined, actor: string): JudgedStep => {
  const declared = declaredBy(bundle, model, fn)
  return {
    step: stepOf({ fn, as: actor, ...(on === undefined ? {} : { on }) }),
    number: 1,
    ask: '',
    standing: 'unknown',
    answer: '',
    facts: { actor, nodes: on === undefined ? [] : [on], edges: [] },
    ...(declared ? { declared } : {}),
  }
}

describe('the Domain’s functions, as calls', () => {
  test('are keyed as handlers key them, a static one called on no Node', () => {
    expect(callables.map((one) => [one.key, one.owner, one.static])).toEqual([
      ['Desk.open', 'Desk', true],
      ['Ticket.assign', 'Ticket', false],
    ])
    expect(assign.target).toBe('function.Ticket.assign')
  })

  test('a call is the step a Scenario would keep', () => {
    expect(stepOf({ fn: 'Ticket.assign', on: 't1', as: 'ana' })).toEqual({
      id: 'ask',
      as: 'ana',
      expect: 'allowed',
      does: 'call',
      fn: 'Ticket.assign',
      on: { node: 't1' },
    })
    expect(stepOf({ fn: 'Desk.open', as: 'ana' })).not.toHaveProperty('on')
  })
})

describe('the Node a Method is asked on', () => {
  const tickets = targetsOf(model, bundle, assign)

  test('is one of its Class; a static one takes none', () => {
    expect(tickets).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(targetsOf(model, bundle, open)).toEqual([])
    expect(pickTarget(model, [])).toBeUndefined()
  })

  test('is one of the Classes the rules say offer the function, when they are read', () => {
    const offers = (cls: { name: string }) => (cls.name === 'Desk' ? ['Ticket.assign'] : [])
    expect(targetsOf(model, bundle, assign, offers)).toEqual(['billing', 'support'])
  })

  test('is the one selected when the Method takes it, else one the dataset names', () => {
    expect(pickTarget(model, tickets, 't4')).toEqual({ path: 't4', why: { kind: 'selected' } })
    // a Desk is selected: the Method takes no Desk
    expect(pickTarget(model, tickets, 'billing')).toEqual({
      path: 't1',
      why: { kind: 'named', variable: 'declined' },
    })
  })

  test('is, with none named, the one with most links', () => {
    expect(pickTarget(model, ['t3', 't2', 't5'])).toEqual({
      path: 't2',
      why: { kind: 'linked', edges: 4 },
    })
  })
})

describe('what a call concerns of the dataset', () => {
  test('the Node, who calls, and the Node’s links of the relationships the function writes', () => {
    const slice = callSlice(model, judged('Ticket.assign', 't2', 'ana'), {
      fn: 'Ticket.assign',
      on: 't2',
      as: 'ana',
    })
    // t2 is handled by Ben: the link the call would write again is what it stands on today
    expect([...slice.nodes].sort()).toEqual(['ana', 'ben', 't2'])
    expect([...slice.edges]).toEqual([9])
  })

  test('a static call concerns who calls alone', () => {
    const slice = callSlice(model, judged('Desk.open', undefined, 'ana'), {
      fn: 'Desk.open',
      as: 'ana',
    })
    expect([...slice.nodes]).toEqual(['ana'])
    expect(slice.edges.size).toBe(0)
  })
})
