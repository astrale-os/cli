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
const edit = (field: string) =>
  method({
    auth: 'authenticated',
    input: {
      type: 'object',
      properties: { [field]: { type: 'string' } },
      required: [field],
      additionalProperties: false,
    },
    output: {
      type: 'object',
      properties: { [field]: { type: 'string' } },
      required: [field],
      additionalProperties: false,
    },
  })
const source = defineSchema('host.astrale.ai', {
  classes: {
    Manager: nodeClass({
      icon: classIcon.neutral,
      methods: { createInstance, edit: edit('slug') },
    }),
    Instance: nodeClass({
      icon: classIcon.neutral,
      methods: { inspectInstance, edit: edit('body') },
    }),
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

  test.each([
    [
      '/:host.astrale.ai:class.Instance:inspectInstance',
      'instance',
      '/:host.astrale.ai:class.Instance::host.astrale.ai:class.Instance.method.inspectInstance',
    ],
    [
      '/:host.astrale.ai:core.manager::host.astrale.ai:class.Manager.method.createInstance',
      'static',
      '/:host.astrale.ai:class.Manager:createInstance',
    ],
  ] as const)(
    'explains wrong dispatch for %s and suggests a resolvable schema Path',
    (path, dispatch, corrected) => {
      expect(() => describeCallableFromBundle(Path.parse(path), installed)).toThrow(
        expect.objectContaining({
          code: 'CALL_DISPATCH_MISMATCH',
          hint: expect.stringContaining(corrected),
        }),
      )
      expect(describeCallableFromBundle(Path.parse(corrected), installed)?.dispatch).toBe(dispatch)
    },
  )

  test.each(['class.Manager', 'core.manager'])(
    'describes the qualified Method owner independently of receiver %s',
    (receiver) => {
      const path = Path.parse(
        `/:host.astrale.ai:${receiver}::host.astrale.ai:class.Instance.method.edit`,
      )
      const described = describeCallableFromBundle(path, installed)
      expect(described).toMatchObject({
        path: path.raw,
        origin: 'host.astrale.ai',
        class: 'Instance',
        method: 'edit',
        dispatch: 'instance',
      })
      expect(described?.input).toMatchObject({ required: ['body'] })
      expect(described?.output).toMatchObject({ mode: 'value', schema: { required: ['body'] } })
    },
  )

  test('does not substitute a uniquely named Method from another Class when the qualified owner is absent', () => {
    expect(
      describeCallableFromBundle(
        Path.parse(
          '/:host.astrale.ai:core.manager::host.astrale.ai:class.Missing.method.inspectInstance',
        ),
        installed,
      ),
    ).toBeUndefined()
  })

  test('requires the Method namespace bundle rather than a same-name Class in the receiver namespace', () => {
    const path = Path.parse(
      '/:other.astrale.ai:class.Manager::host.astrale.ai:class.Instance.method.edit',
    )
    const wrongBundle = bundle.create(
      defineSchema('other.astrale.ai', {
        classes: {
          Manager: nodeClass({ icon: classIcon.neutral, methods: { edit: edit('foreign') } }),
        },
      }),
    )
    expect(describeCallableFromBundle(path, wrongBundle)).toBeUndefined()
    expect(describeCallableFromBundle(path, installed)?.input).toMatchObject({ required: ['body'] })
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
