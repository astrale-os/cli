import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'

import { describeCallableFromSchema } from '../call-describe'

const schema = {
  classes: {
    Manager: {
      methods: {
        createInstance: {
          auth: 'authorized',
          description: 'Create one child Instance.',
          input: { type: 'object', required: ['operationId', 'slug'] },
          output: { mode: 'value' },
        },
      },
    },
  },
  functions: {
    journal: {
      description: 'Read the authorized Kernel journal.',
      input: { type: 'object' },
    },
  },
}

describe('describeCallableFromSchema', () => {
  test('reads a static Class method from the Domain schema', () => {
    const described = describeCallableFromSchema(
      Path.parse('/:host.astrale.ai:class.Manager:createInstance'),
      schema,
    )
    expect(described).toMatchObject({
      origin: 'host.astrale.ai',
      class: 'Manager',
      method: 'createInstance',
      dispatch: 'static',
      description: 'Create one child Instance.',
      auth: 'authorized',
    })
    expect(described?.input).toMatchObject({ required: ['operationId', 'slug'] })
  })

  test('finds an instance method when the receiver Path is not a Class projection', () => {
    expect(
      describeCallableFromSchema(
        Path.parse('/:host.astrale.ai:core.manager::createInstance'),
        schema,
      ),
    ).toMatchObject({
      origin: 'host.astrale.ai',
      class: 'Manager',
      method: 'createInstance',
      dispatch: 'instance',
    })
  })

  test('reads a standalone Function from the Domain schema', () => {
    expect(
      describeCallableFromSchema(Path.parse('/:kernel.astrale.ai:function.journal'), schema),
    ).toMatchObject({
      origin: 'kernel.astrale.ai',
      function: 'journal',
      description: 'Read the authorized Kernel journal.',
    })
  })
})
