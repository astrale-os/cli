import { expect, test } from 'bun:test'
import { join } from 'node:path'

import type { DomainHandle } from './domain'

import { affectsBundle, ANATOMY_PATHS } from './watch'
import { DOMAIN_SET_TRIGGER_FILES } from './workspace-watch'

const handle: DomainHandle = {
  id: 'current',
  root: '/workspace/current',
  configFile: '/workspace/current/astrale.config.ts',
  domainFile: '/workspace/current/implementation.ts',
  schemaDirName: 'schema',
  schemaDir: '/workspace/current/schema',
  schemaIndex: '/workspace/current/schema/index.ts',
}

test('watches current layout roots and reconciles either composition entry', () => {
  expect(ANATOMY_PATHS).toContain('implementation.ts')
  expect(ANATOMY_PATHS).toContain('ui')
  expect(ANATOMY_PATHS).toContain('handlers')
  expect(ANATOMY_PATHS).toContain('queries')
  expect(ANATOMY_PATHS).toContain('workflows')
  expect(DOMAIN_SET_TRIGGER_FILES.has('implementation.ts')).toBe(true)
  expect(DOMAIN_SET_TRIGGER_FILES.has('domain.ts')).toBe(true)
})

test('composition and handler source changes invalidate the schema bundle', () => {
  expect(affectsBundle(handle, join(handle.root, 'implementation.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'domain.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'actions', 'risk', 'create.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'functions', 'user', 'ensure.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'handlers', 'create.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'views', 'routes.ts'))).toBe(false)
})
