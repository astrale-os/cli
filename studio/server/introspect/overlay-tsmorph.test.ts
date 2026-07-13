import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildHandlerLinks } from './overlay-tsmorph'

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
