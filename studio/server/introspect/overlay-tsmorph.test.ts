import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildHandlerLinks, buildSchemaAnnotations, buildSourceSpans } from './overlay-tsmorph'

test('resolves authorization hooks from imported remote method definitions', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-studio-handler-links-'))
  const runtime = join(root, 'runtime')
  mkdirSync(runtime)

  writeFileSync(
    join(runtime, 'index.ts'),
    `
      import { remoteClassMethods } from '@astrale-os/sdk'
      import {
        absentMethod,
        guardedMethod,
        noopMethod,
      } from './methods.js'

      const classMethods = remoteClassMethods()

      export const methods = {
        class: {
          Issue: classMethods(schema, 'Issue', {
            absent: absentMethod,
            guarded: guardedMethod,
            noop: noopMethod,
          }),
        },
      }
    `,
  )
  writeFileSync(
    join(runtime, 'methods.ts'),
    `
      import { remoteMethod } from '@astrale-os/sdk'

      const method = remoteMethod()
      const run = () => 'ok'

      export const guardedMethod = method(schema, 'Issue', 'guarded', {
        authorize: ({ auth, kernel, self }) =>
          kernel.auth.require({ who: auth.principal, on: self.path, perms: 1 }),
        execute: () => run(),
      })

      export const noopMethod = method(schema, 'Issue', 'noop', {
        authorize: async () => undefined,
        execute: () => run(),
      })

      export const absentMethod = method(schema, 'Issue', 'absent', {
        execute: () => run(),
      })
    `,
  )

  try {
    const links = buildHandlerLinks({ ir: null, domainRoot: root })
    expect(
      links.map(({ method, authorize, auth, implemented, unlinked, handlerFile }) => ({
        method,
        authorize,
        auth,
        implemented,
        unlinked: unlinked ?? false,
        handlerFile,
      })),
    ).toEqual([
      {
        method: 'absent',
        authorize: 'absent',
        auth: 'required',
        implemented: true,
        unlinked: false,
        handlerFile: 'runtime/methods.ts',
      },
      {
        method: 'guarded',
        authorize: 'custom',
        auth: 'required',
        implemented: true,
        unlinked: false,
        handlerFile: 'runtime/methods.ts',
      },
      {
        method: 'noop',
        authorize: 'noop',
        auth: 'required',
        implemented: true,
        unlinked: false,
        handlerFile: 'runtime/methods.ts',
      },
    ])
    expect(links.find((link) => link.method === 'guarded')?.authorizeSnippet).toContain(
      'kernel.auth.require',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('links current implementation handlers and current edge source spans', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-studio-current-overlay-'))
  const schemaDir = join(root, 'schema')
  const actionsDir = join(root, 'actions')
  mkdirSync(schemaDir)
  mkdirSync(actionsDir)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ imports: { '#actions/*': './actions/*.ts' } }),
  )

  writeFileSync(
    join(root, 'implementation.ts'),
    `
      import { rename } from '#actions/rename'
      import { createIssue } from '#actions/create-issue'
      export const domain = defineDomain.public({
        schema,
        handlers: {
          functions: { createIssue },
          classes: { Issue: { rename } },
          interfaces: {},
        },
      })
    `,
  )
  writeFileSync(
    join(actionsDir, 'rename.ts'),
    `
      export function rename({ input }) {
        return graph.update(input)
      }
    `,
  )
  writeFileSync(
    join(actionsDir, 'create-issue.ts'),
    `export const createIssue = ({ input }) => graph.create(input)`,
  )
  writeFileSync(
    join(schemaDir, 'members.ts'),
    `
      export const iIssue = nodeInterface({
        properties: { title: property({ type: 'string' }) },
      })
      export const Issue = nodeClass({
        properties: { title: property({ type: 'string' }) },
        methods: { rename },
      })
      export const assigned_to = edgeClass.directed({
        source: { as: 'issue', accepts: [Issue], outgoing: '0..*' },
        target: { as: 'owner', accepts: [Issue], incoming: '0..1' },
        properties: { note: property({ type: 'string' }) },
      })
      export const createIssue = fn({ auth: 'anonymous', input, output })
    `,
  )
  writeFileSync(
    join(schemaDir, 'index.ts'),
    `
      import { Issue, assigned_to, createIssue, iIssue as issueInterface } from './members.js'
      const schemaInput = {
        interfaces: { Issue: issueInterface },
        classes: { Issue, assigned_to },
        functions: { createIssue },
      } as const
      export const schema = defineSchema('issues.example', schemaInput)
    `,
  )

  try {
    const links = buildHandlerLinks({
      ir: {
        version: 'v1',
        domain: 'issues.example',
        types: {},
        interfaces: {},
        classes: {
          Issue: {
            type: 'node',
            name: 'Issue',
            properties: {},
            methods: {
              rename: {
                name: 'rename',
                params: {},
                returns: {},
                static: false,
                inheritance: 'default',
                auth: 'authorized',
              } as any,
            },
          },
        },
        imports: {},
        functions: {
          createIssue: {
            name: 'createIssue',
            input: {},
            params: {},
            output: { mode: 'value', schema: {} },
            returns: {},
            static: true,
            inheritance: 'default',
            auth: 'anonymous',
          },
        },
      },
      domainRoot: root,
    })
    expect(links).toHaveLength(2)
    expect(links.find((link) => link.ownerKind === 'class')).toMatchObject({
      owner: 'Issue',
      ownerKind: 'class',
      method: 'rename',
      wiringFile: 'implementation.ts',
      handlerFile: 'actions/rename.ts',
      implemented: true,
      auth: 'required',
      callableAuth: 'authorized',
      authorize: 'custom',
      kernelCalls: ['graph.update'],
    })
    expect(links.find((link) => link.ownerKind === 'function')).toMatchObject({
      owner: 'issues.example',
      method: 'createIssue',
      wiringFile: 'implementation.ts',
      handlerFile: 'actions/create-issue.ts',
      implemented: true,
      static: true,
      auth: 'public',
      callableAuth: 'anonymous',
      kernelCalls: ['graph.create'],
    })

    const spans = buildSourceSpans({ ir: null, schemaDir })
    expect(spans['interface.Issue.property.title']?.file).toBe('schema/members.ts')
    expect(spans['class.Issue.property.title']?.file).toBe('schema/members.ts')
    expect(spans['edge.assigned_to.endpoint.issue']?.file).toBe('schema/members.ts')
    expect(spans['edge.assigned_to.endpoint.owner']?.file).toBe('schema/members.ts')
    expect(spans['edge.assigned_to.property.note']?.file).toBe('schema/members.ts')
    expect(spans['function.createIssue']?.file).toBe('schema/members.ts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('does not emit the obsolete enum update warning', () => {
  expect(
    buildSchemaAnnotations({
      ir: {
        classes: {
          Issue: {
            type: 'node',
            name: 'Issue',
            properties: { status: { type: 'string', enum: ['open', 'closed'] } },
            methods: {},
          },
        },
      } as any,
    }),
  ).toEqual([])
})
