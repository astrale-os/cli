import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SchemaIR } from '../../shared/types'

import { buildHandlerLinks } from './source-overlay/handlers'
import { buildSourceSpans } from './source-overlay/spans'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const ir: SchemaIR = {
  version: 'v1',
  format: 'astrale.dsl',
  domain: 'issues.example',
  importsByKey: {},
  importedClassesByKey: {},
  classes: {
    Issue: {
      type: 'node',
      name: 'Issue',
      origin: 'issues.example',
      ref: { origin: 'issues.example', kind: 'class', name: 'Issue' },
      properties: {},
      methods: {
        rename: {
          name: 'rename',
          input: {},
          output: { mode: 'value', schema: {} },
          static: false,
          abstract: false,
          executable: true,
          auth: 'authorized',
        },
      },
    },
  },
  functions: {
    createIssue: {
      name: 'createIssue',
      input: {},
      output: { mode: 'value', schema: {} },
      auth: 'anonymous',
    },
  },
  views: {},
  policies: {},
  dependencies: [],
  core: {},
}

describe('source overlay', () => {
  test('locates registered policies and views in their authored modules, including aliases and inline declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-module-overlay-'))
    roots.push(root)
    const schemaDir = join(root, 'schema')
    const moduleDir = join(schemaDir, 'modules/billing')
    mkdirSync(join(moduleDir, 'policies'), { recursive: true })
    mkdirSync(join(moduleDir, 'views'), { recursive: true })
    writeFileSync(
      join(moduleDir, 'policies/pay.ts'),
      `import { policy } from '@astrale-os/sdk/schema'
/** May settle billing. */
export const declaredPolicy = policy({ expression: {} })`,
    )
    writeFileSync(
      join(moduleDir, 'views/billing.ts'),
      `import { view } from '@astrale-os/sdk/schema'
export const declaredView = view({})`,
    )
    writeFileSync(
      join(schemaDir, 'index.ts'),
      `import { defineSchema, view } from '@astrale-os/sdk/schema'
import { declaredPolicy as guard } from './modules/billing/policies/pay.js'
import { declaredView } from './modules/billing/views/billing.js'
export const schema = defineSchema('example.dev', { name: 'Test Domain',
  policies: { MayPay: guard },
  views: { billing: declaredView, overview: view({}) },
})`,
    )
    const spans = buildSourceSpans({ ir: null, domainRoot: root, schemaDir })
    expect(spans['policy.MayPay']).toMatchObject({
      file: 'schema/modules/billing/policies/pay.ts',
      doc: 'May settle billing.',
    })
    expect(spans['view.billing']?.file).toBe('schema/modules/billing/views/billing.ts')
    expect(spans['view.overview']?.file).toBe('schema/index.ts')
    expect(spans['policy.guard']).toBeUndefined()
  })
  test('links each Action and Workflow, in any module, to its wiring, its handler and its calls', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-handler-links-'))
    roots.push(root)
    mkdirSync(join(root, 'functions'))
    writeFileSync(
      join(root, 'functions/impl.ts'),
      `\n\nexport const settle = async ({ input }) => graph.createEdge(input)\n`,
    )
    writeFileSync(
      join(root, 'functions/index.ts'),
      `import { defineAction } from '@astrale-os/sdk/action'
import { settle } from './impl.ts'

export const rename = defineAction()('Issue.rename', settle)
`,
    )
    writeFileSync(
      join(root, 'functions/create.ts'),
      `import { defineWorkflow } from '@astrale-os/sdk/workflow'
export const create = defineWorkflow()('createIssue', async ({ input }) => graph.create(input))
`,
    )

    expect(buildHandlerLinks({ ir, domainRoot: root })).toEqual([
      expect.objectContaining({
        owner: 'Issue',
        ownerKind: 'class',
        kind: 'action',
        method: 'rename',
        // the handler is imported: the declaration and the implementation live apart
        wiringFile: 'functions/index.ts',
        wiringLine: 4,
        handlerFile: 'functions/impl.ts',
        handlerLine: 3,
        // `graph.createEdge` is not also counted as `graph.create`
        kernelCalls: ['graph.createEdge'],
      }),
      expect.objectContaining({
        owner: 'issues.example',
        ownerKind: 'function',
        kind: 'workflow',
        method: 'createIssue',
        // the handler is inline: both sit in the declaring module
        wiringFile: 'functions/create.ts',
        wiringLine: 2,
        handlerFile: 'functions/create.ts',
        handlerLine: 2,
        kernelCalls: ['graph.create'],
      }),
    ])
  })

  test('indexes Class, Property, Method, Edge endpoint, and Function declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-schema-spans-'))
    roots.push(root)
    const schemaDir = join(root, 'domain/model')
    mkdirSync(schemaDir, { recursive: true })
    writeFileSync(
      join(schemaDir, 'members.ts'),
      `
        export const Issue = nodeClass({
          properties: { title: property(z.string()) },
          methods: { rename },
        })
        export const assigned_to = edgeClass.directed({
          source: { as: 'issue', accepts: [Issue] },
          target: { as: 'owner', accepts: [Issue] },
          properties: { note: property(z.string()) },
        })
        /** Close one issue. */
        export const closeIssue = func({ input, output })
      `,
    )
    writeFileSync(
      join(schemaDir, 'index.ts'),
      `
        import { Issue, assigned_to, closeIssue } from './members.js'
        export const Schema = defineSchema('issues.example', { name: 'Test Domain',
          classes: { Issue, assigned_to },
          functions: { closeIssue },
        })
      `,
    )
    const spans = buildSourceSpans({ ir, domainRoot: root, schemaDir })
    for (const key of [
      'class.Issue.property.title',
      'class.Issue.method.rename',
      'edge.assigned_to.endpoint.issue',
      'edge.assigned_to.endpoint.owner',
      'edge.assigned_to.property.note',
      'function.closeIssue',
    ])
      expect(spans[key]?.file).toBe('domain/model/members.ts')
    expect(spans['function.closeIssue']?.doc).toBe('Close one issue.')
  })
})
