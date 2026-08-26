import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { createPaths } from '../paths'

describe('state paths', () => {
  /** @evidence TEST-CLI-STATE-PATHS-CAPTURED */
  test('captures explicit and environment coordinates once', () => {
    const environment: Record<string, string | undefined> = {
      ASTRALE_HOME: '/environment/home',
      ASTRALE_KEYS_DIR: '/environment/keys',
      ASTRALE_DATA_DIR: '/environment/data',
    }
    const explicit = createPaths('/explicit/home', environment)
    const inherited = createPaths(undefined, environment)

    environment.ASTRALE_HOME = '/changed/home'
    environment.ASTRALE_KEYS_DIR = '/changed/keys'

    expect(explicit.home).toBe('/explicit/home')
    expect(explicit.keys).toBe('/environment/keys')
    expect(explicit.config).toBe(join('/explicit/home', 'config.json'))
    expect(explicit.sessionRoutes).toBe(join('/explicit/home', 'session', 'routes.json'))
    expect(inherited.home).toBe('/environment/home')
    expect(inherited.keys).toBe('/environment/keys')
    expect(Object.isFrozen(explicit)).toBe(true)
  })
})
