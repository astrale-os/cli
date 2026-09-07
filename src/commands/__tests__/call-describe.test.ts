import { Path } from '@astrale-os/sdk/graph/path'
import { bundle, classIcon, defineSchema, func, method, nodeClass } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { describeCallableFromBundle } from '../call-describe'

const createInstance = method({
  auth: 'authenticated',
  description: 'Create one child Instance.',
  input: {
    type: 'object',
    properties: { operationId: { type: 'string' }, slug: { type: 'string' } },
    required: ['operationId', 'slug'],
    additionalProperties: false,
  },
  output: { type: 'object', additionalProperties: true },
  static: true,
})
const inspectInstance = method({
  auth: 'authenticated',
  description: 'Inspect one child Instance.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', additionalProperties: true },
})
const journal = func({
  auth: 'authenticated',
  description: 'Read the authorized Kernel journal.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', additionalProperties: true },
})
const source = defineSchema('host.astrale.ai', {
  classes: {
    Manager: nodeClass({ icon: classIcon.neutral, methods: { createInstance } }),
    Instance: nodeClass({ icon: classIcon.neutral, methods: { inspectInstance } }),
  },
  functions: { journal },
})
const installed = bundle.create(source)

describe('describeCallableFromBundle', () => {
  test('reads a static Class method from the resolved Domain', () => {
    const described = describeCallableFromBundle(
      Path.parse('/:host.astrale.ai:class.Manager:createInstance'),
      installed,
    )
    expect(described).toMatchObject({
      origin: 'host.astrale.ai',
      class: 'Manager',
      method: 'createInstance',
      dispatch: 'static',
      description: 'Create one child Instance.',
      auth: 'authenticated',
    })
    expect(described?.input).toMatchObject({ required: ['operationId', 'slug'] })
  })

  test('finds one instance method when the receiver Path is not a Class projection', () => {
    expect(
      describeCallableFromBundle(
        Path.parse('/:host.astrale.ai:core.manager::inspectInstance'),
        installed,
      ),
    ).toMatchObject({
      origin: 'host.astrale.ai',
      class: 'Instance',
      method: 'inspectInstance',
      dispatch: 'instance',
    })
  })

  test('reads a standalone Function from the resolved Domain', () => {
    expect(
      describeCallableFromBundle(Path.parse('/:host.astrale.ai:function.journal'), installed),
    ).toMatchObject({
      origin: 'host.astrale.ai',
      function: 'journal',
      description: 'Read the authorized Kernel journal.',
    })
  })
})
