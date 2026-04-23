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
