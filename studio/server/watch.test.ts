import { expect, test } from 'bun:test'
import { join } from 'node:path'

import type { DomainHandle } from './domain'

import { affectsBundle, ANATOMY_PATHS, domainWatchChannels } from './watch'
import { WORKSPACE_RESCAN_MS } from './workspace-watch'

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
  expect(ANATOMY_PATHS).toContain('functions')
})

test('the workspace is re-scanned often enough to notice a domain, rarely enough to be free', () => {
  expect(WORKSPACE_RESCAN_MS).toBeGreaterThanOrEqual(5_000)
  expect(WORKSPACE_RESCAN_MS).toBeLessThanOrEqual(60_000)
})

test('Application, Runtime, and Function changes invalidate the schema bundle', () => {
  expect(affectsBundle(handle, join(handle.root, 'application.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'runtime.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'functions', 'risk', 'create.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'functions', 'user', 'ensure.ts'))).toBe(true)
  expect(affectsBundle(handle, join(handle.root, 'views', 'routes.ts'))).toBe(false)
})

test('native recursive events preserve schema, anatomy, and Dataset channels', () => {
  expect(domainWatchChannels(handle, join(handle.root, 'schema', 'index.ts'))).toEqual({
    schema: true,
    anatomy: false,
    datasets: false,
  })
  expect(domainWatchChannels(handle, handle.applicationFile)).toEqual({
    schema: true,
    anatomy: true,
    datasets: false,
  })
  expect(domainWatchChannels(handle, join(handle.root, 'functions', 'create.ts'))).toEqual({
    schema: false,
    anatomy: true,
    datasets: false,
  })
  expect(domainWatchChannels(handle, join(handle.root, 'tests', 'datasets', 'demo.ts'))).toEqual({
    schema: false,
    anatomy: false,
    datasets: true,
  })
  expect(domainWatchChannels(handle, handle.configFile)).toEqual({
    schema: false,
    anatomy: true,
    datasets: true,
  })
})
