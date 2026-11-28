import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { describe, expect, test } from 'bun:test'

import { publishedBehaviorBundle } from '../lenses/__tests__/behavior-fixture'
import { ledger, said } from './__tests__/ledger'
import {
  arrangeWrites,
  type Behavior,
  behaviorOf,
  changersOf,
  conditionWords,
  type EffectLine,
  mayChangersOf,
  preconditionsOf,
} from './behavior'
import { targetOf } from './target'

const of = <K extends Behavior['kind']>(bundle: StudioSchemaBundle, id: string, kind: K) => {
  const behavior = behaviorOf(bundle, targetOf(bundle, id))
  if (behavior?.kind !== kind) throw new Error(`${id} reads as ${behavior?.kind}`)
  return behavior as Extract<Behavior, { kind: K }>
}

const keys = (links: readonly { readonly key: string }[]) => links.map((each) => each.key)

describe('what changes a Class', () => {
  test('by verb: functions naming it make the change, those naming a base may', () => {
    const invoice = of(ledger(), 'class.Invoice', 'class')
    expect(
      invoice.groups.map((group) => [
        group.verb,
        group.label,
        keys(group.by.map((each) => each.fn)),
        keys(group.may.map((each) => each.fn)),
      ]),
    ).toEqual([
      ['create', 'Create an Invoice', ['createInvoice'], []],
      ['update', 'Update an Invoice', [], ['touchDocuments']],
      [
        'transition',
        'Move an Invoice’s state',
        ['Invoice.cancel', 'Invoice.issue'],
        ['archiveDocuments'],
      ],
      // `createInvoice` creates the Invoice with its `billed_to` Edge: that end is the create's,
      // no link (the canvas draws the same).
    ])
    const update = invoice.groups.find((group) => group.verb === 'update')!
    expect(update.may[0]).toMatchObject({
      definitions: [{ id: 'document.touch', target: 'mutation.document.touch' }],
      through: { target: 'class.Document' },
    })
    expect(changersOf(invoice)).toBe(3)
    expect(mayChangersOf(invoice)).toBe(2)
  })

  test('what no handler reaches, what only reads it, and what the reading cannot tell', () => {
    const invoice = of(ledger(), 'class.Invoice', 'class')
    expect(invoice.unreached.map((each) => each.id)).toEqual(['invoice.purge'])
    // Invoice.issue expects the Invoice unchanged, but it changes it: it is no mere reader
    expect(keys(invoice.readers)).toEqual(['listInvoices'])
    expect(invoice.untold.map((each) => each.id)).toEqual(['invoice.rewrite'])
  })

  test('a relationship’s end that accepts the Class alone links it', () => {
    const customer = of(ledger(), 'class.Customer', 'class')
    expect(customer.groups.map((group) => [group.verb, keys(group.by.map((by) => by.fn))])).toEqual(
      [['link', ['createInvoice']]],
    )
    const link = customer.groups.find((group) => group.verb === 'link')!
    expect(link.by[0]!.relationships.map((each) => each.name)).toEqual(['billed_to'])
    expect(keys(customer.functions)).toEqual(['createInvoice'])
  })

  test('its Methods: its own, then each base’s contracts with the Class that declares them', () => {
    const invoice = of(ledger(), 'class.Invoice', 'class')
    expect(
      invoice.methods.map((line) => [line.fn.key, line.from?.name, line.abstract, line.open]),
    ).toEqual([
      ['Invoice.issue', undefined, false, true],
      ['Invoice.cancel', undefined, false, true],
      ['Document.archive', 'Document', true, true],
    ])
  })
})

