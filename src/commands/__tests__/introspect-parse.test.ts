import type { DomainBundle, DomainInfo } from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { bundle, defineSchema, func, method, nodeClass, schema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { introspectCommand, parseIntrospectTarget } from '../introspect'

const source = defineSchema('host.astrale.ai', {
  classes: {
    Manager: nodeClass({
      methods: {
        createInstance: method({
          auth: 'authenticated',
          input: { type: 'object', properties: {}, additionalProperties: false },
          output: { type: 'object', additionalProperties: true },
          static: true,
        }),
      },
    }),
  },
  functions: {
    journal: func({
      auth: 'authenticated',
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', additionalProperties: true },
    }),
  },
})

const TEST_INVOCATION = {
  source: 'https://kernel.test',
  id: 'introspect-domain-absence',
} as ConstructorParameters<typeof ResponseError>[2]

const info = {
  origin: source.origin,
  revision: schema.revision(source),
  generation: 'sha256:generation',
  publication: null,
  readiness: 'sha256:readiness',
  capabilities: { requested: {}, materialized: {} },
  bindings: { callables: [], views: [] },
} satisfies DomainInfo

const installed = bundle.create(source)
const bundled = { domain: info, bundle: installed } satisfies DomainBundle

describe('parseIntrospectTarget', () => {
  test('accepts a bare origin', () => {
    const parsed = parseIntrospectTarget('host.astrale.ai')
    expect(parsed.origin).toBe('host.astrale.ai')
    expect(parsed.path.ast.steps).toEqual([])
  })

  test('accepts a Domain-rooted method Path', () => {
    const parsed = parseIntrospectTarget('/:host.astrale.ai:class.Manager:createInstance')
    expect(parsed.origin).toBe('host.astrale.ai')
    expect(parsed.path.ast.steps.at(-1)?.kind).toBe('method')
  })

  test('rejects an @id', () => {
    expect(() => parseIntrospectTarget('@abc')).toThrow('not an @id')
  })

  test('routes bare, bundle, Method, and Function commands through the current Schema API', async () => {
    const calls: string[] = []
    const schema = {
      inspect: async (origin: string) => {
        calls.push(`inspect:${origin}`)
        return info
      },
      bundle: async (origin: string) => {
        calls.push(`bundle:${origin}`)
        return bundled
      },
    }
    const results: unknown[] = []
    const runKernelCommand = async (input: {
      fn: (context: unknown) => Promise<unknown>
    }): Promise<void> => {
      results.push(await input.fn({ session: { schema } }))
    }
    const dependencies = { runKernelCommand: runKernelCommand as never }

    await introspectCommand('host.astrale.ai', { json: true }, dependencies)
    await introspectCommand('host.astrale.ai', { bundle: true, json: true }, dependencies)
    await introspectCommand(
      '/:host.astrale.ai:class.Manager:createInstance',
      { json: true },
      dependencies,
    )
    await introspectCommand('/:host.astrale.ai:function.journal', { json: true }, dependencies)

    expect(results[0]).toBe(info)
    expect(results[1]).toBe(bundled)
    expect(results[2]).toMatchObject({ class: 'Manager', method: 'createInstance' })
    expect(results[3]).toMatchObject({ function: 'journal' })
    expect(calls).toEqual([
      'inspect:host.astrale.ai',
      'bundle:host.astrale.ai',
      'bundle:host.astrale.ai',
      'bundle:host.astrale.ai',
    ])
  })

  test('reports an absent installed Domain with a stable machine error', async () => {
    const absent = new ResponseError(1003, 'Domain was not found.', TEST_INVOCATION, {
      code: 'SCHEMA_NOT_FOUND',
      details: { origin: 'missing.astrale.ai' },
    })

    await expect(
      introspectCommand(
        'missing.astrale.ai',
        { json: true },
        {
          runKernelCommand: (async (input: { fn: (context: unknown) => Promise<unknown> }) => {
            await input.fn({
              session: {
                schema: {
                  inspect: async () => Promise.reject(absent),
                  bundle: async () => Promise.reject(absent),
                },
              },
            })
          }) as never,
        },
      ),
    ).rejects.toMatchObject({ code: 'DOMAIN_NOT_INSTALLED' })
  })
})
