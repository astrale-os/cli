import type { DomainBundle, DomainInfo } from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import {
  bundle,
  classIcon,
  defineSchema,
  func,
  method,
  nodeClass,
  schema,
} from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { describeCallableFromBundle, introspectCommand, parseIntrospectTarget } from '../introspect'

const object = { type: 'object', additionalProperties: true } as const
const edit = (field: string) => {
  const shape = {
    type: 'object',
    properties: { [field]: { type: 'string' } },
    required: [field],
    additionalProperties: false,
  } as const
  return method({ auth: 'authenticated', input: shape, output: shape })
}
const source = defineSchema('host.astrale.ai', {
  name: 'Test Domain',
  classes: {
    Manager: nodeClass({
      icon: classIcon.neutral,
      methods: {
        createInstance: method({
          auth: 'authenticated',
          description: 'Create one child Instance.',
          input: {
            type: 'object',
            properties: { operationId: { type: 'string' } },
            required: ['operationId'],
            additionalProperties: false,
          },
          output: object,
          static: true,
        }),
        edit: edit('slug'),
      },
    }),
    Instance: nodeClass({
      icon: classIcon.neutral,
      methods: {
        inspectInstance: method({ auth: 'authenticated', input: object, output: object }),
        edit: edit('body'),
      },
    }),
  },
  functions: {
    journal: func({
      auth: 'authenticated',
      description: 'Read the journal.',
      input: object,
      output: object,
    }),
  },
})
const installed = bundle.create(source)
const info = {
  origin: source.origin,
  revision: schema.revision(source),
  generation: 'sha256:generation',
  release: null,
  readiness: 'sha256:readiness',
  capabilities: { requested: {}, materialized: {} },
  bindings: { callables: [], views: [] },
} satisfies DomainInfo
const bundled = { domain: info, bundle: installed } satisfies DomainBundle
const describe_ = (
  path: string,
  from: Parameters<typeof describeCallableFromBundle>[1] = installed,
) => describeCallableFromBundle(Path.parse(path), from)

/** Run `introspect` against a Schema API that records each read. */
async function introspect(target: string, opts: { bundle?: boolean } = {}) {
  const calls: string[] = []
  let result: unknown
  const read = (kind: string) => async (origin: string) => {
    calls.push(`${kind}:${origin}`)
    return kind === 'inspect' ? info : bundled
  }
  await introspectCommand(
    target,
    { json: true, ...opts },
    {
      runKernelCommand: (async (input: { fn: (context: unknown) => Promise<unknown> }) => {
        result = await input.fn({
          session: { schema: { inspect: read('inspect'), bundle: read('bundle') } },
        })
      }) as never,
    },
  )
  return { calls, result }
}

describe('describeCallableFromBundle', () => {
  test('reads a static Class method or a Function from the resolved Domain', () => {
    expect(describe_('/:host.astrale.ai:class.Manager:createInstance')).toMatchObject({
      origin: 'host.astrale.ai',
      class: 'Manager',
      method: 'createInstance',
      dispatch: 'static',
      description: 'Create one child Instance.',
      auth: 'authenticated',
      input: { required: ['operationId'] },
    })
    expect(describe_('/:host.astrale.ai:function.journal')).toMatchObject({
      function: 'journal',
      description: 'Read the journal.',
    })
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
    'explains wrong dispatch for %s and suggests a resolvable Path',
    (path, dispatch, corrected) => {
      expect(() => describe_(path)).toThrow(
        expect.objectContaining({
          code: 'CALL_DISPATCH_MISMATCH',
          hint: expect.stringContaining(corrected),
        }),
      )
      expect(describe_(corrected)?.dispatch).toBe(dispatch)
    },
  )

  test('describes the qualified Method owner, never a same-name Method of another Class', () => {
    for (const receiver of ['class.Manager', 'core.manager']) {
      const path = `/:host.astrale.ai:${receiver}::host.astrale.ai:class.Instance.method.edit`
      expect(describe_(path)).toMatchObject({
        path,
        class: 'Instance',
        method: 'edit',
        dispatch: 'instance',
        input: { required: ['body'] },
        output: { mode: 'value', schema: { required: ['body'] } },
      })
    }
    expect(
      describe_(
        '/:host.astrale.ai:core.manager::host.astrale.ai:class.Missing.method.inspectInstance',
      ),
    ).toBeUndefined()
    // The Method namespace's bundle, not a same-name Class in the receiver's namespace.
    const other = bundle.create(
      defineSchema('other.astrale.ai', {
        name: 'Test Domain',
        classes: { Manager: nodeClass({ icon: classIcon.neutral, methods: { edit: edit('x') } }) },
      }),
    )
    expect(
      describe_(
        '/:other.astrale.ai:class.Manager::host.astrale.ai:class.Instance.method.edit',
        other,
      ),
    ).toBeUndefined()
  })
})

describe('introspect command', () => {
  test('reads the summary, the bundle on request, and a callable from the bundle', async () => {
    expect(await introspect('host.astrale.ai')).toEqual({
      calls: ['inspect:host.astrale.ai'],
      result: info,
    })
    expect(await introspect('host.astrale.ai', { bundle: true })).toEqual({
      calls: ['bundle:host.astrale.ai'],
      result: bundled,
    })
    expect(await introspect('/:host.astrale.ai:function.journal')).toMatchObject({
      calls: ['bundle:host.astrale.ai'],
      result: { function: 'journal' },
    })
  })

  test.each(['/:receiver.example:core.owner', '@observed-node'])(
    'loads the qualified Method schema without reading receiver %s',
    async (receiver) => {
      const target = `${receiver}::host.astrale.ai:class.Instance.method.edit`
      expect(parseIntrospectTarget(target).origin).toBe('host.astrale.ai')
      expect(await introspect(target)).toMatchObject({
        calls: ['bundle:host.astrale.ai'],
        result: { path: target, class: 'Instance', method: 'edit', input: { required: ['body'] } },
      })
    },
  )

  test('refuses a bare @id, and reports an absent Domain with a stable machine error', async () => {
    expect(() => parseIntrospectTarget('@abc')).toThrow('a bare @id does not identify a schema')
    const absent = new ResponseError(
      1003,
      'Domain was not found.',
      { source: 'https://kernel.test', id: 'introspect' } as ConstructorParameters<
        typeof ResponseError
      >[2],
      { code: 'SCHEMA_NOT_FOUND', details: { origin: 'missing.astrale.ai' } },
    )
    const refuse = async () => Promise.reject(absent)
    await expect(
      introspectCommand(
        'missing.astrale.ai',
        { json: true },
        {
          runKernelCommand: (async (input: { fn: (context: unknown) => Promise<unknown> }) =>
            input.fn({ session: { schema: { inspect: refuse, bundle: refuse } } })) as never,
        },
      ),
    ).rejects.toMatchObject({ code: 'DOMAIN_NOT_INSTALLED' })
  })
})