describe('a lifecycle', () => {
  test('each declared step with what makes it; a move that writes only its event is said once', () => {
    const [status] = of(ledger(), 'class.Invoice', 'class').lifecycles
    expect(status).toMatchObject({ property: 'status', initial: 'draft' })
    expect(status!.states).toEqual(['draft', 'issued', 'void'])
    expect(
      status!.steps.map((step) => [
        `${step.from} -${step.event}-> ${step.to}`,
        keys(step.by),
        step.base.map((each) => [each.fn.key, each.through.name]),
        keys(step.may),
      ]),
    ).toEqual([
      ['draft -issue-> issued', ['Invoice.issue'], [], []],
      ['draft -cancel-> void', [], [], ['Invoice.cancel']],
      // archiveDocuments writes the state it leaves: it bears on this step alone
      ['issued -cancel-> void', [], [['archiveDocuments', 'Document']], ['Invoice.cancel']],
    ])
    expect(status!.loose).toEqual([
      {
        by: [{ target: 'function.Invoice.cancel', key: 'Invoice.cancel', kind: 'workflow' }],
        events: ['cancel'],
        reason: 'event',
      },
    ])
    expect(status!.untold).toEqual([])
  })

  test('a move whose event the reading cannot tell is untold', () => {
    const bundle = ledger()
    const cancel = bundle.overlay.definitions.find((each) => each.id === 'invoice.cancel')!
    delete cancel.effects![0]!.event
    const [status] = of(bundle, 'class.Invoice', 'class').lifecycles
    expect(keys(status!.untold)).toEqual(['Invoice.cancel'])
    expect(status!.loose).toEqual([])
  })
})

describe('a function', () => {
  test('what it takes and returns, in words', () => {
    const fn = of(ledger(), 'function.createInvoice', 'function')
    expect(fn).toMatchObject({ flavor: 'action', implemented: true, static: true, abstract: false })
    expect(fn.on.map((each) => each.name)).toEqual(['Customer'])
    expect(fn.input).toEqual([
      {
        name: 'customer',
        type: 'Reference to Customer',
        kind: 'reference',
        refs: [{ target: 'class.Customer', name: 'Customer', open: true }],
        required: true,
      },
      { name: 'note', type: 'Text', kind: 'text', required: false },
    ])
    expect(fn.output).toEqual({
      type: 'Object with invoice',
      kind: 'object',
      fields: [
        {
          name: 'invoice',
          type: 'Reference to Invoice',
          kind: 'reference',
          // Invoice extends Kernel Identity: the link says so, for the glyph it wears
          refs: [{ target: 'class.Invoice', name: 'Invoice', open: true, identity: true }],
          required: false,
        },
      ],
    })
    expect(fn.source).toEqual({ file: 'src/create-invoice.ts', line: 3 })
  })

  test('what it changes, reaches outside and calls', () => {
    const fn = of(ledger(), 'function.createInvoice', 'function')
    expect(
      fn.changes.map((step) => [
        step.definition.id,
        step.effects.map((effect) => [said(effect.words), effect.relationship?.name, effect.line]),
      ]),
    ).toEqual([
      [
        'invoice.create',
        [
          ['creates an Invoice', undefined, 10],
          ['links an Invoice to a Customer', 'billed_to', 11],
        ],
      ],
    ])
    expect(fn.reaches).toEqual([
      {
        target: 'integration.billing',
        integration: 'billing',
        operation: 'charge',
        replay: ['keyed'],
        label: 'keyed',
        meaning: 'Another attempt takes effect once per key.',
      },
    ])
    expect(keys(fn.calls)).toEqual(['Invoice.issue'])
    expect(keys(of(ledger(), 'function.Invoice.issue', 'function').calledBy)).toEqual([
      'createInvoice',
    ])
  })

  test('a precondition is read apart from what it writes, its parts as the source writes them', () => {
    const issue = of(ledger(), 'function.Invoice.issue', 'function')
    expect(issue.changes[0]!.effects.map((effect) => said(effect.words))).toEqual([
      'transitions an Invoice from draft to issued on issue',
    ])
    expect(
      issue.preconditions.map((stated) => [
        stated.kind,
        stated.classes.map((one) => one.name),
        stated.terms.map((term) => `${term.term} ${term.text}`),
        stated.name,
        stated.mutations.map((one) => one.id),
      ]),
    ).toEqual([
      [
        'node',
        ['Invoice'],
        ['node input.invoiceId', 'equals { status: "draft" }'],
        undefined,
        ['invoice.issue'],
      ],
      [
        'none',
        ['Invoice'],
        ['range Invoice.where((invoice) => invoice.number.eq(input.number))'],
        'invoice-number-taken',
        ['invoice.issue'],
      ],
    ])
  })

  test('a precondition keeps the conditions it is stated under, outermost first, in words', () => {
    const [always, under] = of(ledger(), 'function.Invoice.issue', 'function').preconditions
    expect(always!.under).toBeUndefined()
    expect(
      under!.under?.map((condition) => {
        const said = conditionWords(condition)
        return [said.lead, said.source, said.trail]
      }),
    ).toEqual([
      ['Once for each of', 'input.numbers', undefined],
      ['Unless', 'input.renumber', undefined],
    ])
    expect(
      (['when', 'caught'] as const).map((kind) => {
        const said = conditionWords({ kind, source: 'input.force', line: 1 })
        return [said.lead, said.trail]
      }),
    ).toEqual([
      ['Only when', undefined],
      ['Only when', 'throws'],
    ])
  })

  test('a precondition several mutations reach is read once, with each', () => {
    const [stated] = of(ledger(), 'function.Invoice.issue', 'function').preconditions
    const step = (id: string) => ({
      definition: { target: `mutation.${id}`, id, kind: 'mutation' as const },
      effects: [],
      gaps: [],
      preconditions: [
        { ...stated!, mutations: [{ target: `mutation.${id}`, id, kind: 'mutation' as const }] },
      ],
    })
    expect(
      preconditionsOf([step('invoice.issue'), step('invoice.reissue')]).map((line) =>
        line.mutations.map((one) => one.id),
      ),
    ).toEqual([['invoice.issue', 'invoice.reissue']])
  })
})

