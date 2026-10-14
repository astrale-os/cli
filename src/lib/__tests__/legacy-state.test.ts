import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readIdentityStore, upgradeUnversionedIdentityState } from '../../state/identities'
import { InstanceStoreSchema, upgradeUnversionedInstanceState } from '../instance/bookmarks'
import { upgradeFile } from '../legacy-state'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-legacy-state-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const identities = JSON.stringify({
  default: 'alice',
  identities: {
    alice: { subject: 'alice', createdAt: '2025-01-01T00:00:00.000Z', source: 'idp' },
  },
})

const instances = JSON.stringify({
  active: 'manager',
  instances: {
    manager: { url: 'http://localhost:3000' },
    pending: { slug: 'pending' },
    pace: {
      url: 'https://pace.eu.astrale.ai/api',
      issuer: 'https://pace.eu.astrale.ai/api',
      domainIssuer: 'https://shell.astrale.ai',
      slug: 'pace',
    },
  },
})

describe('upgrade of pre-V1 local registries', () => {
  test('upgrades an unversioned identity registry and keeps its exact bytes', async () => {
    const path = join(directory, 'identities.json')
    await writeFile(path, identities, { mode: 0o600 })

    expect(await upgradeFile(path, upgradeUnversionedIdentityState)).toBe(`${path}.v0.bak`)

    expect(await readFile(`${path}.v0.bak`, 'utf8')).toBe(identities)
    expect((await stat(`${path}.v0.bak`)).mode & 0o777).toBe(0o600)
    expect(await readIdentityStore({ path })).toEqual(JSON.parse(identities))
    await expect(readFile(`${path}.lock`, 'utf8')).rejects.toThrow()
  })

  test('upgrades an unversioned instance registry the way earlier releases read it', async () => {
    const path = join(directory, 'instances.json')
    await writeFile(path, instances)

    await upgradeFile(path, upgradeUnversionedInstanceState)

    const store = InstanceStoreSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    expect(Object.keys(store.instances)).toEqual(['pace'])
    expect(store.active).toBe('pace')
    expect(store.instances.pace?.domainIssuer).toBe('https://shell.astrale.ai')
  })

  test('leaves current, missing, malformed and newer files untouched', async () => {
    const path = join(directory, 'identities.json')
    expect(await upgradeFile(path, upgradeUnversionedIdentityState)).toBeUndefined()
    for (const raw of [
      JSON.stringify({ version: 1, ...JSON.parse(identities) }),
      JSON.stringify({ version: 2, default: '', identities: {} }),
      JSON.stringify({ default: 'alice', identities: { alice: { subject: 1 } } }),
      '{',
    ]) {
      await writeFile(path, raw)
      expect(await upgradeFile(path, upgradeUnversionedIdentityState)).toBeUndefined()
      expect(await readFile(path, 'utf8')).toBe(raw)
      await expect(readFile(`${path}.v0.bak`, 'utf8')).rejects.toThrow()
    }
  })

  test('never overwrites a different earlier backup', async () => {
    const path = join(directory, 'identities.json')
    await writeFile(`${path}.v0.bak`, 'earlier')
    await writeFile(path, identities)

    expect(await upgradeFile(path, upgradeUnversionedIdentityState)).toBe(`${path}.v0.1.bak`)

    expect(await readFile(`${path}.v0.bak`, 'utf8')).toBe('earlier')
    expect(await readFile(`${path}.v0.1.bak`, 'utf8')).toBe(identities)
  })
})
