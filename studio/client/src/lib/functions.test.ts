import type { IrFunction, JsonSchema } from '@shared/types'

import { expect, test } from 'bun:test'

import { bundle, classRef, nodeClass, nodePath } from '@/schema-studio/__tests__/fixture'

import { buildFunctionsModel, functionsForClass } from './functions'

const ISSUE = classRef('local.example.dev', 'Issue')

function model(input: Record<string, JsonSchema>, output: JsonSchema = { type: 'string' }) {
  const triage: IrFunction = {
    name: 'triage',
    input: { type: 'object', properties: input },
    output: { mode: 'value', schema: output },
  }
  const value = bundle({ Issue: nodeClass('Issue') })
  value.ir!.functions = { triage }
  value.overlay.handlerLinks = [
    {
      owner: 'local.example.dev',
      ownerKind: 'function',
      kind: 'workflow',
      method: 'triage',
      static: false,
      implemented: true,
    },
  ]
  value.overlay.sourceSpans['function.triage'] = {
    file: 'schema/functions/triage.ts',
    startLine: 1,
    endLine: 4,
    doc: 'Route a new issue.',
  }
  return buildFunctionsModel(value)
}

test('a function is bound to the local classes its node paths accept, input or output', () => {
  const bound = model({ ids: { type: 'array', items: nodePath(ISSUE) } }, nodePath(ISSUE))
  expect(bound.all[0]).toMatchObject({
    boundClasses: ['Issue'],
    standalone: false,
    file: 'schema/functions/triage.ts',
    doc: 'Route a new issue.',
    contractOnly: false,
  })
  // one Class named twice is still one binding
  expect(bound.all[0]?.refs).toHaveLength(1)
  expect(functionsForClass(bound, 'Issue').map((entry) => entry.name)).toEqual(['triage'])
})

test('a class from another domain is remembered, but leaves the function standalone', () => {
  const foreign = model({ payment: nodePath(classRef('payments.test', 'Payment')) })
  expect(foreign.all[0]?.refs.map((ref) => ref.origin)).toEqual(['payments.test'])
  expect(foreign.standalone.map((entry) => entry.name)).toEqual(['triage'])
  expect(model({ query: { type: 'string' } }).byClass.size).toBe(0)
  expect(buildFunctionsModel(undefined).all).toEqual([])
})