describe('a mutation and an Integration', () => {
  test('a mutation: its effects, the Classes it names, who uses it', () => {
    const definition = of(ledger(), 'mutation.invoice.issue', 'definition')
    expect(definition.effects.map((effect) => effect.kind)).toEqual(['transition'])
    expect(definition.preconditions.map((stated) => stated.kind)).toEqual(['node', 'none'])
    expect(definition.names.map((each) => each.name)).toEqual(['Invoice'])
    expect(keys(definition.usedBy)).toEqual(['Invoice.issue'])
    expect(definition.source).toEqual({ file: 'src/ledger.ts', line: 1 })
  })

  test('an Integration: its operations, what another attempt may do, who reaches each', () => {
    const integration = of(ledger(), 'integration.billing', 'integration')
    expect(
      integration.operations.map((operation) => [
        operation.name,
        operation.label,
        keys(operation.users),
      ]),
    ).toEqual([
      ['charge', 'keyed', ['createInvoice']],
      ['refund', 'unsafe', []],
    ])
    expect(integration.operations[1]!.meaning).toBe(
      'Another attempt may repeat its effect. Code that may run more than once, such as a Step, cannot call it.',
    )
    expect(keys(integration.untold)).toEqual(['listInvoices'])
  })
})

describe('a Publication', () => {
  test('holds no handler source: its functions and Classes say so where effects would be listed', () => {
    const published = publishedBehaviorBundle()
    const assign = of(published, 'function.Host.assign', 'function')
    expect(assign.handlers).toBe(false)
    expect(assign.untold).toEqual([])
    const provision = of(published, 'function.provision', 'function')
    expect(provision.on.map((link) => link.target)).toEqual(['class.Fleet'])
    expect(of(published, 'class.Host', 'class').handlers).toBe(false)
    expect(of(ledger(), 'class.Invoice', 'class').handlers).toBe(true)
  })
})

describe('a mutation’s writes', () => {
  const link = (target: string) => ({ target, name: target.slice(target.indexOf('.') + 1) })
  const effect = (kind: EffectLine['kind'], line: number, more: Partial<EffectLine> = {}) =>
    ({ kind, words: [kind], file: 'm.ts', line, ...more }) as EffectLine

  test('read Node writes first, each relationship once, and the unlinks a deletion makes under it', () => {
    const blocks = link('class.blocks')
    const watches = link('class.watches')
    const arranged = arrangeWrites([
      effect('delete', 1, { relationship: blocks as never, selfRoles: ['blocker', 'blocked'] }),
      effect('delete', 2, { relationship: blocks as never, selfRoles: ['blocker', 'blocked'] }),
      effect('delete', 3, { relationship: watches as never }),
      effect('delete', 4),
      effect('create', 5, { relationship: watches as never }),
      effect('create', 6, { relationship: watches as never }),
      effect('delete', 7, {
        deletion: [
          { outcome: 'unlinked', lifetime: 'restrict', relationships: [watches as never] },
        ],
      }),
    ])
    expect(arranged.map((each) => each.line)).toEqual([4, 7, 1, 5])
    // a self relationship's two ends read as one row; two writes alike say how many
    expect(arranged[2]).toMatchObject({ times: 2, selfRoles: ['blocker', 'blocked'] })
    expect(arranged[3]).toMatchObject({ times: 2 })
  })
})
