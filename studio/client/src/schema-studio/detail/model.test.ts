import type { IrMethod } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import { bundle, classRef, nodeClass } from '../__tests__/fixture'
import { memberLists } from './model'

const method = (name: string): IrMethod => ({
  name,
  input: { type: 'object', properties: {} },
  output: { mode: 'value', schema: { type: 'boolean' } },
  static: false,
  inheritance: 'default',
})

describe('member lists', () => {
  const kernel = classRef('kernel.astrale.ai', 'Identity')
  const fixture = bundle({
    Document: nodeClass('Document', {
      properties: { reference: { type: 'string' }, issuedOn: { type: 'string' } },
      required: ['reference'],
      methods: { archive: method('archive'), settle: method('settle') },
    }),
    Invoice: nodeClass('Invoice', {
      extendsRefs: [classRef('local.example.dev', 'Document'), kernel],
      properties: { total: { type: 'number' }, paid: { type: 'boolean' } },
      required: ['total'],
      methods: { settle: method('settle') },
    }),
  })
  fixture.ir!.importedClassesByKey = {
    'kernel.astrale.ai:class.Identity': nodeClass('Identity', {
      origin: kernel.origin,
      ref: kernel,
      properties: { sub: { type: 'string' } },
      required: ['sub'],
      methods: { whoami: method('whoami') },
    }),
  }

  test("the Class's own members come first, then each base's, nearest first", () => {
    const lists = memberLists(fixture, 'Invoice', fixture.ir!.classes.Invoice!, true)
    expect(lists.properties.map((p) => [p.owner?.name ?? '', p.name, p.optional])).toEqual([
      ['', 'total', false],
      ['', 'paid', true],
      ['Document', 'reference', false],
      ['Document', 'issuedOn', true],
      ['Identity', 'sub', false],
    ])
    expect(lists.methods.map((m) => [m.owner?.name ?? '', m.name, m.overridden])).toEqual([
      ['', 'settle', false],
      ['Document', 'archive', false],
      // the base's version of a method this Class re-declares is listed, and says so
      ['Document', 'settle', true],
      ['Identity', 'whoami', false],
    ])
  })

  test('an inherited member is anchored under the Class that declares it', () => {
    const lists = memberLists(fixture, 'Invoice', fixture.ir!.classes.Invoice!, true)
    const fromDocument = lists.properties.find((p) => p.name === 'reference')!.owner!
    expect(fromDocument).toMatchObject({ refBase: 'class.Document', local: true, tier: 'local' })
    const fromKernel = lists.methods.find((m) => m.name === 'whoami')!.owner!
    expect(fromKernel).toMatchObject({
      refBase: 'class.kernel.astrale.ai:class.Identity',
      local: false,
      tier: 'kernel',
      origin: 'kernel.astrale.ai',
    })
  })

  test('an imported or edge member lists only what it declares', () => {
    const lists = memberLists(fixture, 'Invoice', fixture.ir!.classes.Invoice!, false)
    expect(lists.properties.map((p) => p.name)).toEqual(['total', 'paid'])
    expect(lists.methods.map((m) => m.name)).toEqual(['settle'])
  })
})
