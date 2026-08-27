import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SchemaIR } from '../../shared/types'

import { buildHandlerLinks, buildSourceSpans } from './overlay-tsmorph'

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
          inheritance: 'default',
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
  test('links modular Action and Workflow declarations to exact callables', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-runtime-overlay-'))
    roots.push(root)
    mkdirSync(join(root, 'actions'))
    mkdirSync(join(root, 'workflows'))
    writeFileSync(
      join(root, 'actions/rename.ts'),
      `
        import { defineAction } from '@astrale-os/sdk/action'
        export const rename = defineAction()('Issue.rename', async ({ input }) => graph.update(input))
      `,
    )
    writeFileSync(
      join(root, 'workflows/create.ts'),
      `
        import { defineWorkflow } from '@astrale-os/sdk/workflow'
        export const create = defineWorkflow()('createIssue', async ({ input }) => graph.create(input))
      `,
    )

    expect(
      buildHandlerLinks({ ir, domainRoot: root }).map((link) => ({
        owner: link.owner,
        ownerKind: link.ownerKind,
        kind: link.kind,
        method: link.method,
        handlerFile: link.handlerFile,
        kernelCalls: link.kernelCalls,
      })),
    ).toEqual([
      {
        owner: 'Issue',
        ownerKind: 'class',
        kind: 'action',
        method: 'rename',
        handlerFile: 'actions/rename.ts',
        kernelCalls: ['graph.update'],
      },
      {
        owner: 'issues.example',
        ownerKind: 'function',
        kind: 'workflow',
        method: 'createIssue',
        handlerFile: 'workflows/create.ts',
        kernelCalls: ['graph.create'],
      },
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
        export const createIssue = fn({ input, output })
      `,
    )
    writeFileSync(
      join(schemaDir, 'index.ts'),
      `
        import { Issue, assigned_to, createIssue } from './members.js'
        export const Schema = defineSchema('issues.example', {
          classes: { Issue, assigned_to },
          functions: { createIssue },
        })
      `,
    )
    const spans = buildSourceSpans({ ir, domainRoot: root, schemaDir })
    expect(spans['class.Issue.property.title']?.file).toBe('domain/model/members.ts')
    expect(spans['class.Issue.method.rename']?.file).toBe('domain/model/members.ts')
    expect(spans['edge.assigned_to.endpoint.issue']?.file).toBe('domain/model/members.ts')
    expect(spans['edge.assigned_to.endpoint.owner']?.file).toBe('domain/model/members.ts')
    expect(spans['edge.assigned_to.property.note']?.file).toBe('domain/model/members.ts')
    expect(spans['function.createIssue']?.file).toBe('domain/model/members.ts')
  })
})
