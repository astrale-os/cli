import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BuiltinDomainNotFoundError } from '../../errors'
import { isBuiltinDomainName, resolveBuiltinDomain } from '../builtin-domains'

describe('SPEC V3 — builtin domain resolver', () => {
  let tmp = ''
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-builtin-test-'))
    savedEnv.spec = process.env.ASTRALE_DISTRIBUTION_SPEC
    savedEnv.key = process.env.ASTRALE_DISTRIBUTION_KEY
  })

  afterEach(async () => {
    process.env.ASTRALE_DISTRIBUTION_SPEC = savedEnv.spec
    process.env.ASTRALE_DISTRIBUTION_KEY = savedEnv.key
    delete process.env.ASTRALE_DISTRIBUTION_SPEC
    delete process.env.ASTRALE_DISTRIBUTION_KEY
    await rm(tmp, { recursive: true, force: true })
  })

  test('isBuiltinDomainName accepts "distribution"', () => {
    expect(isBuiltinDomainName('distribution')).toBe(true)
    expect(isBuiltinDomainName('whatever')).toBe(false)
  })

  test('resolves via env vars when both files exist', async () => {
    const specPath = join(tmp, 'spec.json')
    const keyPath = join(tmp, 'private-key.json')
    await writeFile(specPath, '{}')
    await writeFile(keyPath, '{}')
    process.env.ASTRALE_DISTRIBUTION_SPEC = specPath
    process.env.ASTRALE_DISTRIBUTION_KEY = keyPath

    const resolved = await resolveBuiltinDomain('distribution')
    expect(resolved.source).toBe('env')
    expect(resolved.specPath).toBe(specPath)
    expect(resolved.keyPath).toBe(keyPath)
  })

  test('skips env if files missing', async () => {
    process.env.ASTRALE_DISTRIBUTION_SPEC = join(tmp, 'nowhere.json')
    process.env.ASTRALE_DISTRIBUTION_KEY = join(tmp, 'nowhere.json')

    // Falls through to monorepo path — succeeds in dev workspace or throws.
    try {
      const resolved = await resolveBuiltinDomain('distribution')
      expect(resolved.source).not.toBe('env')
    } catch (e) {
      expect(e).toBeInstanceOf(BuiltinDomainNotFoundError)
    }
  })
})

describe('SPEC V3 — builtin domain resolver: manager-ui', () => {
  let tmp = ''
  // `name.toUpperCase()` keeps the hyphen → env keys carry it literally.
  const SPEC_KEY = 'ASTRALE_MANAGER-UI_SPEC'
  const KEY_KEY = 'ASTRALE_MANAGER-UI_KEY'
  const saved: Record<string, string | undefined> = {}

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-builtin-mui-'))
    saved.spec = process.env[SPEC_KEY]
    saved.key = process.env[KEY_KEY]
  })

  afterEach(async () => {
    delete process.env[SPEC_KEY]
    delete process.env[KEY_KEY]
    if (saved.spec !== undefined) process.env[SPEC_KEY] = saved.spec
    if (saved.key !== undefined) process.env[KEY_KEY] = saved.key
    await rm(tmp, { recursive: true, force: true })
  })

  test('isBuiltinDomainName accepts "manager-ui"', () => {
    expect(isBuiltinDomainName('manager-ui')).toBe(true)
    expect(isBuiltinDomainName('manager_ui')).toBe(false)
  })

  test('resolves manager-ui via the hyphenated env vars', async () => {
    const specPath = join(tmp, 'spec.json')
    const keyPath = join(tmp, 'key.json')
    await writeFile(specPath, '{}')
    await writeFile(keyPath, '{}')
    process.env[SPEC_KEY] = specPath
    process.env[KEY_KEY] = keyPath

    const resolved = await resolveBuiltinDomain('manager-ui')
    expect(resolved.source).toBe('env')
    expect(resolved.specPath).toBe(specPath)
    expect(resolved.keyPath).toBe(keyPath)
  })
})
