import { expect, test } from 'bun:test'
import { join } from 'node:path'

import type { DomainHandle } from './registry'

import { affectsBundle, domainWatchChannels } from './watch'

const handle: DomainHandle = {
  id: 'current',
  root: '/workspace/current',
  configFile: '/workspace/current/astrale.config.ts',
  domainFile: '/workspace/current/domain.ts',
  schemaDirName: 'schema',
  schemaDir: '/workspace/current/schema',
  schemaIndex: '/workspace/current/schema/index.ts',
}

test('Domain definition, Runtime, and Function changes invalidate the schema bundle', () => {
  expect(affectsBundle(handle, join(handle.root, 'domain.ts'))).toBe(true)
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
  expect(domainWatchChannels(handle, handle.domainFile)).toEqual({
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
