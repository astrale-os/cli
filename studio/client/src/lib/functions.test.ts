import type { IrClass, IrFunction, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildFunctionsModel, functionsForClass } from './functions'

const issue: IrClass = {
  type: 'node',
  name: 'Issue',
  origin: 'example.test',
  ref: { origin: 'example.test', kind: 'class', name: 'Issue' },
  properties: {},
  methods: {},
}

/** The V1 DSL's Node path value schema, accepting the given Definitions. */
function nodePath(...accepts: { origin: string; name: string }[]): JsonSchema {
  return {
    $ref: 'https://schemas.astrale.ai/graph/1/node-path',
    'x-astrale-path': {
      target: 'node',
      cardinality: 'one',
      accepts: accepts.map(({ origin, name }) => ({ origin, kind: 'class', name })),
    },
  }
}

function fn(input: Record<string, JsonSchema>, output?: JsonSchema): IrFunction {
  return {
    name: 'anonymous',
    input: { type: 'object', properties: input },
    output: { mode: 'value', schema: output ?? { type: 'string' } },
  }
}

function bundle(functions: Record<string, IrFunction>): StudioSchemaBundle {
  return {
    domainId: 'example',
    renderFingerprint: 'fixture',
    schemaMode: 'canonical-admitted',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: 'example.test',
      classes: { Issue: issue },
      importsByKey: {},
      importedClassesByKey: {},
      functions,
      views: {},
      policies: {},
      dependencies: [],
      core: {},
    },
    overlay: {
      handlerLinks: [
        {
          owner: 'example.test',
          ownerKind: 'function',
          kind: 'workflow',
          method: 'triage',
          static: false,
          implemented: true,
        },
      ],
      sourceSpans: {
        'function.triage': {
          file: 'schema/functions/triage.ts',
          startLine: 1,
          endLine: 4,
          doc: 'Route a new issue.',
        },
      },
    },
    extractedAt: '2026-09-21T00:00:00.000Z',
  } satisfies StudioSchemaBundle
}

test('a function is bound to the local classes its node paths accept', () => {
  const model = buildFunctionsModel(
    bundle({ triage: fn({ issue: nodePath({ origin: 'example.test', name: 'Issue' }) }) }),
  )

  expect(model.all).toHaveLength(1)
  expect(model.all[0]?.boundClasses).toEqual(['Issue'])
  expect(model.all[0]?.standalone).toBe(false)
  expect(functionsForClass(model, 'Issue').map((entry) => entry.name)).toEqual(['triage'])
})

test('the output and a list of references count as bindings too', () => {
  const model = buildFunctionsModel(
    bundle({
      triage: fn(
        { ids: { type: 'array', items: nodePath({ origin: 'example.test', name: 'Issue' }) } },
        nodePath({ origin: 'example.test', name: 'Issue' }),
      ),
    }),
  )

  expect(model.all[0]?.boundClasses).toEqual(['Issue'])
  // one Class named three times is still one binding
  expect(model.all[0]?.refs).toHaveLength(1)
})

test('a class from another domain is remembered, but is not a local binding', () => {
  const model = buildFunctionsModel(
    bundle({ triage: fn({ payment: nodePath({ origin: 'payments.test', name: 'Payment' }) }) }),
  )

  expect(model.all[0]?.refs.map((ref) => ref.origin)).toEqual(['payments.test'])
  expect(model.all[0]?.boundClasses).toEqual([])
  expect(model.standalone.map((entry) => entry.name)).toEqual(['triage'])
})

test('a function names no class when it works on none', () => {
  const model = buildFunctionsModel(bundle({ triage: fn({ query: { type: 'string' } }) }))

  expect(model.all[0]?.standalone).toBe(true)
  expect(model.byClass.size).toBe(0)
})

test('the handler link and the source span ride along with the contract', () => {
  const model = buildFunctionsModel(bundle({ triage: fn({}) }))

  expect(model.all[0]?.link?.kind).toBe('workflow')
  expect(model.all[0]?.contractOnly).toBe(false)
  expect(model.all[0]?.file).toBe('schema/functions/triage.ts')
  expect(model.all[0]?.doc).toBe('Route a new issue.')
})

test('a schema Studio could not compile yields no functions at all', () => {
  expect(buildFunctionsModel(undefined).all).toEqual([])
})
