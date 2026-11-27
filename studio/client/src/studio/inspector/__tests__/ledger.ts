import type {
  DefinitionEffect,
  DefinitionLink,
  HandlerLink,
  IrMethod,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import {
  bundle,
  classRef,
  edgeClass,
  nodeClass,
  nodePath,
} from '../../../schema-studio/__tests__/fixture'

/**
 * A small ledger Domain for the Inspector's view-models: a `Document` base with a state machine,
 * an `Invoice` that extends it and the Kernel's `Identity`, a `Customer` and a `Ledger`, and
 * relationships that name a Class itself, one of its bases, a union of Classes, or any Node.
 * Its overlay reads a function per kind of change: one that names the Class, one that names
 * its base, one that writes an event without the state it leaves, one no handler reaches.
 */

const local = (name: string) => classRef('local.example.dev', name)
const kernel = (name: string) => classRef('kernel.astrale.ai', name)

const method = (name: string, input: Partial<IrMethod> = {}): IrMethod => ({
  name,
  input: { type: 'object', properties: {} },
  output: { mode: 'value', schema: { type: 'boolean' } },
  static: false,
  abstract: false,
  executable: true,
  ...input,
})

const effect = (
  kind: DefinitionEffect['kind'],
  name: string,
  verb: string,
  line: number,
  rest: Partial<DefinitionEffect> = {},
): DefinitionEffect => ({ kind, class: name, verb, file: 'src/ledger.ts', line, ...rest })

const mutation = (
  id: string,
  effects: DefinitionEffect[],
  rest: Partial<DefinitionLink> = {},
): DefinitionLink => ({
  kind: 'mutation',
  id,
  file: 'src/ledger.ts',
  line: 1,
  classes: [...new Set(effects.map((each) => each.class))],
  effects,
  ...rest,
})

/** A Method's handler (`Class.method`), or a Domain function's (`fn`), which the Domain owns. */
const handler = (
  key: string,
  definitions: string[],
  rest: Partial<HandlerLink> = {},
): HandlerLink => {
  const dot = key.indexOf('.')
  return {
    owner: dot < 0 ? 'local.example.dev' : key.slice(0, dot),
    ownerKind: dot < 0 ? 'function' : 'class',
    kind: 'action',
    method: dot < 0 ? key : key.slice(dot + 1),
    static: dot < 0,
    implemented: true,
    definitions,
    ...rest,
  }
}

export function ledger(): StudioSchemaBundle {
  const value = bundle(
    {
      Document: nodeClass('Document', {
        extendsRefs: [kernel('Node')],
        properties: {
          reference: { type: 'string', description: 'The number printed on it.' },
          issuedOn: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['draft', 'issued', 'void'] },
        },
        required: ['reference'],
        propertyMetadata: {
          reference: { immutable: 'create' },
          issuedOn: { auto: { on: ['create'] } },
          status: {
            state: {
              initial: 'draft',
              transitions: {
                draft: { issue: 'issued', cancel: 'void' },
                issued: { cancel: 'void' },
              },
            },
          },
        },
        methods: { archive: method('archive', { abstract: true, executable: false }) },
      }),
      Invoice: nodeClass('Invoice', {
        extendsRefs: [local('Document'), kernel('Identity')],
        properties: { total: { type: 'number' }, payer: nodePath(local('Customer')) },
        required: ['total'],
        methods: { issue: method('issue'), cancel: method('cancel') },
      }),
      Customer: nodeClass('Customer', { properties: { name: { type: 'string' } } }),
      Ledger: nodeClass('Ledger'),
      Tag: nodeClass('Tag'),
      billed_to: {
        ...edgeClass('billed_to', [
          { name: 'invoice', types: ['Invoice'], cardinality: { min: 1, max: 1 } },
          { name: 'customer', types: ['Customer'] },
        ]),
        properties: { since: { type: 'string', format: 'date' } },
      },
      files: {
        ...edgeClass('files', [
          { name: 'ledger', types: ['Ledger'] },
          { name: 'document', types: ['Document'], cardinality: { min: 0, max: 1 } },
        ]),
        constraints: { acyclic: true },
      },
      holds: edgeClass('holds', [
        { name: 'holder', types: ['Customer', 'Ledger'] },
        { name: 'document', types: ['Document'] },
      ]),
      tagged: edgeClass('tagged', [
        { name: 'tag', types: ['Tag'] },
        { name: 'node', types: [], refs: [kernel('Node')] },
      ]),
    },
    {
      overlay: {
        handlerLinks: [
          handler('createInvoice', ['invoice.create'], {
            calls: ['Invoice.issue'],
            integrations: ['billing.charge'],
            handlerFile: 'src/create-invoice.ts',
            handlerLine: 3,
          }),
          handler('Invoice.issue', ['invoice.issue']),
          handler('Invoice.cancel', ['invoice.cancel'], { kind: 'workflow' }),
          handler('touchDocuments', ['document.touch']),
          handler('archiveDocuments', ['document.archive']),
          handler('listInvoices', ['invoice.list'], {
            integrationGaps: [
              { file: 'src/list.ts', line: 9, reason: 'a computed operation name' },
            ],
          }),
        ],
        definitions: [
          mutation('invoice.create', [
            effect('create', 'Invoice', 'createNode', 10),
            effect('create', 'billed_to', 'createEdge', 11),
          ]),
          mutation(
            'invoice.issue',
            [
              effect('expect', 'Invoice', 'expect.unchanged', 20),
              effect('transition', 'Invoice', 'transition', 21, {
                property: 'status',
                from: 'draft',
                event: 'issue',
                to: 'issued',
              }),
            ],
            {
              preconditions: [
                {
                  kind: 'node',
                  classes: ['Invoice'],
                  terms: [
                    { term: 'node', text: 'input.invoiceId' },
                    { term: 'equals', text: '{ status: "draft" }' },
                  ],
                  file: 'src/ledger.ts',
                  line: 19,
                },
                {
                  kind: 'none',
                  classes: ['Invoice'],
                  name: 'invoice-number-taken',
                  terms: [
                    {
                      term: 'range',
                      text: 'Invoice.where((invoice) => invoice.number.eq(input.number))',
                    },
                  ],
                  under: [
                    { kind: 'each', source: 'input.numbers', line: 18 },
                    { kind: 'unless', source: 'input.renumber', line: 19 },
                  ],
                  file: 'src/ledger.ts',
                  line: 20,
                },
              ],
            },
          ),
          mutation('invoice.cancel', [
            effect('transition', 'Invoice', 'transition', 30, {
              property: 'status',
              event: 'cancel',
            }),
          ]),
          mutation('document.touch', [effect('update', 'Document', 'updateNode', 40)]),
          mutation('document.archive', [
            effect('transition', 'Document', 'transition', 50, {
              property: 'status',
              from: 'issued',
              event: 'cancel',
              to: 'void',
            }),
          ]),
          mutation('invoice.purge', [effect('delete', 'Invoice', 'deleteNode', 60)]),
          mutation('invoice.rewrite', [], {
            gaps: [{ file: 'src/ledger.ts', line: 70, reason: 'a Class chosen at run time' }],
          }),
          {
            kind: 'query',
            id: 'invoice.list',
            file: 'src/ledger.ts',
            line: 80,
            classes: ['Invoice'],
            effects: [effect('read', 'Invoice', 'where', 81, { role: 'root' })],
          },
        ],
        integrations: [
          {
            key: 'billing',
            id: 'example.billing',
            operations: [
              { name: 'charge', replay: ['keyed'] },
              { name: 'refund', replay: ['unsafe'] },
            ],
          },
        ],
        sourceSpans: {},
      },
    },
  )
  value.ir!.functions = {
    createInvoice: {
      name: 'createInvoice',
      input: {
        type: 'object',
        properties: { customer: nodePath(local('Customer')), note: { type: 'string' } },
        required: ['customer'],
      },
      output: {
        mode: 'value',
        schema: { type: 'object', properties: { invoice: nodePath(local('Invoice')) } },
      },
    },
    touchDocuments: method('touchDocuments'),
    archiveDocuments: method('archiveDocuments'),
    listInvoices: method('listInvoices'),
  }
  value.ir!.importedClassesByKey = {
    'kernel.astrale.ai:class.Node': nodeClass('Node', {
      origin: 'kernel.astrale.ai',
      ref: kernel('Node'),
    }),
    'kernel.astrale.ai:class.Identity': nodeClass('Identity', {
      origin: 'kernel.astrale.ai',
      ref: kernel('Identity'),
      properties: { sub: { type: 'string' } },
      required: ['sub'],
    }),
  }
  return value
}

/** A sentence's words, its Classes by name. */
export const said = (phrases: readonly (string | { readonly text: string })[]) =>
  phrases.map((phrase) => (typeof phrase === 'string' ? phrase : phrase.text)).join('')
