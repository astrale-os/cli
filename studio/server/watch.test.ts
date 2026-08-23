import { expect, test } from 'bun:test'
import { join } from 'node:path'

import type { DomainHandle } from './domain'

import { affectsBundle, ANATOMY_PATHS } from './watch'
import { DOMAIN_SET_TRIGGER_FILES } from './workspace-watch'

const handle: DomainHandle = {
  id: 'current',
  root: '/workspace/current',
  configFile: '/workspace/current/astrale.config.ts',
  applicationFile: '/workspace/current/application.ts',
  schemaDirName: 'schema',
  schemaDir: '/workspace/current/schema',
  schemaIndex: '/workspace/current/schema/index.ts',
}

test('watches current Application, Runtime, and vertical authoring roots', () => {
  expect(ANATOMY_PATHS).toContain('application.ts')
  expect(ANATOMY_PATHS).toContain('runtime.ts')
  expect(ANATOMY_PATHS).toContain('ui')
  expect(ANATOMY_PATHS).toContain('providers')
  expect(ANATOMY_PATHS).toContain('queries')
  expect(ANATOMY_PATHS).toContain('workflows')
  expect(DOMAIN_SET_TRIGGER_FILES.has('application.ts')).toBe(true)
  expect(DOMAIN_SET_TRIGGER_FILES.has('schema.ts')).toBe(true)
})

test('Application, Runtime, Action, and Workflow changes invalidate the schema bundle', () => {
  expect(affectsBundle(handle, join(handle.root, 'application.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'runtime.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'actions', 'risk', 'create.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'workflows', 'user', 'ensure.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'views', 'routes.ts'))).toBe(false)
})
